import { useEffect, useState } from 'react'
import type { PhotoSource } from '../../lib/types'
import { getPool } from '../../lib/store/session'

/**
 * Full-size preview URLs. JPEG, PNG and WebP files are shown directly (the
 * browser decodes them and applies EXIF rotation). RAW and HEIC go through
 * the worker, which extracts and rotates the embedded preview.
 */
const cache = new Map<string, Promise<string>>()
const order: string[] = []
const LIMIT = 40

function evict() {
  while (order.length > LIMIT) {
    const id = order.shift()!
    const p = cache.get(id)
    cache.delete(id)
    void p?.then((url) => URL.revokeObjectURL(url)).catch(() => {})
  }
}

export function previewUrl(source: PhotoSource): Promise<string> {
  const hit = cache.get(source.id)
  if (hit) {
    order.splice(order.indexOf(source.id), 1)
    order.push(source.id)
    return hit
  }
  const direct = source.kind === 'jpeg' || source.kind === 'png' || source.kind === 'webp'
  const p = direct
    ? Promise.resolve(URL.createObjectURL(source.file))
    : getPool()
        .preview(source.file, source.kind, 2560)
        .then((r) => URL.createObjectURL(r.blob))
  p.catch(() => cache.delete(source.id))
  cache.set(source.id, p)
  order.push(source.id)
  evict()
  return p
}

export function usePreview(source: PhotoSource | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ id?: string; url: string | null; failed: boolean }>({ url: null, failed: false })
  useEffect(() => {
    if (!source) return
    let live = true
    previewUrl(source).then(
      (url) => live && setState({ id: source.id, url, failed: false }),
      () => live && setState({ id: source.id, url: null, failed: true }),
    )
    return () => {
      live = false
    }
  }, [source])
  return state.id === source?.id ? state : { url: null, failed: false }
}

/** Warm the cache for neighbours so arrowing through a moment feels instant. */
export function prefetchPreviews(sources: (PhotoSource | undefined)[]): void {
  for (const s of sources) if (s && !cache.has(s.id) && s.kind !== 'jpeg') void previewUrl(s).catch(() => {})
}
