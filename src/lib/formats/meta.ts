import { CachedSource, u32, type ByteSource } from './bytes'
import { readHeifExif } from './bmff'
import { parseJpeg } from './jpeg'
import { readExifMeta, TiffReader, type ExifMeta } from './tiff'

export async function readJpegMeta(file: ByteSource): Promise<ExifMeta & { width?: number; height?: number }> {
  const src = new CachedSource(file)
  const head = await src.read(0, 256 * 1024)
  const info = parseJpeg(head, 0, false)
  if (!info) return {}
  let meta: ExifMeta = {}
  if (info.exifTiffOffset !== null) {
    const opened = await TiffReader.open(src, info.exifTiffOffset)
    if (opened) meta = await readExifMeta(opened.reader, opened.ifd0)
  }
  return { ...meta, width: info.width || undefined, height: info.height || undefined }
}

export async function readHeicMeta(file: ByteSource): Promise<ExifMeta> {
  const src = new CachedSource(file, 512 * 1024)
  const exif = await readHeifExif(src)
  if (!exif) return {}
  const opened = await TiffReader.open(src, exif.offset)
  if (!opened) return {}
  return readExifMeta(opened.reader, opened.ifd0)
}

export async function readPngSize(file: ByteSource): Promise<{ width: number; height: number } | null> {
  const h = await file.read(0, 24)
  if (h.length < 24 || h[1] !== 0x50 || h[2] !== 0x4e || h[3] !== 0x47) return null
  return { width: u32(h, 16, false), height: u32(h, 20, false) }
}
