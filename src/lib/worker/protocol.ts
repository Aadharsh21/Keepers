import type { PhotoKind } from '../formats/detect'
import type { AnalysisResult } from '../types'

export type ToWorker =
  | { type: 'init'; base: string }
  | { type: 'analyze'; id: number; file: File; kind: PhotoKind }
  | { type: 'preview'; id: number; file: File; kind: PhotoKind; maxLong: number }

export type FromWorker =
  | { type: 'ready'; vision: boolean; reason?: string; ms: number }
  | { type: 'result'; id: number; result: AnalysisResult }
  | { type: 'preview'; id: number; blob: Blob; width: number; height: number }
  | { type: 'error'; id: number; code: string; message: string }

/** Analysis resolution: long edge in pixels for faces and region focus. */
export const ANALYSIS_LONG_EDGE = 2048
/** Long edge for whole-frame focus, exposure and hashing. */
export const METRIC_LONG_EDGE = 1024
export const THUMB_LONG_EDGE = 512
