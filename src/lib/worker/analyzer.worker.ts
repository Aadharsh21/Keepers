/// <reference lib="webworker" />
import { dHash } from '../analysis/dhash'
import { graphicStats, hasScreenshotTag, screenshotName } from '../analysis/graphic'
import { exposureStats } from '../analysis/exposure'
import { lumaFromRgba } from '../analysis/luma'
import { tileSharpness } from '../analysis/sharpness'
import { detectFaces, embedImage, initVision, visionReady } from '../analysis/vision'
import { DecodeError, decodePhoto, encodeJpeg, readPixels } from '../image/decode'
import { ANALYSIS_VERSION, type AnalysisResult, type PhotoFeatures } from '../types'
import { ANALYSIS_LONG_EDGE, METRIC_LONG_EDGE, THUMB_LONG_EDGE, type FromWorker, type ToWorker } from './protocol'

declare const self: DedicatedWorkerGlobalScope

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer)
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits

async function analyze(file: File, kind: Parameters<typeof decodePhoto>[1]): Promise<AnalysisResult> {
  const timings: Record<string, number> = {}
  let t = performance.now()
  const lap = (name: string) => {
    const now = performance.now()
    timings[name] = Math.round(now - t)
    t = now
  }

  const decoded = await decodePhoto(file, kind, ANALYSIS_LONG_EDGE)
  lap('decode')
  const { bitmap, meta } = decoded
  try {
    const px = readPixels(bitmap, METRIC_LONG_EDGE)
    const luma = lumaFromRgba(px.rgba, px.width, px.height)
    const sharp = tileSharpness(luma, 128)
    const exposure = exposureStats(px.rgba, px.width, px.height)
    const pixels = graphicStats(px.rgba, px.width, px.height)
    const tagged = kind !== 'raw' && hasScreenshotTag(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()))
    const dhash = dHash(luma)
    lap('metrics')

    const vision = visionReady()
    const faces = vision ? detectFaces(bitmap) : []
    lap('faces')
    const embedding = vision ? embedImage(bitmap) : null
    lap('embed')
    const thumb = await encodeJpeg(bitmap, THUMB_LONG_EDGE, 0.78)
    lap('thumb')

    const camera = [meta.make, meta.model]
      .filter(Boolean)
      .join(' ')
      .replace(/^(\w+)\s+\1\s/i, '$1 ')
      .trim()
    const features: PhotoFeatures = {
      version: ANALYSIS_VERSION,
      width: decoded.width,
      height: decoded.height,
      captureTime: meta.captureTime,
      camera: camera || undefined,
      lens: meta.lens,
      iso: meta.iso,
      exposureTime: meta.exposureTime,
      fNumber: meta.fNumber,
      focalLength: meta.focalLength,
      sharp: {
        global: round(sharp.global),
        p90: round(sharp.p90),
        p50: round(sharp.p50),
        max: round(sharp.max),
        cols: sharp.cols,
        rows: sharp.rows,
        tiles: sharp.tiles.map((v) => round(v, 1)),
      },
      exposure,
      dhash,
      embedding,
      faces,
      facesChecked: vision,
      graphic: { ...pixels, named: screenshotName(file.name), tagged },
      previewSource: decoded.previewSource,
      timings,
    }
    return { features, thumb }
  } finally {
    bitmap.close()
  }
}

async function preview(file: File, kind: Parameters<typeof decodePhoto>[1], maxLong: number) {
  const decoded = await decodePhoto(file, kind, maxLong)
  try {
    const blob = await encodeJpeg(decoded.bitmap, maxLong, 0.9)
    return { blob, width: decoded.bitmap.width, height: decoded.bitmap.height }
  } finally {
    decoded.bitmap.close()
  }
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'init') {
    const start = performance.now()
    try {
      await initVision(msg.base)
      post({ type: 'ready', vision: true, ms: Math.round(performance.now() - start) })
    } catch (err) {
      // Focus, exposure and duplicate checks still work without the models.
      post({ type: 'ready', vision: false, reason: String(err), ms: Math.round(performance.now() - start) })
    }
    return
  }
  try {
    if (msg.type === 'analyze') {
      const result = await analyze(msg.file, msg.kind)
      const transfer: Transferable[] = result.features.embedding ? [result.features.embedding.buffer] : []
      post({ type: 'result', id: msg.id, result }, transfer)
    } else if (msg.type === 'preview') {
      const out = await preview(msg.file, msg.kind, msg.maxLong)
      post({ type: 'preview', id: msg.id, ...out })
    }
  } catch (err) {
    const code = err instanceof DecodeError ? err.code : 'failed'
    if (!(err instanceof DecodeError)) console.warn('[keeper] analysis failed', msg.type === 'analyze' || msg.type === 'preview' ? msg.file.name : '', err)
    const message =
      err instanceof DecodeError ? err.message : 'Keepers could not read this file. It may be damaged, or saved in a format this browser cannot open.'
    post({ type: 'error', id: msg.id, code, message })
  }
}
