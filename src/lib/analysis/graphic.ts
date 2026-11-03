/**
 * Signals that separate screenshots and graphics from camera photos.
 *
 * Camera sensors add noise, so neighbouring pixels in a photo are almost
 * never exactly equal, and a photo uses thousands of colors. Screens are
 * drawn: flat panels of one exact color, crisp text, a small palette.
 */
export interface GraphicStats {
  /** Share of horizontally adjacent pixel pairs with exactly the same RGB. */
  flat: number
  /** Share of pixels covered by the 16 most common colors (5 bits per channel). */
  top16: number
}

export function graphicStats(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GraphicStats {
  let equal = 0
  let pairs = 0
  const counts = new Uint32Array(32768)
  for (let y = 0; y < height; y++) {
    let p = y * width * 4
    for (let x = 0; x < width; x++, p += 4) {
      const r = rgba[p]
      const g = rgba[p + 1]
      const b = rgba[p + 2]
      counts[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++
      if (x + 1 < width) {
        pairs++
        if (r === rgba[p + 4] && g === rgba[p + 5] && b === rgba[p + 6]) equal++
      }
    }
  }
  // Partial selection of the 16 largest bins.
  const top: number[] = []
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i]
    if (c === 0) continue
    if (top.length < 16) {
      top.push(c)
      top.sort((a, b) => a - b)
    } else if (c > top[0]) {
      top[0] = c
      top.sort((a, b) => a - b)
    }
  }
  const covered = top.reduce((a, b) => a + b, 0)
  const n = width * height
  return {
    flat: pairs ? Math.round((equal / pairs) * 1000) / 1000 : 0,
    top16: n ? Math.round((covered / n) * 1000) / 1000 : 0,
  }
}

/** Screenshot naming used by iOS, Android, macOS and Windows in a few languages. */
const SCREENSHOT_NAME = /(screen ?shot|screen_shot|screenshot|bildschirmfoto|captura de pantalla|capture d.?[ée]cran|schermafbeelding|schermata|снимок экрана|スクリーンショット|截屏|屏幕截图)/i

export function screenshotName(name: string): boolean {
  return SCREENSHOT_NAME.test(name)
}

/**
 * iPhones and Macs tag screenshots with the comment "Screenshot" (in an XMP
 * packet or the Exif UserComment). Looking for those bytes near the start of
 * the file catches them without a full metadata parser.
 */
export function hasScreenshotTag(head: Uint8Array): boolean {
  const needle = [0x53, 0x63, 0x72, 0x65, 0x65, 0x6e, 0x73, 0x68, 0x6f, 0x74] // "Screenshot"
  outer: for (let i = 0; i + needle.length <= head.length; i++) {
    for (let j = 0; j < needle.length; j++) if (head[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}
