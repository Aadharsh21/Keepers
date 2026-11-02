import { CachedSource, startsWith, u32, type ByteSource } from './bytes'
import { brand, readCr3 } from './bmff'
import { findJpegStarts, isDisplayableSof, parseJpeg } from './jpeg'
import { parseExifDate, readExifMeta, Tag, TiffReader, type ExifMeta } from './tiff'

/**
 * Pulls the largest displayable JPEG preview out of a camera RAW file.
 *
 * Every major RAW format embeds a JPEG rendered by the camera. Decoding the
 * sensor data itself would need a full demosaicing pipeline per camera model;
 * the embedded preview is what culling apps (Photo Mechanic included) show,
 * and it is what the photographer saw on the back of the camera.
 */
export interface RawPreview {
  jpeg: Uint8Array
  width: number
  height: number
  meta: ExifMeta
  /** Where the preview came from, for debugging and the eval report. */
  source: string
}

interface Candidate {
  offset: number
  length: number
  source: string
}

async function probe(src: ByteSource, c: Candidate): Promise<{ width: number; height: number } | null> {
  if (c.length < 512 || c.offset + c.length > src.size) return null
  // Headers sit at the front. 256 KB covers an Exif block with its own thumbnail.
  const head = await src.read(c.offset, Math.min(c.length, 256 * 1024))
  const info = parseJpeg(head, 0, false)
  if (!info || !isDisplayableSof(info.sof) || !info.width || !info.height) return null
  return { width: info.width, height: info.height }
}

async function pickLargest(src: ByteSource, candidates: Candidate[]) {
  let best: { c: Candidate; width: number; height: number } | null = null
  for (const c of candidates) {
    const dims = await probe(src, c)
    if (dims && (!best || dims.width * dims.height > best.width * best.height)) best = { c, ...dims }
  }
  return best
}

async function tiffCandidates(src: ByteSource): Promise<{ candidates: Candidate[]; meta: ExifMeta } | null> {
  const opened = await TiffReader.open(src, 0)
  if (!opened) return null
  const { reader, ifd0 } = opened
  const meta = await readExifMeta(reader, ifd0)
  const candidates: Candidate[] = []
  const ifds = await reader.allIfds(ifd0)
  for (const [i, ifd] of ifds.entries()) {
    const e = ifd.entries
    const jOff = await reader.number(e.get(Tag.JpegOffset))
    const jLen = await reader.number(e.get(Tag.JpegLength))
    if (jOff && jLen) candidates.push({ offset: reader.base + jOff, length: jLen, source: `ifd${i}:jpeg-tag` })

    // Strip-based JPEGs (Canon CR2 IFD0, DNG preview SubIFDs). Lossless raw
    // data also uses compression 6/7; probe() rejects it by SOF type.
    const compression = await reader.number(e.get(Tag.Compression))
    if (compression === 6 || compression === 7) {
      const offsets = await reader.numbers(e.get(Tag.StripOffsets), 2)
      const counts = await reader.numbers(e.get(Tag.StripByteCounts), 2)
      if (offsets.length === 1 && counts.length === 1 && counts[0] > 0) {
        candidates.push({ offset: reader.base + offsets[0], length: counts[0], source: `ifd${i}:strip` })
      }
    }

    const rw2 = e.get(Tag.Rw2JpgFromRaw)
    if (rw2 && rw2.byteLength > 1024) {
      candidates.push({ offset: rw2.valueOffset, length: rw2.byteLength, source: 'rw2:jpgfromraw' })
    }
  }
  return { candidates, meta }
}

