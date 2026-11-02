// Optional checks against real camera files. Point KEEPER_REAL_RAW at a folder
// of RAW files (for example ExifTool's t/images test set) to run them.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bytesSource } from './bytes'
import { kindOf } from './detect'
import { extractRawPreview } from './raw'

const dir = process.env.KEEPER_REAL_RAW
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => kindOf(f) === 'raw') : []

describe.skipIf(!files.length)('real RAW files', () => {
  for (const name of files) {
    it(`reads ${name}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(dir!, name)))
      const preview = await extractRawPreview(bytesSource(bytes))
      console.log(
        name,
        preview
          ? `${preview.width}x${preview.height} from ${preview.source}, ${preview.jpeg.length} bytes, ${JSON.stringify(preview.meta)}`
          : 'no preview',
      )
      if (preview) {
        expect(preview.width).toBeGreaterThan(0)
        expect([preview.jpeg[0], preview.jpeg[1]]).toEqual([0xff, 0xd8])
      }
    })
  }
})
