import type { FileWithPath } from './collect'

export interface Manifest {
  name: string
  /** Attribution the sample photos' license asks for. */
  credit?: { text: string; url: string; license: string; licenseUrl: string }
  files: { name: string; lastModified?: number }[]
}

const url = (path: string) => `${import.meta.env.BASE_URL}samples/${path}`

let manifestPromise: Promise<Manifest | null> | null = null

export function sampleManifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch(url('manifest.json'))
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .then((m) => (m && Array.isArray(m.files) && m.files.length ? m : null))
    .catch(() => null)
  return manifestPromise
}

/** Downloads the sample shoot that ships with the site and turns it into File objects. */
export async function loadSampleShoot(onProgress?: (done: number, total: number) => void): Promise<{ name: string; files: FileWithPath[] }> {
  const manifest = await sampleManifest()
  if (!manifest) throw new Error('The sample shoot is not available right now.')
  let done = 0
  const files = await Promise.all(
    manifest.files.map(async (f) => {
      const res = await fetch(url(encodeURIComponent(f.name)))
      if (!res.ok) throw new Error(`Could not download ${f.name}`)
      const blob = await res.blob()
      onProgress?.(++done, manifest.files.length)
      return { file: new File([blob], f.name, { type: blob.type, lastModified: f.lastModified ?? 0 }), path: f.name }
    }),
  )
  return { name: manifest.name, files }
}
