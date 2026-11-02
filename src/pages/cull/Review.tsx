import { ChevronLeft, ChevronRight, Download, EyeOff, Flag, Focus, Keyboard, LayoutList, SunMedium, X, Check, CircleX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { Logo } from '../../components/Logo'
import { ThemeToggle } from '../../components/ThemeToggle'
import type { Grouping, Strictness } from '../../lib/engine/types'
import { buildView } from '../../lib/store/selectors'
import { setPrefs, usePrefs } from '../../lib/store/prefs'
import { closeShoot, select, setCullSettings, setFilter, setVerdict, useSession, type Filter } from '../../lib/store/session'
import { Compare } from './Compare'
import { ExportDialog } from './ExportDialog'
import { Inspector } from './Inspector'
import { MomentList, PhotoGrid } from './lists'
import { prefetchPreviews } from './usePreview'
import styles from './Review.module.css'

const FILTERS: { id: Filter; label: string; icon: typeof Flag; group: 'show' | 'issues' }[] = [
  { id: 'all', label: 'All moments', icon: LayoutList, group: 'show' },
  { id: 'look', label: 'Needs a look', icon: Flag, group: 'show' },
  { id: 'keep', label: 'Keepers', icon: Check, group: 'show' },
  { id: 'reject', label: 'Rejected', icon: CircleX, group: 'show' },
  { id: 'eyes', label: 'Eyes closed', icon: EyeOff, group: 'issues' },
  { id: 'soft', label: 'Soft focus', icon: Focus, group: 'issues' },
  { id: 'exposure', label: 'Exposure', icon: SunMedium, group: 'issues' },
]

const EMPTY: Partial<Record<Filter, [string, string]>> = {
  keep: ['No keepers yet', 'Mark photos with P or the Keep button and they show up here.'],
  reject: ['Nothing rejected', 'Every photo in this shoot is a keeper right now.'],
  eyes: ['No closed eyes found', 'Keeper did not find any blinks in this shoot.'],
  soft: ['No soft frames', 'Every frame is about as sharp as its moment allows.'],
  exposure: ['No exposure problems', 'No blown highlights or very dark frames.'],
}

function useNarrow(query = '(max-width: 960px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

function Segmented<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className={styles.setting}>
      <span className={styles.settingLabel} id={`set-${label}`}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={`set-${label}`}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className={styles.settingHint}>{hint}</span>}
    </div>
  )
}

const STRICT_HINT: Record<Strictness, string> = {
  relaxed: 'Keeps every single shot unless it is unusable.',
  balanced: 'Rejects clearly blurry, blinked or blown frames.',
  strict: 'Flags anything noticeably soft or badly exposed.',
}
const GROUP_HINT: Record<Grouping, string> = {
  tight: 'Only near-identical frames shot seconds apart.',
  normal: 'Bursts and repeats of the same shot.',
  loose: 'Similar shots up to a few minutes apart.',
}

