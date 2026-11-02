import type { Assessment, Moment } from '../engine/types'
import type { Verdict } from '../types'
import type { Filter, PhotoEntry } from './session'

export interface ViewModel {
  /** Moments to show in moment view ('all' and 'look' filters). */
  moments: Moment[]
  /** Flat photo list for the other filters, in moment order. */
  photos: string[]
  /** Navigation order for arrow keys. */
  nav: string[]
  mode: 'moments' | 'grid'
  counts: Record<Filter, number> & { momentsAll: number }
  verdictOf: (id: string) => Verdict | undefined
}

export function buildView(
  moments: Moment[],
  byId: Map<string, Assessment>,
  overrides: Record<string, Verdict>,
  entries: Map<string, PhotoEntry>,
  filter: Filter,
): ViewModel {
  const verdictOf = (id: string) => overrides[id] ?? byId.get(id)?.verdict
  const has = (id: string, f: Filter): boolean => {
    const a = byId.get(id)
    if (!a) return false
    switch (f) {
      case 'all':
        return true
      case 'look':
        return a.needsLook && !(id in overrides)
      case 'keep':
        return verdictOf(id) === 'keep'
      case 'reject':
        return verdictOf(id) === 'reject'
      case 'eyes':
        return a.issues.includes('eyes-closed') || a.issues.includes('blink')
      case 'soft':
        return a.issues.includes('soft')
      case 'exposure':
        return a.issues.includes('overexposed') || a.issues.includes('underexposed')
    }
  }

  const counts = { all: 0, look: 0, keep: 0, reject: 0, eyes: 0, soft: 0, exposure: 0, momentsAll: moments.length }
  const lookMoments = new Set<string>()
  for (const m of moments) {
    for (const id of m.photoIds) {
      counts.all++
      for (const f of ['keep', 'reject', 'eyes', 'soft', 'exposure'] as const) if (has(id, f)) counts[f]++
      if (has(id, 'look')) lookMoments.add(m.id)
    }
  }
  counts.look = lookMoments.size

  if (filter === 'all' || filter === 'look') {
    const shown = filter === 'all' ? moments : moments.filter((m) => lookMoments.has(m.id))
    return {
      moments: shown,
      photos: [],
      nav: shown.flatMap((m) => m.photoIds),
      mode: 'moments',
      counts,
      verdictOf,
    }
  }
  const photos = moments.flatMap((m) => m.photoIds.filter((id) => has(id, filter) && entries.get(id)?.status === 'done'))
  return { moments: [], photos, nav: photos, mode: 'grid', counts, verdictOf }
}
