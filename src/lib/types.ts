import type { ExposureStats } from './analysis/exposure'
import type { PhotoKind } from './formats/detect'

/** Bump when analysis output changes so cached results are recomputed. */
export const ANALYSIS_VERSION = 4

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface FaceInfo {
  /** Normalized to the oriented frame (0..1). */
  box: Rect
  /** Share of the frame the face covers. */
  area: number
  /** MediaPipe blendshape scores for the subject's left and right eye, 0 open .. 1 closed. */
  blink: [number, number]
  smile: number
  /** Focus measure on the eye regions at a normalized scale. */
  eyeSharp: number
  /** Focus measure on the whole face at a normalized scale. */
  faceSharp: number
}

export interface PhotoFeatures {
  version: number
  /** Oriented size of the decoded source (full image or RAW preview). */
  width: number
  height: number
  captureTime?: number
  camera?: string
  lens?: string
  iso?: number
  exposureTime?: number
  fNumber?: number
  focalLength?: number
  sharp: {
    global: number
    p90: number
    p50: number
    max: number
    cols: number
    rows: number
    tiles: number[]
  }
  exposure: ExposureStats
  dhash: [number, number]
  /** L2-normalized MobileNetV3 image embedding; null when vision models could not load. */
  embedding: Float32Array | null
  faces: FaceInfo[]
  /** False when the face model was unavailable, so "no faces" means "not checked". */
  facesChecked: boolean
  /** Signals for telling screenshots and graphics apart from camera photos. */
  graphic: {
    flat: number
    top16: number
    /** The file name says screenshot. */
    named: boolean
    /** The file carries the "Screenshot" tag iPhones and Macs write. */
    tagged: boolean
  }
  previewSource?: string
  timings: Record<string, number>
}

export interface AnalysisResult {
  features: PhotoFeatures
  thumb: Blob
}

/** One photo as the user sees it. A RAW+JPEG pair is a single photo. */
export interface PhotoSource {
  id: string
  name: string
  relPath: string
  kind: PhotoKind
  /** File that gets decoded. The JPEG twin is preferred over RAW: same picture, faster. */
  file: File
  raw?: File
  /** Every file that belongs to this photo, for copying and ZIP export. */
  files: File[]
  /** Existing sidecar, if the folder already had one. */
  xmp?: File
  /** Directory path inside the opened folder ('' for the root). */
  dir: string
}

export type Verdict = 'keep' | 'reject'
