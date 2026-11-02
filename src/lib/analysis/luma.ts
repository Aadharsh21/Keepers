/** Grayscale plane used by every metric. Values are 0..255 floats. */
export interface Luma {
  data: Float32Array
  width: number
  height: number
}

export function lumaFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Luma {
  const data = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    // Rec. 709 weights on gamma-encoded values: fine for focus and hashing.
    data[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]
  }
  return { data, width, height }
}

/** Box-filter downsample. Averages whole source pixels so no detail is invented. */
export function resampleArea(src: Luma, width: number, height: number): Luma {
  const out = new Float32Array(width * height)
  const sx = src.width / width
  const sy = src.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * src.width
        for (let xx = x0; xx < x1; xx++) sum += src.data[row + xx]
      }
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0))
    }
  }
  return { data: out, width, height }
}

export function crop(src: Luma, x: number, y: number, w: number, h: number): Luma {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(src.width, Math.ceil(x + w))
  const y1 = Math.min(src.height, Math.ceil(y + h))
  const cw = Math.max(0, x1 - x0)
  const ch = Math.max(0, y1 - y0)
  const out = new Float32Array(cw * ch)
  for (let yy = 0; yy < ch; yy++) {
    out.set(src.data.subarray((y0 + yy) * src.width + x0, (y0 + yy) * src.width + x0 + cw), yy * cw)
  }
  return { data: out, width: cw, height: ch }
}
