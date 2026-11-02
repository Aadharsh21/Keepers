import { describe, expect, it } from 'vitest'
import { box, buildTiff, concat, fakeJpeg, text, uuidBox, be16, be32, type IfdSpec } from '../../test/builders'
import { bytesSource } from './bytes'
import { baseNameOf, kindOf } from './detect'
import { parseJpeg, stripExif } from './jpeg'
import { readHeicMeta, readJpegMeta } from './meta'
import { extractRawPreview } from './raw'
import { parseExifDate, Tag } from './tiff'

const exifIfd = (): IfdSpec => ({
  entries: [
    { tag: Tag.DateTimeOriginal, v: { kind: 'ascii', value: '2026:06:14 17:02:09' } },
    { tag: Tag.SubSecTimeOriginal, v: { kind: 'ascii', value: '25' } },
    { tag: Tag.ISO, v: { kind: 'short', value: [800] } },
    { tag: Tag.FNumber, v: { kind: 'rational', value: [[18, 10]] } },
    { tag: Tag.ExposureTime, v: { kind: 'rational', value: [[1, 250]] } },
  ],
})

describe('parseExifDate', () => {
  it('parses date with sub-seconds', () => {
    expect(parseExifDate('2026:06:14 17:02:09', '25')).toBe(Date.UTC(2026, 5, 14, 17, 2, 9) + 250)
  })
  it('rejects blank camera dates', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeUndefined()
    expect(parseExifDate(undefined)).toBeUndefined()
  })
})

describe('jpeg parsing', () => {
  it('reads dimensions, exif location and end of image', () => {
    const exif = buildTiff({ entries: [{ tag: Tag.Orientation, v: { kind: 'short', value: [6] } }] })
    const jpg = fakeJpeg({ width: 6000, height: 4000, exif })
    const info = parseJpeg(jpg, 0, true)!
    expect(info.width).toBe(6000)
    expect(info.height).toBe(4000)
    expect(info.sof).toBe(0xc0)
    expect(info.length).toBe(jpg.length)
    expect(info.exifTiffOffset).toBe(4 + 2 + 6)
  })

  it('finds the end of a JPEG embedded in other bytes', () => {
    const jpg = fakeJpeg({ width: 1620, height: 1080 })
    const wrapped = concat(new Uint8Array(100), jpg, new Uint8Array(50).fill(0xff))
    expect(parseJpeg(wrapped, 100, true)!.length).toBe(jpg.length)
  })

  it('strips the Exif segment so orientation is not applied twice', () => {
    const exif = buildTiff({ entries: [{ tag: Tag.Orientation, v: { kind: 'short', value: [8] } }] })
    const jpg = fakeJpeg({ width: 100, height: 50, exif })
    const stripped = stripExif(jpg)
    expect(stripped.length).toBeLessThan(jpg.length)
    const info = parseJpeg(stripped, 0, true)!
    expect(info.exifTiffOffset).toBeNull()
    expect(info.width).toBe(100)
    expect(info.length).toBe(stripped.length)
  })
})

describe('JPEG metadata', () => {
  it('reads camera, capture time and orientation from Exif', async () => {
    const exif = buildTiff({
      entries: [
        { tag: Tag.Make, v: { kind: 'ascii', value: 'Canon' } },
        { tag: Tag.Model, v: { kind: 'ascii', value: 'Canon EOS R6' } },
        { tag: Tag.Orientation, v: { kind: 'short', value: [6] } },
        { tag: Tag.ExifIFD, v: { kind: 'ifd', value: [exifIfd()] } },
      ],
    })
    const meta = await readJpegMeta(bytesSource(fakeJpeg({ width: 4000, height: 6000, exif })))
    expect(meta.make).toBe('Canon')
    expect(meta.model).toBe('Canon EOS R6')
    expect(meta.orientation).toBe(6)
    expect(meta.iso).toBe(800)
    expect(meta.fNumber).toBeCloseTo(1.8)
    expect(meta.exposureTime).toBeCloseTo(1 / 250)
    expect(meta.captureTime).toBe(Date.UTC(2026, 5, 14, 17, 2, 9) + 250)
    expect(meta.width).toBe(4000)
  })
})

