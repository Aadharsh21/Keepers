import { describe, expect, it } from 'vitest'
import { graphicStats, hasScreenshotTag, screenshotName } from './graphic'

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y)
      const i = (y * w + x) * 4
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = 255
    }
  }
  return out
}

let seed = 11
const noise = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return (seed / 2147483648 - 0.5) * 12
}

describe('graphicStats', () => {
  it('sees a drawn interface as flat with a small palette', () => {
    // White app background, grey chat bubbles, dark text lines.
    const ui = image(300, 600, (x, y) => {
      if (y % 80 < 50 && x > 20 && x < 220) return y % 6 < 2 && x % 7 < 5 ? [20, 20, 20] : [233, 233, 235]
      return [255, 255, 255]
    })
    const s = graphicStats(ui, 300, 600)
    expect(s.flat).toBeGreaterThan(0.6)
    expect(s.top16).toBeGreaterThan(0.9)
  })

  it('sees a noisy camera photo as neither flat nor few-colored', () => {
    const photo = image(300, 200, (x, y) => {
      const base = 90 + 80 * Math.sin(x / 23) * Math.cos(y / 17)
      return [base + noise(), base * 0.9 + noise(), base * 0.7 + noise()]
    })
    const s = graphicStats(photo, 300, 200)
    expect(s.flat).toBeLessThan(0.2)
    expect(s.top16).toBeLessThan(0.7)
  })
})

describe('screenshot hints', () => {
  it('recognises common screenshot file names', () => {
    expect(screenshotName('Screenshot_20260614-171503.png')).toBe(true)
    expect(screenshotName('Screen Shot 2026-06-14 at 5.21.40 PM.png')).toBe(true)
    expect(screenshotName('Bildschirmfoto 2026-06-14 um 17.21.40.png')).toBe(true)
    expect(screenshotName('IMG_4821.JPG')).toBe(false)
  })

  it('finds the Screenshot tag phones and Macs write into the file', () => {
    const xmp = new TextEncoder().encode('<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">Screenshot</rdf:li></rdf:Alt></exif:UserComment>')
    expect(hasScreenshotTag(xmp)).toBe(true)
    expect(hasScreenshotTag(new TextEncoder().encode('Canon EOS R6 Exif data'))).toBe(false)
  })
})
