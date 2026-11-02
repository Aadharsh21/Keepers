export interface ExposureStats {
  /** Mean luminance, 0..255. */
  mean: number
  p02: number
  p98: number
  /** Share of pixels with any channel at or near 255: blown highlights. */
  clipHigh: number
  /** Share of pixels that are near black: crushed shadows. */
  clipLow: number
  /** 32-bin luminance histogram, normalized to the tallest bin. For the UI. */
  histogram: number[]
}

export function exposureStats(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): ExposureStats {
  const n = width * height
  const hist = new Uint32Array(256)
  let sum = 0
  let high = 0
  let low = 0
  for (let p = 0; p < n * 4; p += 4) {
    const r = rgba[p]
    const g = rgba[p + 1]
    const b = rgba[p + 2]
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    hist[y]++
    sum += y
    if (r >= 252 || g >= 252 || b >= 252) high++
    if (y <= 4) low++
  }
  const at = (q: number) => {
    const target = q * n
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += hist[i]
      if (acc >= target) return i
    }
    return 255
  }
  const bins = new Array<number>(32).fill(0)
  for (let i = 0; i < 256; i++) bins[i >> 3] += hist[i]
  const peak = Math.max(1, ...bins)
  return {
    mean: n ? sum / n : 0,
    p02: at(0.02),
    p98: at(0.98),
    clipHigh: n ? high / n : 0,
    clipLow: n ? low / n : 0,
    histogram: bins.map((v) => Math.round((v / peak) * 1000) / 1000),
  }
}