export function Review() {
  const s = useSession()
  const prefs = usePrefs()
  const narrow = useNarrow()
  const [compareId, setCompareId] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const result = s.result!
  const view = useMemo(() => buildView(result.moments, result.byId, s.overrides, s.entries, s.filter), [result, s.overrides, s.entries, s.filter])
  const momentOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of result.moments) for (const id of m.photoIds) map.set(id, m.id)
    return map
  }, [result.moments])
  const momentById = useMemo(() => new Map(result.moments.map((m) => [m.id, m])), [result.moments])

  const selected = s.selectedId && s.entries.get(s.selectedId) ? s.selectedId : null
  const selectedEntry = selected ? s.entries.get(selected) : undefined
  const selectedMoment = selected ? momentById.get(momentOf.get(selected) ?? '') : undefined

  // Keep the selection inside the current filter.
  useEffect(() => {
    if (view.nav.length && (!selected || !view.nav.includes(selected))) select(view.nav[0])
  }, [view.nav, selected])

  const move = useCallback(
    (delta: number) => {
      const nav = view.nav
      if (!nav.length) return
      const i = selected ? nav.indexOf(selected) : -1
      const next = nav[Math.min(nav.length - 1, Math.max(0, i + delta))]
      select(next)
      prefetchPreviews([nav[nav.indexOf(next) + 1], nav[nav.indexOf(next) + 2]].map((id) => (id ? s.entries.get(id)?.source : undefined)))
    },
    [view.nav, selected, s.entries],
  )

  const moveMoment = useCallback(
    (delta: number) => {
      if (view.mode !== 'moments' || !view.moments.length) return move(delta)
      const current = selected ? view.moments.findIndex((m) => m.photoIds.includes(selected)) : -1
      const target = view.moments[Math.min(view.moments.length - 1, Math.max(0, current + delta))]
      // Land on Keeper's pick in that moment.
      select(target.photoIds[0])
    },
    [view, selected, move],
  )

  const dialogOpen = !!compareId || helpOpen || exportOpen || viewerOpen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable]')) return
      const key = e.key.toLowerCase()
      if (key === 'arrowright') move(1)
      else if (key === 'arrowleft') move(-1)
      else if (key === 'arrowdown') moveMoment(1)
      else if (key === 'arrowup') moveMoment(-1)
      else if ((key === 'p' || key === 'k') && selected) setVerdict(selected, 'keep')
      else if ((key === 'x' || key === 'r') && selected) setVerdict(selected, 'reject')
      else if (key === 'u' && selected) setVerdict(selected, null)
      else if ((key === 'c' || key === 'enter') && selected && (target === document.body || target.dataset.photoId)) setCompareId(selected)
      else if (key === 'f') setPrefs({ showFaces: !prefs.showFaces })
      else if (key === 'e') setExportOpen(true)
      else if (key === '?') setHelpOpen(true)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialogOpen, move, moveMoment, selected, prefs.showFaces])

  const onSelect = useCallback(
    (id: string) => {
      select(id)
      if (narrow) setViewerOpen(true)
    },
    [narrow],
  )
  const onOpen = useCallback((id: string) => setCompareId(id), [])
  const onCompare = useCallback(
    (momentId: string) => {
      const m = momentById.get(momentId)
      if (m) setCompareId(m.photoIds[0])
    },
    [momentById],
  )

  const keepCount = view.counts.keep
  const rejectCount = view.counts.reject
  const failed = s.progress.failed

  const filterNav = (
    <nav className={narrow ? styles.chips : styles.filters} aria-label="Show">
      {(['show', 'issues'] as const).map((group) => (
        <div key={group} className={styles.filterGroup}>
          {!narrow && <span className={styles.groupLabel}>{group === 'show' ? 'Show' : 'Issues'}</span>}
          {FILTERS.filter((f) => f.group === group).map((f) => {
            const count = f.id === 'all' ? view.counts.momentsAll : view.counts[f.id]
            const Icon = f.icon
            return (
              <button key={f.id} type="button" className={styles.filter} aria-pressed={s.filter === f.id} onClick={() => setFilter(f.id)}>
                <Icon aria-hidden="true" />
                <span className={styles.filterLabel}>{f.label}</span>
                <span className={styles.count}>{count.toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )

  const settings = (
    <div className={styles.settings}>
      <span className={styles.groupLabel}>Culling</span>
      <Segmented
        label="Keep per moment"
        value={prefs.cull.picksPerMoment}
        options={[1, 2, 3].map((n) => ({ value: n as 1 | 2 | 3, label: String(n) }))}
        onChange={(v) => setCullSettings({ picksPerMoment: v })}
      />
      <Segmented
        label="Strictness"
        value={prefs.cull.strictness}
        options={[
          { value: 'relaxed', label: 'Relaxed' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'strict', label: 'Strict' },
        ]}
        onChange={(v) => setCullSettings({ strictness: v })}
        hint={STRICT_HINT[prefs.cull.strictness]}
      />
      <Segmented
        label="Group similar shots"
        value={prefs.cull.grouping}
        options={[
          { value: 'tight', label: 'Tight' },
          { value: 'normal', label: 'Normal' },
          { value: 'loose', label: 'Loose' },
        ]}
        onChange={(v) => setCullSettings({ grouping: v })}
        hint={GROUP_HINT[prefs.cull.grouping]}
      />
      {s.vision && !s.vision.available && (
        <p className={styles.visionNote}>Face and blink checks could not start in this browser, so Keeper is judging focus, exposure and duplicates only.</p>
      )}
      {failed > 0 && (
        <p className={styles.visionNote}>
          {failed === 1 ? '1 file' : `${failed} files`} could not be read and {failed === 1 ? 'is' : 'are'} left out.
        </p>
      )}
    </div>
  )

  const emptyCopy = EMPTY[s.filter]
  return (
    <div className={styles.app}>
      <header className={styles.top}>
        <Logo />
        <div className={styles.shoot}>
          <span className={styles.shootName} title={s.name}>
            {s.name}
          </span>
          <span className={styles.shootMeta}>
            {s.ids.length.toLocaleString()} photos{s.isSample ? ' · sample' : ''}
          </span>
        </div>
        <div className={styles.tally} aria-live="polite">
          <span data-kind="keep">
            <strong>{keepCount.toLocaleString()}</strong> keepers
          </span>
          <span data-kind="reject">
            <strong>{rejectCount.toLocaleString()}</strong> rejected
          </span>
        </div>
        <div className={styles.topActions}>
          <button type="button" className={`icon-btn ${styles.hideNarrow}`} onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <Keyboard />
          </button>
          <ThemeToggle />
          <button type="button" className="icon-btn" onClick={closeShoot} aria-label="Close this shoot" title="Close this shoot">
            <X />
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setExportOpen(true)}>
            <Download /> <span className={styles.hideNarrow}>Export</span>
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {!narrow && (
          <aside className={styles.sidebar}>
            {filterNav}
            {settings}
          </aside>
        )}
        <main className={styles.main}>
          {narrow && filterNav}
          <div className={styles.listArea}>
            {view.mode === 'moments' ? (
              <MomentList
                view={view}
                entries={s.entries}
                byId={result.byId}
                overrides={s.overrides}
                selectedId={selected}
                onSelect={onSelect}
                onOpen={onOpen}
                onCompare={onCompare}
              />
            ) : (
              <PhotoGrid
                ids={view.photos}
                entries={s.entries}
                byId={result.byId}
                overrides={s.overrides}
                selectedId={selected}
                onSelect={onSelect}
                onOpen={onOpen}
                verdictOf={view.verdictOf}
                emptyTitle={emptyCopy?.[0]}
                emptyText={emptyCopy?.[1]}
              />
            )}
          </div>
          {narrow && <details className={styles.mobileSettings}><summary>Culling settings</summary>{settings}</details>}
        </main>
        {!narrow && selectedEntry && (
          <Inspector
            key={selectedEntry.source.id}
            entry={selectedEntry}
            assessment={result.byId.get(selectedEntry.source.id)}
            moment={selectedMoment}
            verdict={view.verdictOf(selectedEntry.source.id)}
            overridden={selectedEntry.source.id in s.overrides}
          />
        )}
      </div>

      {narrow && selectedEntry && (
        <Dialog
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          title={view.nav.includes(selectedEntry.source.id) ? `Photo ${view.nav.indexOf(selectedEntry.source.id) + 1} of ${view.nav.length}` : selectedEntry.source.name}
          size="full"
          headerExtra={
            <div className={styles.viewerNav}>
              <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Previous photo">
                <ChevronLeft />
              </button>
              <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Next photo">
                <ChevronRight />
              </button>
            </div>
          }
        >
          <div className={styles.viewerBody}>
            <Inspector
              key={selectedEntry.source.id}
              entry={selectedEntry}
              assessment={result.byId.get(selectedEntry.source.id)}
              moment={selectedMoment}
              verdict={view.verdictOf(selectedEntry.source.id)}
              overridden={selectedEntry.source.id in s.overrides}
            />
          </div>
        </Dialog>
      )}

      <Compare
        key={compareId ?? 'closed'}
        moment={compareId ? (momentById.get(momentOf.get(compareId) ?? '') ?? null) : null}
        entries={s.entries}
        byId={result.byId}
        verdictOf={view.verdictOf}
        initialId={compareId}
        onClose={() => setCompareId(null)}
      />

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <table className={styles.keys}>
          <tbody>
            {[
              [['←', '→'], 'Previous or next photo'],
              [['↑', '↓'], 'Previous or next moment'],
              [['P'], 'Keep'],
              [['X'], 'Reject'],
              [['U'], "Undo your change (back to Keeper's pick)"],
              [['C'], 'Compare every frame in the moment'],
              [['F'], 'Show faces and face boxes'],
              [['E'], 'Export'],
              [['?'], 'This list'],
            ].map(([keys, label]) => (
              <tr key={label as string}>
                <td>
                  {(keys as string[]).map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </td>
                <td>{label as string}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Dialog>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}
