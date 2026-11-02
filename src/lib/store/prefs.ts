import { useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type CullSettings } from '../engine/types'

export type ThemePref = 'system' | 'light' | 'dark'

export interface Prefs {
  theme: ThemePref
  cull: CullSettings
  /** Star rating written to sidecars for keepers. */
  keeperStars: 1 | 2 | 3 | 4 | 5
  /** Color label written to sidecars for rejects, or none. */
  rejectLabel: 'Red' | 'none'
  showFaces: boolean
  /** Hide rejected frames inside moment rows. */
  dimRejects: boolean
}

const KEY = 'keeper.prefs'
const DEFAULTS: Prefs = {
  theme: 'system',
  cull: DEFAULT_SETTINGS,
  keeperStars: 3,
  rejectLabel: 'Red',
  showFaces: false,
  dimRejects: true,
}

function read(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return { ...DEFAULTS, ...raw, cull: { ...DEFAULTS.cull, ...(raw.cull ?? {}) } }
  } catch {
    return DEFAULTS
  }
}

let current = read()
const listeners = new Set<() => void>()

export function getPrefs(): Prefs {
  return current
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Storage blocked: preferences last for this visit only.
  }
  if (patch.theme) applyTheme(current.theme)
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getPrefs,
    getPrefs,
  )
}

export function applyTheme(theme: ThemePref): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

// Other tabs changing preferences.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    current = read()
    applyTheme(current.theme)
    listeners.forEach((l) => l())
  })
}