describe('RAW previews', () => {
  it('picks the largest baseline JPEG and skips lossless raw data (NEF-style SubIFD)', async () => {
    for (const le of [true, false]) {
      const thumb = fakeJpeg({ width: 160, height: 120 })
      const full = fakeJpeg({ width: 6048, height: 4024, payload: 4000 })
      const lossless = fakeJpeg({ width: 6064, height: 4040, sof: 0xc3, payload: 9000 })
      const tiff = buildTiff(
        {
          entries: [
            { tag: Tag.Make, v: { kind: 'ascii', value: 'NIKON CORPORATION' } },
            { tag: Tag.Orientation, v: { kind: 'short', value: [8] } },
            { tag: Tag.JpegOffset, v: { kind: 'blobOffset', value: thumb } },
            { tag: Tag.JpegLength, v: { kind: 'blobLength', value: thumb } },
            {
              tag: Tag.SubIFDs,
              v: {
                kind: 'ifd',
                value: [
                  {
                    entries: [
                      { tag: Tag.JpegOffset, v: { kind: 'blobOffset', value: full } },
                      { tag: Tag.JpegLength, v: { kind: 'blobLength', value: full } },
                    ],
                  },
                  {
                    entries: [
                      { tag: Tag.Compression, v: { kind: 'short', value: [7] } },
                      { tag: Tag.StripOffsets, v: { kind: 'blobOffset', value: lossless } },
                      { tag: Tag.StripByteCounts, v: { kind: 'blobLength', value: lossless } },
                    ],
                  },
                ],
              },
            },
            { tag: Tag.ExifIFD, v: { kind: 'ifd', value: [exifIfd()] } },
          ],
        },
        le,
      )
      const preview = await extractRawPreview(bytesSource(tiff))
      expect(preview).not.toBeNull()
      expect(preview!.width).toBe(6048)
      expect(preview!.height).toBe(4024)
      expect(preview!.jpeg.length).toBe(full.length)
      expect(preview!.meta.orientation).toBe(8)
      expect(preview!.meta.make).toBe('NIKON CORPORATION')
      expect(preview!.meta.captureTime).toBe(Date.UTC(2026, 5, 14, 17, 2, 9) + 250)
    }
  })

  it('reads strip-based previews (CR2-style IFD0 strip)', async () => {
    const full = fakeJpeg({ width: 5472, height: 3648, payload: 3000 })
    const tiff = buildTiff({
      entries: [
        { tag: Tag.Compression, v: { kind: 'short', value: [6] } },
        { tag: Tag.StripOffsets, v: { kind: 'blobOffset', value: full } },
        { tag: Tag.StripByteCounts, v: { kind: 'blobLength', value: full } },
      ],
    })
    const preview = await extractRawPreview(bytesSource(tiff))
    expect(preview?.width).toBe(5472)
    expect(preview?.source).toBe('ifd0:strip')
  })

  it('reads the PRVW preview and metadata from a Canon CR3 container', async () => {
    const cmt1 = buildTiff({
      entries: [
        { tag: Tag.Make, v: { kind: 'ascii', value: 'Canon' } },
        { tag: Tag.Model, v: { kind: 'ascii', value: 'Canon EOS R5' } },
        { tag: Tag.Orientation, v: { kind: 'short', value: [1] } },
      ],
    })
    const cmt2 = buildTiff(exifIfd(), true)
    const thumb = fakeJpeg({ width: 160, height: 120 })
    const prvw = fakeJpeg({ width: 1620, height: 1080, payload: 2000 })
    const thmbBox = box('THMB', new Uint8Array(4), be16(160), be16(120), be32(thumb.length), new Uint8Array(4), thumb)
    const prvwBox = box('PRVW', new Uint8Array(4), be16(1), be16(1620), be16(1080), be16(1), be32(prvw.length), prvw)
    const file = concat(
      box('ftyp', text('crx '), be32(1), text('crx isom')),
      box('moov', uuidBox('85c0b687820f11e08111f4ce462b6a48', box('CMT1', cmt1), box('CMT2', cmt2), thmbBox)),
      uuidBox('eaf42b5e1c984b88b9fbb7dc406e4d16', new Uint8Array(8), prvwBox),
      box('mdat', new Uint8Array(64)),
    )
    const preview = await extractRawPreview(bytesSource(file))
    expect(preview?.source).toBe('cr3:prvw')
    expect(preview?.width).toBe(1620)
    expect(preview?.meta.model).toBe('Canon EOS R5')
    expect(preview?.meta.captureTime).toBe(Date.UTC(2026, 5, 14, 17, 2, 9) + 250)
    expect(preview?.meta.iso).toBe(800)
  })

  it('falls back to scanning when no tag describes the preview', async () => {
    const jpg = fakeJpeg({ width: 3000, height: 2000, payload: 2500 })
    const file = concat(text('XYZRAW00'), new Uint8Array(300), jpg, new Uint8Array(500))
    const preview = await extractRawPreview(bytesSource(file))
    expect(preview?.width).toBe(3000)
    expect(preview?.source).toBe('scan')
  })
})

describe('HEIC metadata', () => {
  it('finds the Exif item through iinf and iloc', async () => {
    const tiff = buildTiff(
      {
        entries: [
          { tag: Tag.Make, v: { kind: 'ascii', value: 'Apple' } },
          { tag: Tag.ExifIFD, v: { kind: 'ifd', value: [exifIfd()] } },
        ],
      },
      false,
    )
    const exifPayload = concat(be32(0), tiff)
    const infe = box('infe', new Uint8Array([2, 0, 0, 0]), be16(7), be16(0), text('Exif'), text('\0'))
    const iinf = box('iinf', new Uint8Array([0, 0, 0, 0]), be16(1), infe)
    const ftyp = box('ftyp', text('heic'), be32(0), text('mif1heic'))
    // iloc v0: offset_size 4, length_size 4, base_offset_size 0, 1 item with 1 extent.
    const ilocFor = (offset: number) =>
      box('iloc', new Uint8Array([0, 0, 0, 0, 0x44, 0x00]), be16(1), be16(7), be16(0), be16(1), be32(offset), be32(exifPayload.length))
    const metaFor = (offset: number) => box('meta', new Uint8Array(4), box('hdlr', new Uint8Array(24)), iinf, ilocFor(offset))
    const exifOffset = ftyp.length + metaFor(0).length + 8
    const file = concat(ftyp, metaFor(exifOffset), box('mdat', exifPayload))
    const meta = await readHeicMeta(bytesSource(file))
    expect(meta.make).toBe('Apple')
    expect(meta.captureTime).toBe(Date.UTC(2026, 5, 14, 17, 2, 9) + 250)
  })
})

describe('file kinds', () => {
  it('classifies by extension', () => {
    expect(kindOf('IMG_0001.CR3')).toBe('raw')
    expect(kindOf('DSC09812.ARW')).toBe('raw')
    expect(kindOf('IMG_0001.HEIC')).toBe('heic')
    expect(kindOf('a.jpeg')).toBe('jpeg')
    expect(kindOf('notes.txt')).toBeNull()
    expect(baseNameOf('Wedding/IMG_0001.CR3')).toBe('IMG_0001')
  })
})
