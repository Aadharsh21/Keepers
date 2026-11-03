import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Columns2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Assessment, Moment } from '../../lib/engine/types'
import type { ViewModel } from '../../lib/store/selectors'
import type { PhotoEntry } from '../../lib/store/session'
import type { Verdict } from '../../lib/types'
import { Thumb } from './Thumb'
import styles from './lists.module.css'

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })
export const formatTime = (t?: number) => (t === undefined ? null : timeFmt.format(t))

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 45em)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 45em)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** Root font size in px; thumbnails and rows scale with the person's text size setting. */
function useRem(): number {
  const read = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const [rem, setRem] = useState(read)
  useEffect(() => {
    const ro = new ResizeObserver(() => setRem(read()))
    ro.observe(document.documentElement)
    return () => ro.disconnect()
  }, [])
  return rem
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function scrollPhotoIntoView(id: string | null) {
  if (!id) return
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

interface CommonProps {
  view: ViewModel
  entries: Map<string, PhotoEntry>
  byId: Map<string, Assessment>
  overrides: Record<string, Verdict>
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}

/** Chronological order inside a moment, so a burst reads like the sequence it was shot in. */
function chrono(m: Moment, entries: Map<string, PhotoEntry>): string[] {
  return [...m.photoIds].sort((a, b) => {
    const ea = entries.get(a)!
    const eb = entries.get(b)!
    const ta = ea.features?.captureTime ?? Infinity
    const tb = eb.features?.captureTime ?? Infinity
    return ta - tb || ea.order - eb.order
  })
}

export function MomentList({
  view,
  entries,
  byId,
  overrides,
  selectedId,
  onSelect,
  onOpen,
  onCompare,
  onBulk,
}: CommonProps & { onCompare: (momentId: string) => void; onBulk: (ids: string[], verdict: Verdict) => void }) {
  const parent = useRef<HTMLDivElement>(null)
  const narrow = useNarrow()
  const rem = useRem()
  const strip = Math.round((narrow ? 7 : 10) * rem)
  // First guess only: rows are measured after render, so wrapped headers never overlap.
  const rowHeight = strip + Math.round((narrow ? 4 : 4.5) * rem)
  const ordered = useMemo(() => view.moments.map((m) => ({ m, ids: chrono(m, entries) })), [view.moments, entries])
  const indexOf = useMemo(() => {
    const map = new Map<string, number>()
    ordered.forEach(({ ids }, i) => ids.forEach((id) => map.set(id, i)))
    return map
  }, [ordered])

  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  useEffect(() => {
    if (!selectedId) return
    const i = indexOf.get(selectedId)
    if (i === undefined) return
    virtualizer.scrollToIndex(i, { align: 'auto' })
    scrollPhotoIntoView(selectedId)
  }, [selectedId, indexOf, virtualizer])

  if (!ordered.length) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Nothing left to check</p>
        <p>Every moment Keeper was unsure about has a decision now.</p>
      </div>
    )
  }

  return (
    <div ref={parent} className={styles.scroller} tabIndex={-1}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const { m, ids } = ordered[row.index]
          const keeping = ids.filter((id) => view.verdictOf(id) === 'keep').length
          const time = formatTime(m.start)
          return (
            <section
              key={m.id}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className={styles.moment}
              style={{ transform: `translateY(${row.start}px)` }}
              aria-label={
                m.kind === 'graphics'
                  ? `Screenshots and graphics, ${ids.length} items, keeping ${keeping}`
                  : `${time ?? `Moment ${m.id.slice(1)}`}, ${ids.length} photos, keeping ${keeping}`
              }
            >
              {m.kind === 'graphics' ? (
                <header className={styles.momentHead}>
                  <span className={styles.momentTitle}>Screenshots and graphics</span>
                  <span className={styles.momentMeta}>
                    {ids.length === 1 ? '1 item' : `${ids.length} items`} · not judged as photos · keeping {keeping}
                  </span>
                  <button type="button" className={`btn btn-ghost btn-sm ${styles.compare}`} onClick={() => onBulk(ids, 'keep')} aria-label="Keep all screenshots">
                    <Check /> <span>Keep all</span>
                  </button>
                  <button type="button" className={`btn btn-ghost btn-sm ${styles.compare}`} onClick={() => onBulk(ids, 'reject')} aria-label="Reject all screenshots">
                    <X /> <span>Reject all</span>
                  </button>
                </header>
              ) : (
              <header className={styles.momentHead}>
                <span className={styles.momentTitle}>{time ?? `Moment ${m.id.slice(1)}`}</span>
                <span className={styles.momentMeta}>
                  {ids.length === 1 ? '1 photo' : `${ids.length} photos`} · keeping {keeping}
                </span>
                {ids.length > 1 && (
                  <button type="button" className={`btn btn-ghost btn-sm ${styles.compare}`} onClick={() => onCompare(m.id)} aria-label="Compare frames">
                    <Columns2 /> <span>Compare</span>
                  </button>
                )}
              </header>
              )}
              <div className={styles.strip} style={{ height: strip + 8 }}>
                {ids.map((id) => {
                  const entry = entries.get(id)
                  if (!entry) return null
                  return (
                    <Thumb
                      key={id}
                      id={id}
                      entry={entry}
                      assessment={byId.get(id)}
                      verdict={view.verdictOf(id)}
                      overridden={id in overrides}
                      selected={id === selectedId}
                      momentSize={m.kind === 'graphics' ? undefined : ids.length}
                      height={strip}
                      onSelect={onSelect}
                      onOpen={onOpen}
                    />
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function PhotoGrid({
  ids,
  entries,
  byId,
  overrides,
  selectedId,
  onSelect,
  onOpen,
  verdictOf,
  emptyTitle,
  emptyText,
}: Omit<CommonProps, 'view'> & { ids: string[]; verdictOf?: (id: string) => Verdict | undefined; emptyTitle?: string; emptyText?: string }) {
  const parent = useRef<HTMLDivElement>(null)
  const width = useWidth(parent)
  const narrow = useNarrow()
  const rem = useRem()
  const minTile = (narrow ? 9.5 : 13) * rem
  const gap = narrow ? 8 : 12
  const pad = narrow ? 12 : 24
  const inner = Math.max(0, width - pad * 2)
  const cols = Math.max(2, Math.floor((inner + gap) / (minTile + gap)))
  const tileW = cols ? (inner - gap * (cols - 1)) / cols : minTile
  const tileH = Math.round((tileW * 2) / 3)
  const rows = Math.ceil(ids.length / cols)
  const indexOf = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids])

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parent.current,
    estimateSize: () => tileH + gap,
    overscan: 4,
  })
  useEffect(() => {
    virtualizer.measure()
  }, [tileH, gap, virtualizer])

  useEffect(() => {
    if (!selectedId) return
    const i = indexOf.get(selectedId)
    if (i === undefined) return
    virtualizer.scrollToIndex(Math.floor(i / cols), { align: 'auto' })
  }, [selectedId, indexOf, cols, virtualizer])

  return (
    <div ref={parent} className={styles.scroller} style={{ padding: `${pad}px` }} tabIndex={-1}>
      {ids.length === 0 && emptyTitle ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{emptyTitle}</p>
          {emptyText && <p>{emptyText}</p>}
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {width > 0 &&
            virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.index}
                className={styles.gridRow}
                style={{ transform: `translateY(${row.start}px)`, height: tileH, gap, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
              >
                {ids.slice(row.index * cols, row.index * cols + cols).map((id) => {
                  const entry = entries.get(id)
                  if (!entry) return null
                  return (
                    <Thumb
                      key={id}
                      id={id}
                      entry={entry}
                      assessment={byId.get(id)}
                      verdict={verdictOf?.(id)}
                      overridden={id in overrides}
                      selected={id === selectedId}
                      onSelect={onSelect}
                      onOpen={onOpen}
                    />
                  )
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
