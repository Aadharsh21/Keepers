import { blobSource } from '../formats/bytes'
import type { PhotoKind } from '../formats/detect'
import { stripExif } from '../formats/jpeg'
import { readHeicMeta, readJpegMeta, readPngSize } from '../formats/meta'
import { extractRawPreview } from '../formats/raw'
import type { ExifMeta } from '../formats/tiff'

export interface Decoded {
  /** Upright bitmap, long edge at most maxLong. */
  bitmap: ImageBitmap
  /** Upright size of the full-resolution source. */
  width: number
  height: number
  meta: ExifMeta
  previewSource?: string
}

export class DecodeError extends Error {
  readonly code: 'unsupported' | 'corrupt' | 'no-preview'
  constructor(code: 'unsupported' | 'corrupt' | 'no-preview', message: string) {
    super(message)
    this.code = code
  }
}

function fit(width: number, height: number, maxLong: number): { w: number; h: number } {
  const scale = Math.min(1, maxLong / Math.max(width, height))
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

/** Applies an EXIF orientation (1..8) by drawing onto a canvas. */
export function orient(bitmap: ImageBitmap, orientation = 1): ImageBitmap {
  if (orientation <= 1 || orientation > 8) return bitmap
  const w = bitmap.width
  const h = bitmap.height
  const swap = orientation >= 5
  const canvas = new OffscreenCanvas(swap ? h : w, swap ? w : h)
  const ctx = canvas.getContext('2d')!
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, h, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, h, w)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, w)
      break
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas.transferToImageBitmap()
}

/** Downscales a bitmap if needed. */
async function shrink(bitmap: ImageBitmap, maxLong: number): Promise<ImageBitmap> {
  if (Math.max(bitmap.width, bitmap.height) <= maxLong) return bitmap
  const { w, h } = fit(bitmap.width, bitmap.height, maxLong)
  const out = await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
  bitmap.close()
  return out
}

/**
 * Decodes an image that the browser understands, resizing during decode.
 * `uprightWidth/Height` are the dimensions after EXIF orientation. Browsers
 * apply orientation before resizing, but we verify and repair either way.
 */
async function decodeNative(
  blob: Blob,
  uprightWidth: number | undefined,
  uprightHeight: number | undefined,
  maxLong: number,
): Promise<ImageBitmap> {
  if (!uprightWidth || !uprightHeight) {
    return shrink(await createImageBitmap(blob, { imageOrientation: 'from-image' }), maxLong)
  }
  const { w, h } = fit(uprightWidth, uprightHeight, maxLong)
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
  })
  const expectedPortrait = uprightHeight > uprightWidth
  const gotPortrait = bitmap.height > bitmap.width
  if (uprightWidth !== uprightHeight && expectedPortrait !== gotPortrait) {
    // The engine resized before rotating, so the aspect ratio is wrong. Decode again without a target size.
    bitmap.close()
    return shrink(await createImageBitmap(blob, { imageOrientation: 'from-image' }), maxLong)
  }
  return bitmap
}

let libheif: Promise<import('libheif-js/libheif-wasm/libheif-bundle.mjs').LibHeif> | null = null

/** HEIC fallback for browsers without native support. Loaded only when a HEIC file shows up. */
async function decodeHeifWithLibheif(file: Blob, maxLong: number): Promise<ImageBitmap> {
  libheif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default())
  const lib = await libheif
  const decoder = new lib.HeifDecoder()
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()))
  if (!images?.length) throw new DecodeError('corrupt', 'This HEIC file has no image in it.')
  const image = images[0]
  const data = new ImageData(image.get_width(), image.get_height())
  await new Promise<void>((resolve, reject) => {
    image.display(data, (result) => (result ? resolve() : reject(new DecodeError('corrupt', 'Could not decode this HEIC file.'))))
  })
  for (const img of images) img.free?.()
  return shrink(await createImageBitmap(data), maxLong)
}

export async function decodePhoto(file: Blob, kind: PhotoKind, maxLong: number): Promise<Decoded> {
  const src = blobSource(file)
  switch (kind) {
    case 'jpeg': {
      const meta = await readJpegMeta(src)
      if (!meta.width || !meta.height) throw new DecodeError('corrupt', 'This JPEG is damaged or incomplete.')
      const swap = (meta.orientation ?? 1) >= 5
      const width = swap ? meta.height : meta.width
      const height = swap ? meta.width : meta.height
      const bitmap = await decodeNative(file, width, height, maxLong)
      return { bitmap, width, height, meta }
    }
    case 'png': {
      const size = await readPngSize(src)
      const bitmap = await decodeNative(file, size?.width, size?.height, maxLong)
      return { bitmap, width: size?.width ?? bitmap.width, height: size?.height ?? bitmap.height, meta: {} }
    }
    case 'webp': {
      const bitmap = await decodeNative(file, undefined, undefined, maxLong)
      return { bitmap, width: bitmap.width, height: bitmap.height, meta: {} }
    }
    case 'heic': {
      const meta = await readHeicMeta(src)
      let bitmap: ImageBitmap
      try {
        // Safari decodes HEIC natively and applies the container's rotation.
        bitmap = await shrink(await createImageBitmap(file, { imageOrientation: 'from-image' }), maxLong)
      } catch {
        bitmap = await decodeHeifWithLibheif(file, maxLong)
      }
      return { bitmap, width: bitmap.width, height: bitmap.height, meta }
    }
    case 'raw': {
      const preview = await extractRawPreview(src)
      if (!preview) throw new DecodeError('no-preview', 'No preview image was found inside this RAW file.')
      const jpeg = stripExif(preview.jpeg)
      const blob = new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })
      const { w, h } = fit(preview.width, preview.height, maxLong)
      let bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      const o = preview.meta.orientation ?? 1
      bitmap = orient(bitmap, o)
      const swap = o >= 5
      return {
        bitmap,
        width: swap ? preview.height : preview.width,
        height: swap ? preview.width : preview.height,
        meta: preview.meta,
        previewSource: preview.source,
      }
    }
  }
}

/** Reads pixels of the whole bitmap at a smaller size. */
export function readPixels(bitmap: ImageBitmap, maxLong: number): { rgba: Uint8ClampedArray; width: number; height: number } {
  const { w, h } = fit(bitmap.width, bitmap.height, maxLong)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { rgba: ctx.getImageData(0, 0, w, h).data, width: w, height: h }
}

/** Reads a region of the bitmap at full bitmap resolution (for face and eye focus). */
export function readRegion(
  bitmap: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const cw = Math.max(1, Math.min(bitmap.width - x0, Math.ceil(w)))
  const ch = Math.max(1, Math.min(bitmap.height - y0, Math.ceil(h)))
  const canvas = new OffscreenCanvas(cw, ch)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, x0, y0, cw, ch, 0, 0, cw, ch)
  return { rgba: ctx.getImageData(0, 0, cw, ch).data, width: cw, height: ch }
}

export async function encodeJpeg(bitmap: ImageBitmap, maxLong: number, quality: number): Promise<Blob> {
  const { w, h } = fit(bitmap.width, bitmap.height, maxLong)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}
