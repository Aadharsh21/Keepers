/**
 * Builders for tiny synthetic image files. They exercise the parsers with
 * exact, known layouts so tests do not need real camera files in the repo.
 */

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const enc = new TextEncoder()
export const text = (s: string) => enc.encode(s)

function be16(v: number) {
  return new Uint8Array([(v >> 8) & 255, v & 255])
}
function be32(v: number) {
  return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])
}

/** A structurally valid (not decodable) JPEG with the given SOF type and size. */
export function fakeJpeg(opts: { width: number; height: number; sof?: number; exif?: Uint8Array; payload?: number }): Uint8Array {
  const { width, height, sof = 0xc0, exif, payload = 600 } = opts
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])]
  if (exif) {
    const body = concat(text('Exif\0\0'), exif)
    parts.push(new Uint8Array([0xff, 0xe1]), be16(body.length + 2), body)
  }
  // SOF: precision, height, width, 3 components
  const sofBody = concat(new Uint8Array([8]), be16(height), be16(width), new Uint8Array([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]))
  parts.push(new Uint8Array([0xff, sof]), be16(sofBody.length + 2), sofBody)
  // SOS header
  const sosBody = new Uint8Array([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0])
  parts.push(new Uint8Array([0xff, 0xda]), be16(sosBody.length + 2), sosBody)
  // Entropy data with byte stuffing and a restart marker, which must not end the scan.
  const data = new Uint8Array(payload)
  for (let i = 0; i < payload; i++) data[i] = (i * 37) & 0x7f
  data[10] = 0xff
  data[11] = 0x00
  data[20] = 0xff
  data[21] = 0xd3
  parts.push(data, new Uint8Array([0xff, 0xd9]))
  return concat(...parts)
}

type Value =
  | { kind: 'ascii'; value: string }
  | { kind: 'short'; value: number[] }
  | { kind: 'long'; value: number[] }
  | { kind: 'rational'; value: [number, number][] }
  | { kind: 'undefined'; value: Uint8Array }
  | { kind: 'ifd'; value: IfdSpec[] }
  | { kind: 'blobOffset'; value: Uint8Array }
  | { kind: 'blobLength'; value: Uint8Array }

export interface IfdSpec {
  entries: { tag: number; v: Value }[]
  next?: IfdSpec
}

const TYPE: Record<Value['kind'], number> = {
  ascii: 2,
  short: 3,
  long: 4,
  rational: 5,
  undefined: 7,
  ifd: 4,
  blobOffset: 4,
  blobLength: 4,
}

function valueBytes(v: Value, le: boolean, resolve: (x: unknown) => number): Uint8Array {
  const w16 = (n: number) => (le ? new Uint8Array([n & 255, (n >> 8) & 255]) : be16(n))
  const w32 = (n: number) =>
    le ? new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]) : be32(n)
  switch (v.kind) {
    case 'ascii':
      return text(v.value + '\0')
    case 'short':
      return concat(...v.value.map(w16))
    case 'long':
      return concat(...v.value.map(w32))
    case 'rational':
      return concat(...v.value.flatMap(([a, b]) => [w32(a), w32(b)]))
    case 'undefined':
      return v.value
    case 'ifd':
      return concat(...v.value.map((i) => w32(resolve(i))))
    case 'blobOffset':
      return w32(resolve(v.value))
    case 'blobLength':
      return w32(v.value.length)
  }
}

function countOf(v: Value): number {
  switch (v.kind) {
    case 'ascii':
      return v.value.length + 1
    case 'undefined':
      return v.value.length
    case 'ifd':
    case 'short':
    case 'long':
    case 'rational':
      return v.value.length
    default:
      return 1
  }
}

/** Lays out a TIFF: header, every IFD with its out-of-line values, then blobs. */
export function buildTiff(ifd0: IfdSpec, le = true, prefix?: Uint8Array): Uint8Array {
  const ifds: IfdSpec[] = []
  const blobs: Uint8Array[] = []
  const visit = (i: IfdSpec) => {
    if (ifds.includes(i)) return
    ifds.push(i)
    for (const e of i.entries) {
      if (e.v.kind === 'ifd') e.v.value.forEach(visit)
      if (e.v.kind === 'blobOffset' && !blobs.includes(e.v.value)) blobs.push(e.v.value)
    }
    if (i.next) visit(i.next)
  }
  visit(ifd0)

  const offsets = new Map<unknown, number>()
  const headerLen = 8 + (prefix?.length ?? 0)
  let cursor = headerLen
  const sizeOf = (i: IfdSpec) => {
    let extra = 0
    for (const e of i.entries) {
      const len = valueBytes(e.v, le, () => 0).length
      if (len > 4) extra += len + (len & 1)
    }
    return 2 + i.entries.length * 12 + 4 + extra
  }
  for (const i of ifds) {
    offsets.set(i, cursor)
    cursor += sizeOf(i)
  }
  for (const b of blobs) {
    offsets.set(b, cursor)
    cursor += b.length
  }
  const resolve = (x: unknown) => offsets.get(x) ?? 0

  const out = new Uint8Array(cursor)
  const dv = new DataView(out.buffer)
  out[0] = out[1] = le ? 0x49 : 0x4d
  dv.setUint16(2, 42, le)
  dv.setUint32(4, offsets.get(ifd0)!, le)
  if (prefix) out.set(prefix, 8)
  for (const i of ifds) {
    const at = offsets.get(i)!
    const sorted = [...i.entries].sort((a, b) => a.tag - b.tag)
    dv.setUint16(at, sorted.length, le)
    let extra = at + 2 + sorted.length * 12 + 4
    sorted.forEach((e, k) => {
      const o = at + 2 + k * 12
      const bytes = valueBytes(e.v, le, resolve)
      dv.setUint16(o, e.tag, le)
      dv.setUint16(o + 2, TYPE[e.v.kind], le)
      dv.setUint32(o + 4, countOf(e.v), le)
      if (bytes.length <= 4) out.set(bytes, o + 8)
      else {
        dv.setUint32(o + 8, extra, le)
        out.set(bytes, extra)
        extra += bytes.length + (bytes.length & 1)
      }
    })
    dv.setUint32(at + 2 + sorted.length * 12, i.next ? offsets.get(i.next)! : 0, le)
  }
  for (const b of blobs) out.set(b, offsets.get(b)!)
  return out
}

export function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload)
  return concat(be32(body.length + 8), text(type), body)
}

export function uuidBox(uuidHex: string, ...payload: Uint8Array[]): Uint8Array {
  const id = new Uint8Array(16)
  for (let i = 0; i < 16; i++) id[i] = parseInt(uuidHex.slice(i * 2, i * 2 + 2), 16)
  return box('uuid', id, ...payload)
}

export { be16, be32 }
