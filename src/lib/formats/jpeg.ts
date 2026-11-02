import { startsWith, u16 } from './bytes'

export interface JpegInfo {
  /** SOF marker byte: 0xC0 baseline, 0xC1 extended, 0xC2 progressive, 0xC3 lossless... */
  sof: number
  width: number
  height: number
  /** Offset of the TIFF header inside an APP1 "Exif" segment, relative to the JPEG start. */
  exifTiffOffset: number | null
  exifLength: number
  /** Byte length up to and including EOI, when the scan reached it. */
  length: number | null
}

const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8])

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/** Browsers can decode baseline, extended sequential and progressive JPEGs. */
export function isDisplayableSof(sof: number): boolean {
  return sof === 0xc0 || sof === 0xc1 || sof === 0xc2
}

/**
 * Walks JPEG markers starting at `start` (which must point at FFD8).
 * With `findEnd`, it also skips through entropy-coded data to locate EOI,
 * which is needed when a JPEG is embedded in a RAW file without a length.
 */
export function parseJpeg(b: Uint8Array, start = 0, findEnd = false): JpegInfo | null {
  if (b[start] !== 0xff || b[start + 1] !== 0xd8) return null
  const info: JpegInfo = { sof: -1, width: 0, height: 0, exifTiffOffset: null, exifLength: 0, length: null }
  let p = start + 2
  while (p < b.length) {
    if (b[p] !== 0xff) {
      // Not at a marker; corrupt or truncated header.
      return info.sof >= 0 ? info : null
    }
    while (p < b.length && b[p] === 0xff) p++
    if (p >= b.length) break
    const marker = b[p]
    p++
    if (marker === 0xd9) {
      info.length = p - start
      return info
    }
    if (STANDALONE.has(marker)) continue
    if (p + 2 > b.length) break
    const segLen = u16(b, p, false)
    if (segLen < 2) return info.sof >= 0 ? info : null
    const body = p + 2
    if (isSof(marker) && info.sof < 0 && body + 5 <= b.length) {
      info.sof = marker
      info.height = u16(b, body + 1, false)
      info.width = u16(b, body + 3, false)
      if (!findEnd) return info
    } else if (marker === 0xe1 && info.exifTiffOffset === null && startsWith(b, body, 'Exif\0\0')) {
      info.exifTiffOffset = body + 6 - start
      info.exifLength = segLen - 8
    }
    p += segLen
    if (marker === 0xda) {
      // Entropy-coded data: skip until a marker that is not stuffing or a restart.
      while (p + 1 < b.length) {
        if (b[p] === 0xff) {
          const next = b[p + 1]
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break
          p += next === 0xff ? 1 : 2
        } else {
          p++
        }
      }
      if (!findEnd && info.sof >= 0) return info
    }
  }
  return info.sof >= 0 ? info : null
}

/**
 * Returns a copy of a JPEG without its APP1 Exif segment. RAW previews are
 * oriented using the RAW file's own orientation tag, so an embedded Exif
 * orientation must not be applied a second time by the browser decoder.
 */
export function stripExif(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  let p = 2
  let copyFrom = 2
  let changed = false
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (STANDALONE.has(marker)) {
      p += 2
      continue
    }
    const segLen = u16(b, p + 2, false)
    const isExif = marker === 0xe1 && startsWith(b, p + 4, 'Exif\0\0')
    if (isExif) {
      parts.push(b.subarray(copyFrom, p))
      copyFrom = p + 2 + segLen
      changed = true
    }
    p += 2 + segLen
  }
  if (!changed) return b
  parts.push(b.subarray(copyFrom))
  const total = parts.reduce((n, part) => n + part.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}

/**
 * Finds every JPEG start marker (FFD8FF) in a buffer. Used as a last resort
 * for RAW formats whose preview location is not described by a TIFF tag.
 */
export function findJpegStarts(b: Uint8Array, from = 0, limit = 64): number[] {
  const out: number[] = []
  for (let i = from; i + 2 < b.length && out.length < limit; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) out.push(i)
  }
  return out
}
