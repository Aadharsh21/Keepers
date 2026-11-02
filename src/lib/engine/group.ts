import { hamming } from '../analysis/dhash'
import type { EnginePhoto, Grouping, Moment } from './types'

interface Thresholds {
  /** Frames this close in time are a burst. */
  burstGapMs: number
  /** Similar frames further apart than this start a new moment. */
  maxGapMs: number
  /** Embedding similarity needed inside a burst. */
  simBurst: number
  /** Similarity that alone means "same moment". */
  simHigh: number
  /** Similarity that counts when the layout hash agrees too. */
  simLow: number
  hamLow: number
}

export const THRESHOLDS: Record<Grouping, Thresholds> = {
  tight: { burstGapMs: 1000, maxGapMs: 30_000, simBurst: 0.8, simHigh: 0.93, simLow: 0.86, hamLow: 14 },
  normal: { burstGapMs: 2000, maxGapMs: 90_000, simBurst: 0.72, simHigh: 0.89, simLow: 0.8, hamLow: 18 },
  loose: { burstGapMs: 4000, maxGapMs: 300_000, simBurst: 0.64, simHigh: 0.84, simLow: 0.74, hamLow: 22 },
}

export function cosine(a: Float32Array | null, b: Float32Array | null): number | null {
  if (!a || !b || a.length !== b.length) return null
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/** Sort by capture time, falling back to filename order for photos without one. */
export function chronological(photos: EnginePhoto[]): EnginePhoto[] {
  return [...photos].sort((a, b) => {
    const ta = a.f.captureTime
    const tb = b.f.captureTime
    if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb
    if (ta !== undefined && tb === undefined) return -1
    if (ta === undefined && tb !== undefined) return 1
    return a.order - b.order
  })
}

/** Decides whether two photos belong to the same moment, and why. */
export function sameMoment(a: EnginePhoto, b: EnginePhoto, anchor: EnginePhoto, t: Thresholds): boolean {
  const ham = hamming(a.f.dhash, b.f.dhash)
  const sim = cosine(a.f.embedding, b.f.embedding)
  const dt = a.f.captureTime !== undefined && b.f.captureTime !== undefined ? Math.abs(b.f.captureTime - a.f.captureTime) : null

  // Exact or near-exact duplicates (the same file twice, or a RAW and JPEG that did not pair).
  if (ham <= 3 && (sim === null || sim >= 0.98)) return true

  if (sim === null) {
    // Vision model unavailable: fall back to the layout hash alone.
    if (dt !== null && dt <= t.burstGapMs && ham <= t.hamLow + 4) return true
    return ham <= t.hamLow - 6 && (dt === null || dt <= t.maxGapMs)
  }

  if (dt !== null && dt <= t.burstGapMs && sim >= t.simBurst) return true
  if (dt !== null && dt > t.maxGapMs) return false
  const similar = sim >= t.simHigh || (sim >= t.simLow && ham <= t.hamLow)
  if (!similar) return false
  // Guard against slow drift: a long chain of small changes is a new moment.
  const toAnchor = cosine(anchor.f.embedding, b.f.embedding) ?? sim
  return toAnchor >= t.simLow - 0.1
}

export function groupMoments(photos: EnginePhoto[], grouping: Grouping): Moment[] {
  const t = THRESHOLDS[grouping]
  const sorted = chronological(photos)
  const moments: Moment[] = []
  let current: EnginePhoto[] = []
  const flush = () => {
    if (!current.length) return
    const times = current.map((p) => p.f.captureTime).filter((v): v is number => v !== undefined)
    moments.push({
      id: `m${moments.length + 1}`,
      photoIds: current.map((p) => p.id),
      start: times.length ? Math.min(...times) : undefined,
      end: times.length ? Math.max(...times) : undefined,
    })
    current = []
  }
  for (const p of sorted) {
    const prev = current[current.length - 1]
    if (prev && sameMoment(prev, p, current[0], t)) current.push(p)
    else {
      flush()
      current = [p]
    }
  }
  flush()
  return moments
}
