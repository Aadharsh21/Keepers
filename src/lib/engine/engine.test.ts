import { describe, expect, it } from 'vitest'
import { ANALYSIS_VERSION, type FaceInfo, type PhotoFeatures } from '../types'
import { groupMoments } from './group'
import { cull, subjectFaces } from './score'
import { DEFAULT_SETTINGS, type EnginePhoto } from './types'

let seed = 7
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648 - 0.5
}
function unit(v: number[]): Float32Array {
  const n = Math.hypot(...v)
  return Float32Array.from(v.map((x) => x / n))
}
function scene(): number[] {
  return Array.from({ length: 64 }, rand)
}
function near(base: number[], noise: number): Float32Array {
  return unit(base.map((x) => x + rand() * noise))
}

const face = (over: Partial<FaceInfo> = {}): FaceInfo => ({
  box: { x: 0.4, y: 0.2, w: 0.2, h: 0.25 },
  area: 0.05,
  blink: [0.1, 0.12],
  smile: 0.4,
  eyeSharp: 1000,
  faceSharp: 600,
  ...over,
})

let order = 0
function photo(id: string, over: Partial<PhotoFeatures> & { emb: Float32Array | null; t?: number; hash?: [number, number] }): EnginePhoto {
  const { emb, t, hash, ...rest } = over
  const f: PhotoFeatures = {
    version: ANALYSIS_VERSION,
    width: 6000,
    height: 4000,
    captureTime: t,
    sharp: { global: 300, p90: 900, p50: 300, max: 1200, cols: 8, rows: 5, tiles: [] },
    exposure: { mean: 118, p02: 8, p98: 240, clipHigh: 0.01, clipLow: 0.01, histogram: [] },
    dhash: hash ?? [0x0f0f0f0f, 0x33333333],
    embedding: emb,
    faces: [],
    facesChecked: true,
    timings: {},
    ...rest,
  }
  return { id, name: `${id}.jpg`, order: order++, f }
}

describe('grouping', () => {
  it('puts a burst in one moment and separates different scenes', () => {
    const a = scene()
    const b = scene()
    const photos = [
      photo('A1', { emb: near(a, 0.05), t: 0 }),
      photo('A2', { emb: near(a, 0.05), t: 400 }),
      photo('A3', { emb: near(a, 0.05), t: 800 }),
      photo('B1', { emb: near(b, 0.05), t: 120_000, hash: [0xaaaaaaaa, 0x55555555] }),
    ]
    const moments = groupMoments(photos, 'normal')
    expect(moments.map((m) => m.photoIds)).toEqual([['A1', 'A2', 'A3'], ['B1']])
  })

  it('respects the grouping sensitivity for slower sequences', () => {
    const a = scene()
    const photos = [photo('S1', { emb: near(a, 0.04), t: 0 }), photo('S2', { emb: near(a, 0.04), t: 60_000, hash: [0x0f0f0f0f, 0x3333ffff] })]
    expect(groupMoments(photos, 'normal')).toHaveLength(1)
    expect(groupMoments(photos, 'tight')).toHaveLength(2)
  })

  it('orders by capture time, not by the order files arrived in', () => {
    const a = scene()
    const photos = [photo('late', { emb: near(a, 0.05), t: 900 }), photo('early', { emb: near(a, 0.05), t: 100 })]
    expect(groupMoments(photos, 'normal')[0].photoIds).toEqual(['early', 'late'])
  })

  it('falls back to the layout hash when the vision model is unavailable', () => {
    const photos = [
      photo('H1', { emb: null, t: 0, hash: [0x0f0f0f0f, 0x33333333] }),
      photo('H2', { emb: null, t: 500, hash: [0x0f0f0f0e, 0x33333332] }),
      photo('H3', { emb: null, t: 1000, hash: [0xf0f0f0f0, 0xcccccccc] }),
    ]
    expect(groupMoments(photos, 'normal').map((m) => m.photoIds)).toEqual([['H1', 'H2'], ['H3']])
  })
})

