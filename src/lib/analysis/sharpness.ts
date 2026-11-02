import { resampleArea, type Luma } from './luma'

/**
 * Variance of the Laplacian: the classic focus measure (Pech-Pacheco et al.,
 * 2000). Sharp edges give strong second derivatives and a high variance;
 * defocus and motion blur flatten them.
 */
export function laplacianVariance(l: Luma, x0 = 0, y0 = 0, x1 = l.width, y1 = l.height): number {
  const w = l.width
  const d = l.data
  const xs = Math.max(1, x0)
  const ys = Math.max(1, y0)
  const xe = Math.min(w - 1, x1)
  const ye = Math.min(l.height - 1, y1)
  let n = 0
  let sum = 0
  let sumSq = 0
  for (let y = ys; y < ye; y++) {
    const row = y * w
    for (let x = xs; x < xe; x++) {
      const i = row + x
      const v = d[i - w] + d[i + w] + d[i - 1] + d[i + 1] - 4 * d[i]
      sum += v
      sumSq += v * v
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

export interface SharpnessStats {
  /** Whole-frame variance of the Laplacian. */
  global: number
  /** 90th percentile tile: the in-focus subject, ignoring creamy backgrounds. */
  p90: number
  /** Median tile. */
  p50: number
  max: number
  /** Tile grid, row-major, for the focus map overlay. */
  tiles: number[]
  cols: number
  rows: number
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[i]
}

/**
 * Splits the frame into tiles and measures each one. A portrait at f/1.8 has
 * a sharp face and a blurred background, so a whole-frame score would call it
 * soft. The high percentile tile tracks the subject instead.
 */
export function tileSharpness(l: Luma, tileSize = 128): SharpnessStats {
  const cols = Math.max(1, Math.round(l.width / tileSize))
  const rows = Math.max(1, Math.round(l.height / tileSize))
  const tw = l.width / cols
  const th = l.height / rows
  const tiles: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(
        laplacianVariance(l, Math.floor(c * tw), Math.floor(r * th), Math.floor((c + 1) * tw), Math.floor((r + 1) * th)),
      )
    }
  }
  const sorted = [...tiles].sort((a, b) => a - b)
  return {
    global: laplacianVariance(l),
    p90: percentile(sorted, 0.9),
    p50: percentile(sorted, 0.5),
    max: sorted[sorted.length - 1] ?? 0,
    tiles,
    cols,
    rows,
  }
}

/**
 * Sharpness of a region (face or eyes) at a normalized scale, so a face shot
 * from slightly further away in the next frame is still compared fairly.
 */
export function regionSharpness(region: Luma, targetWidth: number): number {
  if (region.width < 8 || region.height < 8) return 0
  const scaled =
    region.width > targetWidth
      ? resampleArea(region, targetWidth, Math.max(8, Math.round((region.height * targetWidth) / region.width)))
      : region
  return laplacianVariance(scaled)
}
