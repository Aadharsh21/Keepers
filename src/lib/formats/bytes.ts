/**
 * Random access to file bytes without loading whole files into memory.
 * RAW files are 20 to 60 MB each, so readers only pull the slices they need.
 */
export interface ByteSource {
  readonly size: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async read(offset, length) {
      const end = Math.min(blob.size, offset + length)
      if (offset >= end) return new Uint8Array(0)
      return new Uint8Array(await blob.slice(offset, end).arrayBuffer())
    },
  }
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    async read(offset, length) {
      return bytes.subarray(Math.max(0, offset), Math.min(bytes.length, offset + length))
    },
  }
}

/**
 * Wraps a source and keeps the head of the file in memory. Headers, IFDs and
 * EXIF blocks almost always live near the start, so most reads become free.
 */
export class CachedSource implements ByteSource {
  private head: Uint8Array | null = null
  private readonly src: ByteSource
  private readonly headSize: number

  constructor(src: ByteSource, headSize = 256 * 1024) {
    this.src = src
    this.headSize = headSize
  }

  get size(): number {
    return this.src.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!this.head) this.head = await this.src.read(0, this.headSize)
    if (offset >= 0 && offset + length <= this.head.length) {
      return this.head.subarray(offset, offset + length)
    }
    return this.src.read(offset, length)
  }
}

export function u16(b: Uint8Array, o: number, le: boolean): number {
  return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]
}

export function u32(b: Uint8Array, o: number, le: boolean): number {
  return le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

export function ascii(b: Uint8Array, o: number, n: number): string {
  let s = ''
  for (let i = 0; i < n && o + i < b.length; i++) {
    const c = b[o + i]
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

export function startsWith(b: Uint8Array, o: number, text: string): boolean {
  if (o + text.length > b.length) return false
  for (let i = 0; i < text.length; i++) {
    if (b[o + i] !== text.charCodeAt(i)) return false
  }
  return true
}