describe('culling decisions', () => {
  it('keeps the sharpest open-eyed frame and explains the rejects', () => {
    const a = scene()
    const photos = [
      photo('soft', { emb: near(a, 0.05), t: 0, faces: [face({ eyeSharp: 150 })], sharp: { global: 50, p90: 150, p50: 60, max: 200, cols: 8, rows: 5, tiles: [] } }),
      photo('crisp', { emb: near(a, 0.05), t: 300, faces: [face({ eyeSharp: 1400 })] }),
      photo('blink', { emb: near(a, 0.05), t: 600, faces: [face({ eyeSharp: 1500, blink: [0.9, 0.85] })] }),
    ]
    const { moments, byId } = cull(photos, DEFAULT_SETTINGS)
    expect(moments).toHaveLength(1)
    expect(moments[0].photoIds[0]).toBe('crisp')
    expect(byId.get('crisp')!.verdict).toBe('keep')
    expect(byId.get('crisp')!.reasons[0].text).toBe('Best of 3 similar shots')
    expect(byId.get('blink')!.verdict).toBe('reject')
    expect(byId.get('blink')!.issues).toContain('eyes-closed')
    expect(byId.get('blink')!.reasons[0].text).toContain('eyes closed')
    expect(byId.get('soft')!.verdict).toBe('reject')
    expect(byId.get('soft')!.issues).toContain('soft')
    expect(byId.get('soft')!.reasons[0].text).toMatch(/sharper \(this one is \d+% as sharp\)/)
  })

  it('prefers open eyes over slightly better focus', () => {
    const a = scene()
    const photos = [
      photo('sharpClosed', { emb: near(a, 0.05), t: 0, faces: [face({ eyeSharp: 1500, blink: [0.8, 0.8] })] }),
      photo('openSlightlySoft', { emb: near(a, 0.05), t: 200, faces: [face({ eyeSharp: 1250 })] }),
    ]
    const { byId } = cull(photos, DEFAULT_SETTINGS)
    expect(byId.get('openSlightlySoft')!.verdict).toBe('keep')
    expect(byId.get('sharpClosed')!.verdict).toBe('reject')
  })

  it('rejects a badly blurred single frame unless set to relaxed', () => {
    const photos = Array.from({ length: 6 }, (_, i) => photo(`ok${i}`, { emb: unit(scene()), t: i * 600_000, hash: [i * 7919, i * 104729] }))
    photos.push(
      photo('mush', { emb: unit(scene()), t: 9_000_000, hash: [0x12345678, 0x9abcdef0], sharp: { global: 5, p90: 20, p50: 8, max: 30, cols: 8, rows: 5, tiles: [] } }),
    )
    expect(cull(photos, DEFAULT_SETTINGS).byId.get('mush')!.verdict).toBe('reject')
    const relaxed = cull(photos, { ...DEFAULT_SETTINGS, strictness: 'relaxed' }).byId.get('mush')!
    expect(relaxed.verdict).toBe('keep')
    expect(relaxed.needsLook).toBe(true)
  })

  it('keeps more than one frame per moment when asked, but not a weak second', () => {
    const a = scene()
    const photos = [
      photo('p1', { emb: near(a, 0.05), t: 0, faces: [face({ eyeSharp: 1400 })] }),
      photo('p2', { emb: near(a, 0.05), t: 300, faces: [face({ eyeSharp: 1350 })] }),
      photo('p3', { emb: near(a, 0.05), t: 600, faces: [face({ eyeSharp: 90 })], sharp: { global: 30, p90: 80, p50: 30, max: 100, cols: 8, rows: 5, tiles: [] } }),
    ]
    const two = cull(photos, { ...DEFAULT_SETTINGS, picksPerMoment: 2 }).byId
    expect([two.get('p1')!.verdict, two.get('p2')!.verdict]).toEqual(['keep', 'keep'])
    const three = cull(photos, { ...DEFAULT_SETTINGS, picksPerMoment: 3 }).byId
    expect(three.get('p3')!.verdict).toBe('reject')
  })

  it('flags blown highlights with a readable reason', () => {
    const photos = [photo('hot', { emb: unit(scene()), t: 0, exposure: { mean: 210, p02: 60, p98: 255, clipHigh: 0.14, clipLow: 0, histogram: [] } })]
    const a = cull(photos, DEFAULT_SETTINGS).byId.get('hot')!
    expect(a.issues).toContain('overexposed')
    expect(a.reasons.map((r) => r.text)).toContain('Blown highlights (14% of the frame)')
  })

  it('ignores small background faces when judging blinks', () => {
    const faces = [face({ area: 0.06 }), face({ area: 0.002, blink: [0.9, 0.9] })]
    expect(subjectFaces(faces)).toHaveLength(1)
  })

  it('marks close calls for a human look', () => {
    const a = scene()
    const photos = [
      photo('c1', { emb: near(a, 0.05), t: 0, faces: [face({ eyeSharp: 1000 })] }),
      photo('c2', { emb: near(a, 0.05), t: 300, faces: [face({ eyeSharp: 990 })] }),
    ]
    const { byId } = cull(photos, DEFAULT_SETTINGS)
    expect(byId.get('c1')!.needsLook || byId.get('c2')!.needsLook).toBe(true)
  })
})
