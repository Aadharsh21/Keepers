import { resampleArea, type Luma } from './luma'

/**
 * Difference hash (dHash): shrink to 9x8, then record whether each pixel is
 * brighter than its right neighbour. Near-identical frames differ in only a
 * few of the 64 bits. Stored as two 32-bit halves because JS bitwise ops are 32-bit.
 */
export function dHash(l: Luma): [number, number] {
  const s = resampleArea(l, 9, 8)
  let hi = 0
  let lo = 0
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const bit = s.data[y * 9 + x] > s.data[y * 9 + x + 1] ? 1 : 0
      const i = y * 8 + x
      if (i < 32) hi = (hi | (bit << (31 - i))) >>> 0
      else lo = (lo | (bit << (63 - i))) >>> 0
    }
  }
  return [hi, lo]
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function hamming(a: [number, number], b: [number, number]): number {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0)
}
