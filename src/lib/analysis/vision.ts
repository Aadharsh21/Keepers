import { FaceLandmarker, FilesetResolver, ImageEmbedder, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import type { FaceInfo, Rect } from '../types'
import { readRegion } from '../image/decode'
import { lumaFromRgba } from './luma'
import { regionSharpness } from './sharpness'

/**
 * On-device vision models (Google MediaPipe, Apache 2.0):
 *  - Face Landmarker: 478 face landmarks plus 52 blendshape scores, including
 *    eyeBlinkLeft/Right, which is how Keeper spots closed eyes.
 *  - Image Embedder (MobileNetV3 small): a 1024-number fingerprint of what the
 *    photo shows, used to find near-duplicate frames.
 * Both run inside this worker on the CPU through WebAssembly.
 */
let landmarker: FaceLandmarker | null = null
let embedder: ImageEmbedder | null = null

export async function initVision(base: string): Promise<void> {
  // Absolute URLs: MediaPipe loads its runtime with a dynamic import(), and
  // Vite's dev server would otherwise rewrite same-origin relative imports.
  const root = new URL(base, self.location.origin).href
  const fileset = await FilesetResolver.forVisionTasks(`${root}mediapipe/${__MEDIAPIPE_VERSION__}`, true)
  ;[landmarker, embedder] = await Promise.all([
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${root}models/face_landmarker-v1.task`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 8,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      outputFaceBlendshapes: true,
    }),
    ImageEmbedder.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${root}models/mobilenet_v3_small-v1.tflite`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      l2Normalize: true,
      quantize: false,
    }),
  ])
}

export function visionReady(): boolean {
  return landmarker !== null && embedder !== null
}

// Landmark indices of each eye's contour in the MediaPipe face mesh.
const EYE_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
const EYE_B = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]

interface RawFace {
  box: Rect
  points: { x: number; y: number }[]
  blink: [number, number]
  smile: number
}

function boundsOf(points: { x: number; y: number }[], idx?: number[]): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of idx ?? points.keys()) {
    const p = points[i]
    if (!p) continue
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function iou(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

function collect(result: FaceLandmarkerResult, tile: Rect, out: RawFace[]): void {
  result.faceLandmarks.forEach((landmarks, i) => {
    // Skip faces the tile cut through; another pass sees them whole.
    const local = boundsOf(landmarks)
    const cut = local.x < -0.04 || local.y < -0.04 || local.x + local.w > 1.04 || local.y + local.h > 1.04
    if (cut && tile.w < 1) return
    const points = landmarks.map((p) => ({ x: tile.x + p.x * tile.w, y: tile.y + p.y * tile.h }))
    const shapes = new Map(result.faceBlendshapes[i]?.categories.map((c) => [c.categoryName, c.score]) ?? [])
    out.push({
      box: boundsOf(points),
      points,
      blink: [shapes.get('eyeBlinkLeft') ?? 0, shapes.get('eyeBlinkRight') ?? 0],
      smile: ((shapes.get('mouthSmileLeft') ?? 0) + (shapes.get('mouthSmileRight') ?? 0)) / 2,
    })
  })
}

/**
 * The face detector inside Face Landmarker works best on faces that fill a
 * good part of the input. Wedding and group shots have small faces, so after
 * the full-frame pass we also scan four overlapping tiles.
 */
export function detectFaces(bitmap: ImageBitmap): FaceInfo[] {
  if (!landmarker) return []
  const found: RawFace[] = []
  collect(landmarker.detect(bitmap), { x: 0, y: 0, w: 1, h: 1 }, found)

  const W = bitmap.width
  const H = bitmap.height
  // A face filling 2% or more of the frame is the subject (portrait, couple,
  // close-up). Smaller background faces do not decide a cull, so the tile
  // passes only run when the frame has no clear subject face.
  const largest = Math.max(0, ...found.map((f) => f.box.w * f.box.h))
  if (largest < 0.02) {
    const span = 0.6
    const tw = Math.round(W * span)
    const th = Math.round(H * span)
    // The detector looks at a small input anyway; a smaller tile is cheaper to upload.
    const scale = Math.min(1, 1024 / Math.max(tw, th))
    const canvas = new OffscreenCanvas(Math.round(tw * scale), Math.round(th * scale))
    const ctx = canvas.getContext('2d')!
    for (const [fx, fy] of [
      [0, 0],
      [1 - span, 0],
      [0, 1 - span],
      [1 - span, 1 - span],
    ]) {
      const sx = Math.round(fx * W)
      const sy = Math.round(fy * H)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, sx, sy, tw, th, 0, 0, canvas.width, canvas.height)
      collect(landmarker.detect(canvas), { x: sx / W, y: sy / H, w: tw / W, h: th / H }, found)
    }
  }

  // Merge duplicates across passes, keeping the larger (usually more complete) mesh.
  found.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
  const faces: RawFace[] = []
  for (const f of found) {
    if (f.box.w <= 0 || f.box.h <= 0) continue
    if (!faces.some((g) => iou(g.box, f.box) > 0.3)) faces.push(f)
  }

  return faces
    .filter((f) => f.box.w * f.box.h >= 0.0004)
    .map((f) => {
      const px = (r: Rect) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H })
      const eyeSharp = Math.max(eyeFocus(bitmap, f.points, EYE_A, W, H), eyeFocus(bitmap, f.points, EYE_B, W, H))
      const fb = px(f.box)
      const faceRegion = readRegion(bitmap, fb.x, fb.y, fb.w, fb.h)
      const faceSharp = regionSharpness(lumaFromRgba(faceRegion.rgba, faceRegion.width, faceRegion.height), 160)
      const clamp = (r: Rect): Rect => {
        const x = Math.max(0, r.x)
        const y = Math.max(0, r.y)
        return { x, y, w: Math.min(1, r.x + r.w) - x, h: Math.min(1, r.y + r.h) - y }
      }
      const box = clamp(f.box)
      return {
        box,
        area: box.w * box.h,
        blink: f.blink,
        smile: f.smile,
        eyeSharp,
        faceSharp,
      }
    })
}

function eyeFocus(bitmap: ImageBitmap, points: { x: number; y: number }[], idx: number[], W: number, H: number): number {
  const eye = boundsOf(points, idx)
  const ew = eye.w * W
  if (ew < 6) return 0
  const cx = (eye.x + eye.w / 2) * W
  const cy = (eye.y + eye.h / 2) * H
  const rw = ew * 1.7
  const rh = Math.max(eye.h * H * 2.6, ew * 0.85)
  const region = readRegion(bitmap, cx - rw / 2, cy - rh / 2, rw, rh)
  return regionSharpness(lumaFromRgba(region.rgba, region.width, region.height), 64)
}

export function embedImage(bitmap: ImageBitmap): Float32Array | null {
  if (!embedder) return null
  const result = embedder.embed(bitmap)
  const v = result.embeddings[0]?.floatEmbedding
  return v ? Float32Array.from(v) : null
}
