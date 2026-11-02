import { Monitor, Moon, Sun } from 'lucide-react'
import { setPrefs, usePrefs, type ThemePref } from '../lib/store/prefs'

const NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<ThemePref, string> = { system: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' }

export function ThemeToggle() {
  const { theme } = usePrefs()
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setPrefs({ theme: NEXT[theme] })}
      aria-label={`${LABEL[theme]}. Switch theme`}
      title={LABEL[theme]}
    >
      <Icon />
    </button>
  )
}
