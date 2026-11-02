import { describe, expect, it } from 'vitest'
import { dHash, hamming } from './dhash'
import { exposureStats } from './exposure'
import { lumaFromRgba, resampleArea, type Luma } from './luma'
import { laplacianVariance, regionSharpness, tileSharpness } from './sharpness'

function pattern(w: number, h: number, f: (x: number, y: number) => number): Luma {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y)
  return { data, width: w, height: h }
}

function boxBlur(l: Luma, r: number): Luma {
  const out = new Float32Array(l.data.length)
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) {
      let s = 0
      let n = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(l.width - 1, Math.max(0, x + dx))
          const yy = Math.min(l.height - 1, Math.max(0, y + dy))
          s += l.data[yy * l.width + xx]
          n++
        }
      }
      out[y * l.width + x] = s / n
    }
  }
  return { data: out, width: l.width, height: l.height }
}

const scene = (w: number, h: number) =>
  pattern(w, h, (x, y) => 128 + 90 * Math.sign(Math.sin(x / 3.1) * Math.cos(y / 4.7)) + 20 * Math.sin((x + y) / 9))

describe('sharpness', () => {
  it('scores a sharp frame above a blurred copy of the same frame', () => {
    const sharp = scene(256, 192)
    const soft = boxBlur(sharp, 2)
    const softer = boxBlur(sharp, 4)
    expect(laplacianVariance(sharp)).toBeGreaterThan(laplacianVariance(soft) * 3)
    expect(laplacianVariance(soft)).toBeGreaterThan(laplacianVariance(softer))
  })

  it('tracks the in-focus subject even when most of the frame is bokeh', () => {
    const subject = scene(512, 384)
    const bokeh = boxBlur(subject, 6)
    // Paste a sharp 128x128 subject into the blurred frame.
    const mixed = pattern(512, 384, (x, y) =>
      x >= 192 && x < 320 && y >= 128 && y < 256 ? subject.data[y * 512 + x] : bokeh.data[y * 512 + x],
    )
    const allSoft = tileSharpness(bokeh, 64)
    const withSubject = tileSharpness(mixed, 64)
    expect(withSubject.max).toBeGreaterThan(allSoft.max * 5)
    expect(withSubject.cols).toBe(8)
    expect(withSubject.rows).toBe(6)
  })

  it('compares regions at a normalized scale', () => {
    const face = scene(400, 400)
    expect(regionSharpness(face, 128)).toBeGreaterThan(regionSharpness(boxBlur(face, 3), 128))
    expect(regionSharpness(pattern(4, 4, () => 1), 128)).toBe(0)
  })
})

describe('dHash', () => {
  it('is stable for near duplicates and far apart for different scenes', () => {
    const a = scene(320, 240)
    const brighter = pattern(320, 240, (x, y) => Math.min(255, a.data[y * 320 + x] * 1.05 + 4))
    const other = pattern(320, 240, (x, y) => 128 + 100 * Math.sin(y / 30) * Math.cos(x / 50))
    expect(hamming(dHash(a), dHash(a))).toBe(0)
    expect(hamming(dHash(a), dHash(brighter))).toBeLessThanOrEqual(6)
    expect(hamming(dHash(a), dHash(other))).toBeGreaterThan(16)
  })
})

describe('exposure', () => {
  it('flags blown highlights and crushed shadows', () => {
    const w = 10
    const h = 10
    const bright = new Uint8ClampedArray(w * h * 4).fill(255)
    const dark = new Uint8ClampedArray(w * h * 4)
    for (let i = 3; i < dark.length; i += 4) dark[i] = 255
    const b = exposureStats(bright, w, h)
    const d = exposureStats(dark, w, h)
    expect(b.clipHigh).toBe(1)
    expect(b.mean).toBeCloseTo(255, 0)
    expect(d.clipLow).toBe(1)
    expect(d.mean).toBe(0)
    expect(b.histogram).toHaveLength(32)
    expect(Math.max(...b.histogram)).toBe(1)
  })
})

describe('luma helpers', () => {
  it('converts rgba and downsamples by averaging', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255])
    const l = lumaFromRgba(rgba, 4, 1)
    expect(l.data[0]).toBeCloseTo(255)
    const half = resampleArea(l, 2, 1)
    expect(half.data[0]).toBeCloseTo(127.5)
  })
})
