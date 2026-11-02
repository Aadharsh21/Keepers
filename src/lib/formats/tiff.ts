import { ascii, u16, u32, type ByteSource } from './bytes'

/** Tags Keeper reads. Names follow the TIFF/EP and EXIF specs. */
export const Tag = {
  NewSubfileType: 0x00fe,
  ImageWidth: 0x0100,
  ImageLength: 0x0101,
  Compression: 0x0103,
  Make: 0x010f,
  Model: 0x0110,
  StripOffsets: 0x0111,
  Orientation: 0x0112,
  StripByteCounts: 0x0117,
  DateTime: 0x0132,
  SubIFDs: 0x014a,
  JpegOffset: 0x0201,
  JpegLength: 0x0202,
  ExifIFD: 0x8769,
  ExposureTime: 0x829a,
  FNumber: 0x829d,
  ISO: 0x8827,
  DateTimeOriginal: 0x9003,
  FocalLength: 0x920a,
  SubSecTimeOriginal: 0x9291,
  LensModel: 0xa434,
  /** Panasonic RW2 stores its full JPEG preview in this tag. */
  Rw2JpgFromRaw: 0x002e,
} as const

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 }

export interface TiffEntry {
  tag: number
  type: number
  count: number
  /** Absolute file offset of the value bytes. */
  valueOffset: number
  byteLength: number
}

export interface Ifd {
  offset: number
  entries: Map<number, TiffEntry>
  next: number
}

export class TiffReader {
  readonly src: ByteSource
  readonly base: number
  readonly le: boolean

  private constructor(src: ByteSource, base: number, le: boolean) {
    this.src = src
    this.base = base
    this.le = le
  }

  /** Reads a TIFF header at `base`. Accepts standard TIFF plus ORF ("RO"/"SR") and RW2 (0x55) magics. */
  static async open(src: ByteSource, base = 0): Promise<{ reader: TiffReader; ifd0: number } | null> {
    const h = await src.read(base, 8)
    if (h.length < 8) return null
    let le: boolean
    if (h[0] === 0x49 && h[1] === 0x49) le = true
    else if (h[0] === 0x4d && h[1] === 0x4d) le = false
    else return null
    const magic = u16(h, 2, le)
    if (magic !== 42 && magic !== 0x4f52 && magic !== 0x5352 && magic !== 0x55) return null
    const reader = new TiffReader(src, base, le)
    return { reader, ifd0: u32(h, 4, le) }
  }

  async readIfd(relOffset: number): Promise<Ifd | null> {
    const abs = this.base + relOffset
    if (relOffset <= 0 || abs + 2 > this.src.size) return null
    const countBytes = await this.src.read(abs, 2)
    const count = u16(countBytes, 0, this.le)
    if (count === 0 || count > 1000) return null
    const body = await this.src.read(abs + 2, count * 12 + 4)
    if (body.length < count * 12) return null
    const entries = new Map<number, TiffEntry>()
    for (let i = 0; i < count; i++) {
      const o = i * 12
      const tag = u16(body, o, this.le)
      const type = u16(body, o + 2, this.le)
      const n = u32(body, o + 4, this.le)
      const size = (TYPE_SIZE[type] ?? 1) * n
      const valueOffset = size <= 4 ? abs + 2 + o + 8 : this.base + u32(body, o + 8, this.le)
      entries.set(tag, { tag, type, count: n, valueOffset, byteLength: size })
    }
    const next = body.length >= count * 12 + 4 ? u32(body, count * 12, this.le) : 0
    return { offset: relOffset, entries, next }
  }

  async numbers(entry: TiffEntry | undefined, max = 64): Promise<number[]> {
    if (!entry) return []
    const n = Math.min(entry.count, max)
    const size = TYPE_SIZE[entry.type] ?? 1
    const b = await this.src.read(entry.valueOffset, n * size)
    const out: number[] = []
    for (let i = 0; i < n && (i + 1) * size <= b.length; i++) {
      const o = i * size
      switch (entry.type) {
        case 1:
        case 7:
          out.push(b[o])
          break
        case 3:
          out.push(u16(b, o, this.le))
          break
        case 4:
        case 13:
          out.push(u32(b, o, this.le))
          break
        case 5: {
          const den = u32(b, o + 4, this.le)
          out.push(den ? u32(b, o, this.le) / den : 0)
          break
        }
        case 10: {
          const num = u32(b, o, this.le) | 0
          const den = u32(b, o + 4, this.le) | 0
          out.push(den ? num / den : 0)
          break
        }
        default:
          out.push(b[o])
      }
    }
    return out
  }