async function cr3Candidates(src: ByteSource): Promise<{ candidates: Candidate[]; meta: ExifMeta }> {
  const parts = await readCr3(src)
  const meta: ExifMeta = {}
  if (parts.cmt1 !== undefined) {
    const opened = await TiffReader.open(src, parts.cmt1)
    if (opened) Object.assign(meta, await readExifMeta(opened.reader, opened.ifd0))
  }
  if (parts.cmt2 !== undefined) {
    // CMT2 is the EXIF IFD on its own, with its own TIFF header.
    const opened = await TiffReader.open(src, parts.cmt2)
    if (opened) {
      const exifIfd = await opened.reader.readIfd(opened.ifd0)
      if (exifIfd) {
        const r = opened.reader
        const dto = await r.text(exifIfd.entries.get(Tag.DateTimeOriginal))
        const sub = await r.text(exifIfd.entries.get(Tag.SubSecTimeOriginal))
        meta.captureTime = parseExifDate(dto, sub) ?? meta.captureTime
        meta.iso = (await r.number(exifIfd.entries.get(Tag.ISO))) ?? meta.iso
        meta.exposureTime = (await r.number(exifIfd.entries.get(Tag.ExposureTime))) ?? meta.exposureTime
        meta.fNumber = (await r.number(exifIfd.entries.get(Tag.FNumber))) ?? meta.fNumber
        meta.focalLength = (await r.number(exifIfd.entries.get(Tag.FocalLength))) ?? meta.focalLength
        meta.lens = (await r.text(exifIfd.entries.get(Tag.LensModel))) ?? meta.lens
      }
    }
  }
  const candidates: Candidate[] = []
  if (parts.preview) candidates.push({ ...parts.preview, source: 'cr3:prvw' })
  if (parts.thumbnail) candidates.push({ ...parts.thumbnail, source: 'cr3:thmb' })
  return { candidates, meta }
}

/** Fujifilm RAF stores the preview offset and length in a fixed header. */
async function rafCandidates(src: ByteSource): Promise<Candidate[]> {
  const h = await src.read(0, 100)
  if (!startsWith(h, 0, 'FUJIFILMCCD-RAW')) return []
  return [{ offset: u32(h, 84, false), length: u32(h, 88, false), source: 'raf:header' }]
}

/** Last resort: scan the first chunk of the file for JPEG start markers. */
async function scanCandidates(src: ByteSource): Promise<Candidate[]> {
  const chunk = await src.read(0, Math.min(src.size, 24 * 1024 * 1024))
  const out: Candidate[] = []
  for (const start of findJpegStarts(chunk, 0, 48)) {
    const info = parseJpeg(chunk, start, true)
    if (info?.length && isDisplayableSof(info.sof)) {
      out.push({ offset: start, length: info.length, source: 'scan' })
    }
  }
  return out
}

export async function extractRawPreview(file: ByteSource): Promise<RawPreview | null> {
  const src = new CachedSource(file)
  let meta: ExifMeta = {}
  let candidates: Candidate[] = []

  const b = await brand(src)
  if (b === 'crx ') {
    ;({ candidates, meta } = await cr3Candidates(src))
  } else {
    const raf = await rafCandidates(src)
    if (raf.length) {
      candidates = raf
      // RAF embeds a regular JPEG with Exif; read metadata from it.
      const head = await src.read(raf[0].offset, 128 * 1024)
      const info = parseJpeg(head, 0, false)
      if (info?.exifTiffOffset != null) {
        const opened = await TiffReader.open(src, raf[0].offset + info.exifTiffOffset)
        if (opened) meta = await readExifMeta(opened.reader, opened.ifd0)
      }
    } else {
      const tiff = await tiffCandidates(src)
      if (tiff) ({ candidates, meta } = tiff)
    }
  }

  let best = await pickLargest(src, candidates)
  // A thumbnail-sized result usually means the real preview lives in a maker
  // note or a format we do not parse. Try the scan before settling.
  if (!best || Math.max(best.width, best.height) < 1000) {
    const scanned = await pickLargest(src, await scanCandidates(src))
    if (scanned && (!best || scanned.width * scanned.height > best.width * best.height)) best = scanned
  }
  if (!best) return null
  const jpeg = await src.read(best.c.offset, best.c.length)
  return { jpeg, width: best.width, height: best.height, meta, source: best.c.source }
}
