import { ascii, u16, u32, type ByteSource } from './bytes'

/**
 * Minimal ISO base media file format (MP4 box) reader. Canon CR3 and HEIC
 * are both built on it.
 */
export interface Box {
  type: string
  /** Absolute offset of the box header. */
  start: number
  /** Absolute offset of the box payload. */
  body: number
  /** Absolute end offset. */
  end: number
  /** 16-byte extended type for 'uuid' boxes, as hex. */
  uuid?: string
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export async function readBoxes(src: ByteSource, start: number, end: number, limit = 256): Promise<Box[]> {
  const out: Box[] = []
  let p = start
  while (p + 8 <= end && out.length < limit) {
    const h = await src.read(p, 32)
    if (h.length < 8) break
    let size = u32(h, 0, false)
    const type = ascii(h, 4, 4)
    let headerLen = 8
    if (size === 1) {
      // 64-bit size. Files under 4 GB keep the high word at zero.
      size = u32(h, 8, false) * 2 ** 32 + u32(h, 12, false)
      headerLen = 16
    } else if (size === 0) {
      size = end - p
    }
    if (size < headerLen || p + size > end + 8) break
    const box: Box = { type, start: p, body: p + headerLen, end: Math.min(end, p + size) }
    if (type === 'uuid') {
      box.uuid = hex(h.subarray(headerLen, headerLen + 16))
      box.body += 16
    }
    out.push(box)
    p += size
  }
  return out
}

export async function brand(src: ByteSource): Promise<string | null> {
  const h = await src.read(0, 12)
  if (h.length < 12 || ascii(h, 4, 4) !== 'ftyp') return null
  return ascii(h, 8, 4)
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avif'])

export function isHeifBrand(b: string | null): boolean {
  return b !== null && HEIF_BRANDS.has(b)
}

// Canon CR3 layout (documented by the community, e.g. lclevy/canon_cr3):
//   moov > uuid 85c0b687... > CMT1 (IFD0 TIFF), CMT2 (EXIF TIFF), THMB (thumbnail)
//   uuid eaf42b5e... > PRVW (1620x1080 JPEG preview)
const CR3_MOOV_UUID = '85c0b687820f11e08111f4ce462b6a48'
const CR3_PREVIEW_UUID = 'eaf42b5e1c984b88b9fbb7dc406e4d16'

export interface Cr3Parts {
  /** Absolute offsets of TIFF blocks with camera metadata. */
  cmt1?: number
  cmt2?: number
  preview?: { offset: number; length: number }
  thumbnail?: { offset: number; length: number }
}

export async function readCr3(src: ByteSource): Promise<Cr3Parts> {
  const parts: Cr3Parts = {}
  const top = await readBoxes(src, 0, src.size, 32)
  for (const box of top) {
    if (box.type === 'moov') {
      for (const inner of await readBoxes(src, box.body, box.end)) {
        if (inner.type !== 'uuid' || inner.uuid !== CR3_MOOV_UUID) continue
        for (const c of await readBoxes(src, inner.body, inner.end)) {
          if (c.type === 'CMT1') parts.cmt1 = c.body
          if (c.type === 'CMT2') parts.cmt2 = c.body
          if (c.type === 'THMB') {
            // THMB: version/flags(4) width(2) height(2) jpegSize(4) unknown(4) then JPEG
            const h = await src.read(c.body, 16)
            const length = u32(h, 8, false)
            parts.thumbnail = { offset: c.body + 16, length }
          }
        }
      }
    }
    if (box.type === 'uuid' && box.uuid === CR3_PREVIEW_UUID) {
      // Payload: 8 unknown bytes, then a PRVW box.
      for (const c of await readBoxes(src, box.body + 8, box.end)) {
        if (c.type !== 'PRVW') continue
        // PRVW: unknown(4) unknown(2) width(2) height(2) unknown(2) jpegSize(4) then JPEG
        const h = await src.read(c.body, 16)
        const length = u32(h, 12, false)
        parts.preview = { offset: c.body + 16, length }
      }
    }
  }
  return parts
}

/** Finds the Exif item in a HEIF file's meta box, for capture time. */
export async function readHeifExif(src: ByteSource): Promise<{ offset: number; length: number } | null> {
  const top = await readBoxes(src, 0, Math.min(src.size, 1 << 22), 32)
  const meta = top.find((b) => b.type === 'meta')
  if (!meta) return null
  // meta is a FullBox: 4 bytes of version/flags before its children.
  const children = await readBoxes(src, meta.body + 4, meta.end)
  const iinf = children.find((b) => b.type === 'iinf')
  const iloc = children.find((b) => b.type === 'iloc')
  if (!iinf || !iloc) return null

  let exifId = -1
  const iinfHead = await src.read(iinf.body, 8)
  const iinfVersion = iinfHead[0]
  const entriesStart = iinf.body + 4 + (iinfVersion === 0 ? 2 : 4)
  for (const infe of await readBoxes(src, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue
    const b = await src.read(infe.body, 32)
    const version = b[0]
    if (version < 2) continue
    const id = version === 2 ? u16(b, 4, false) : u32(b, 4, false)
    const typeOffset = version === 2 ? 8 : 10
    if (ascii(b, typeOffset, 4) === 'Exif') {
      exifId = id
      break
    }
  }
  if (exifId < 0) return null

  const b = await src.read(iloc.body, Math.min(iloc.end - iloc.body, 64 * 1024))
  const version = b[0]
  const offsetSize = b[4] >> 4
  const lengthSize = b[4] & 15
  const baseOffsetSize = b[5] >> 4
  const indexSize = version === 1 || version === 2 ? b[5] & 15 : 0
  let p = 6
  const count = version < 2 ? u16(b, p, false) : u32(b, p, false)
  p += version < 2 ? 2 : 4
  const readN = (size: number): number => {
    let v = 0
    for (let i = 0; i < size; i++) v = v * 256 + b[p + i]
    p += size
    return v
  }
  for (let i = 0; i < count && p < b.length; i++) {
    const id = version < 2 ? readN(2) : readN(4)
    if (version === 1 || version === 2) p += 2 // construction method
    p += 2 // data reference index
    const baseOffset = readN(baseOffsetSize)
    const extents = readN(2)
    let first: { offset: number; length: number } | null = null
    for (let e = 0; e < extents; e++) {
      if (indexSize) readN(indexSize)
      const off = readN(offsetSize)
      const len = readN(lengthSize)
      if (!first) first = { offset: baseOffset + off, length: len }
    }
    if (id === exifId && first) {
      // Exif item payload starts with a 4-byte offset to the TIFF header.
      const head = await src.read(first.offset, 4)
      const skip = u32(head, 0, false)
      return { offset: first.offset + 4 + skip, length: first.length - 4 - skip }
    }
  }
  return null
}