  async number(entry: TiffEntry | undefined): Promise<number | undefined> {
    const v = await this.numbers(entry, 1)
    return v[0]
  }

  async text(entry: TiffEntry | undefined): Promise<string | undefined> {
    if (!entry || entry.type !== 2) return undefined
    const b = await this.src.read(entry.valueOffset, Math.min(entry.count, 256))
    const s = ascii(b, 0, b.length).trim()
    return s || undefined
  }

  /** Walks IFD0, its chain (IFD1...), and every SubIFD, depth first. */
  async allIfds(ifd0: number, limit = 24): Promise<Ifd[]> {
    const out: Ifd[] = []
    const seen = new Set<number>()
    const queue: number[] = [ifd0]
    while (queue.length && out.length < limit) {
      const off = queue.shift()!
      if (!off || seen.has(off)) continue
      seen.add(off)
      const ifd = await this.readIfd(off)
      if (!ifd) continue
      out.push(ifd)
      const subs = ifd.entries.get(Tag.SubIFDs)
      if (subs) {
        // SubIFD entries may be typed LONG or IFD (13); both hold offsets.
        for (const s of await this.numbers({ ...subs, type: subs.type === 13 ? 4 : subs.type }, 8)) {
          queue.push(s)
        }
      }
      if (ifd.next) queue.push(ifd.next)
    }
    return out
  }
}

export interface ExifMeta {
  make?: string
  model?: string
  lens?: string
  orientation?: number
  /** Milliseconds, treating the camera clock as UTC. Only relative order matters. */
  captureTime?: number
  iso?: number
  exposureTime?: number
  fNumber?: number
  focalLength?: number
}

export function parseExifDate(dt: string | undefined, subsec?: string): number | undefined {
  if (!dt) return undefined
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dt)
  if (!m) return undefined
  const [, y, mo, d, h, mi, s] = m.map(Number)
  if (!y || !mo || !d) return undefined
  let ms = Date.UTC(y, mo - 1, d, h, mi, s)
  if (subsec && /^\d+$/.test(subsec.trim())) {
    const frac = subsec.trim()
    ms += Math.round(Number(`0.${frac}`) * 1000)
  }
  return Number.isFinite(ms) ? ms : undefined
}

/** Reads the camera metadata Keeper shows and uses for ordering bursts. */
export async function readExifMeta(reader: TiffReader, ifd0Offset: number): Promise<ExifMeta> {
  const meta: ExifMeta = {}
  const ifd0 = await reader.readIfd(ifd0Offset)
  if (!ifd0) return meta
  meta.make = await reader.text(ifd0.entries.get(Tag.Make))
  meta.model = await reader.text(ifd0.entries.get(Tag.Model))
  meta.orientation = await reader.number(ifd0.entries.get(Tag.Orientation))
  let dateTime = await reader.text(ifd0.entries.get(Tag.DateTime))
  const exifPtr = await reader.number(ifd0.entries.get(Tag.ExifIFD))
  let subsec: string | undefined
  if (exifPtr) {
    const exif = await reader.readIfd(exifPtr)
    if (exif) {
      dateTime = (await reader.text(exif.entries.get(Tag.DateTimeOriginal))) ?? dateTime
      subsec = await reader.text(exif.entries.get(Tag.SubSecTimeOriginal))
      meta.iso = await reader.number(exif.entries.get(Tag.ISO))
      meta.exposureTime = await reader.number(exif.entries.get(Tag.ExposureTime))
      meta.fNumber = await reader.number(exif.entries.get(Tag.FNumber))
      meta.focalLength = await reader.number(exif.entries.get(Tag.FocalLength))
      meta.lens = await reader.text(exif.entries.get(Tag.LensModel))
    }
  }
  meta.captureTime = parseExifDate(dateTime, subsec)
  if (meta.orientation !== undefined && (meta.orientation < 1 || meta.orientation > 8)) meta.orientation = 1
  return meta
}
