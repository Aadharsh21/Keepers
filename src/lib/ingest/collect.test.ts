import { describe, expect, it } from 'vitest'
import { buildSources, type FileWithPath } from './collect'

const f = (path: string, size = 10, lastModified = 1000): FileWithPath => ({
  file: new File([new Uint8Array(size)], path.split('/').pop()!, { lastModified }),
  path,
})

describe('buildSources', () => {
  it('pairs RAW and JPEG files with the same name into one photo', () => {
    const { sources } = buildSources([f('card/IMG_0001.CR3', 30), f('card/IMG_0001.JPG', 20), f('card/IMG_0002.JPG')])
    expect(sources).toHaveLength(2)
    const pair = sources.find((s) => s.name === 'IMG_0001.CR3')!
    expect(pair.kind).toBe('jpeg')
    expect(pair.file.name).toBe('IMG_0001.JPG')
    expect(pair.raw?.name).toBe('IMG_0001.CR3')
    expect(pair.files.map((x) => x.name)).toEqual(['IMG_0001.CR3', 'IMG_0001.JPG'])
  })

  it('attaches existing sidecars to RAW files', () => {
    const { sources } = buildSources([f('a/DSC1.ARW'), f('a/DSC1.xmp')])
    expect(sources[0].xmp?.name).toBe('DSC1.xmp')
  })

  it('keeps same-named photos in different folders apart', () => {
    const { sources } = buildSources([f('day1/IMG_0001.JPG'), f('day2/IMG_0001.JPG')])
    expect(sources).toHaveLength(2)
    expect(new Set(sources.map((s) => s.id)).size).toBe(2)
  })

  it('skips files that are not photos and empty files, and says why', () => {
    const { sources, skipped } = buildSources([f('x/notes.txt'), f('x/empty.jpg', 0), f('x/ok.jpg'), f('x/.DS_Store')])
    expect(sources.map((s) => s.name)).toEqual(['ok.jpg'])
    expect(skipped.map((s) => s.reason)).toEqual(['Not a photo format Keepers reads', 'The file is empty'])
  })

  it('sorts naturally, so IMG_2 comes before IMG_10', () => {
    const { sources } = buildSources([f('IMG_10.jpg'), f('IMG_2.jpg'), f('IMG_1.jpg')])
    expect(sources.map((s) => s.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg'])
  })
})
