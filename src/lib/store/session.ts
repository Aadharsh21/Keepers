import { create } from 'zustand'
import { cull } from '../engine/score'
import type { CullResult, CullSettings, EnginePhoto } from '../engine/types'
import { buildSources, type FileWithPath, type Skipped } from '../ingest/collect'
import type { PhotoFeatures, PhotoSource, Verdict } from '../types'
import { AnalyzerPool, JobError } from '../worker/pool'
import { getSession, loadCached, saveCached, saveSession } from './db'
import { getPrefs, setPrefs } from './prefs'
import { bucket, track } from '../analytics'

export type Phase = 'empty' | 'analyzing' | 'review'

export type Filter = 'all' | 'look' | 'keep' | 'reject' | 'eyes' | 'soft' | 'exposure' | 'screens'

export interface PhotoEntry {
  source: PhotoSource
  order: number
  status: 'pending' | 'done' | 'error'
  features?: PhotoFeatures
  thumbUrl?: string
  error?: string
}

export interface Progress {
  total: number
  done: number
  failed: number
  cached: number
  startedAt: number
}

interface SessionState {
  phase: Phase
  key: string
  name: string
  isSample: boolean
  dirHandle: FileSystemDirectoryHandle | null
  entries: Map<string, PhotoEntry>
  /** Natural filename order. */
  ids: string[]
  skipped: Skipped[]
  progress: Progress
  vision: { available: boolean; reason?: string } | null
  result: CullResult | null
  overrides: Record<string, Verdict>
  selectedId: string | null
  filter: Filter
  notice: string | null
}

const initial: SessionState = {
  phase: 'empty',
  key: '',
  name: '',
  isSample: false,
  dirHandle: null,
  entries: new Map(),
  ids: [],
  skipped: [],
  progress: { total: 0, done: 0, failed: 0, cached: 0, startedAt: 0 },
  vision: null,
  result: null,
  overrides: {},
  selectedId: null,
  filter: 'all',
  notice: null,
}

export const useSession = create<SessionState>(() => initial)

let pool: AnalyzerPool | null = null
let runId = 0

export function getPool(): AnalyzerPool {
  pool ??= new AnalyzerPool()
  return pool
}

function hashIds(ids: string[]): string {
  let h = 5381
  for (const id of ids) for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function finalVerdict(s: Pick<SessionState, 'overrides' | 'result'>, id: string): Verdict | undefined {
  return s.overrides[id] ?? s.result?.byId.get(id)?.verdict
}

function revokeThumbs(entries: Map<string, PhotoEntry>) {
  for (const e of entries.values()) if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl)
}

export function closeShoot(): void {
  runId++
  pool?.clearQueue()
  revokeThumbs(useSession.getState().entries)
  useSession.setState({ ...initial, entries: new Map() })
}

export interface OpenOptions {
  files: FileWithPath[]
  name: string
  handle?: FileSystemDirectoryHandle | null
  isSample?: boolean
}

/** Starts a culling session: loads cached analysis, analyzes the rest, then scores. */
export async function openShoot(opts: OpenOptions): Promise<void> {
  const { sources, skipped } = buildSources(opts.files)
  if (!sources.length) {
    useSession.setState({
      notice: skipped.length
        ? `None of the ${skipped.length} files there are photos Keepers can read. It reads JPEG, HEIC, PNG and camera RAW files.`
        : 'That folder is empty. Pick the folder with your photos in it.',
    })
    return
  }
  revokeThumbs(useSession.getState().entries)
  const myRun = ++runId
  const ids = sources.map((s) => s.id)
  const key = `${opts.name}|${hashIds(ids)}`
  const saved = await getSession(key)
  const entries = new Map<string, PhotoEntry>(sources.map((source, order) => [source.id, { source, order, status: 'pending' }]))

  useSession.setState({
    ...initial,
    phase: 'analyzing',
    key,
    name: opts.name,
    isSample: !!opts.isSample,
    dirHandle: opts.handle ?? null,
    entries,
    ids,
    skipped,
    overrides: saved?.overrides ?? {},
    progress: { total: sources.length, done: 0, failed: 0, cached: 0, startedAt: performance.now() },
  })
  if (saved?.settings) setPrefs({ cull: saved.settings })

  // Cached analysis first: reopening a shoot should be instant.
  const cached = await loadCached(ids)
  if (myRun !== runId) return
  if (cached.size) {
    const next = new Map(useSession.getState().entries)
    for (const [id, c] of cached) {
      const e = next.get(id)!
      next.set(id, { ...e, status: 'done', features: c.features, thumbUrl: URL.createObjectURL(c.thumb) })
    }
    useSession.setState((s) => ({ entries: next, progress: { ...s.progress, done: cached.size, cached: cached.size } }))
  }

  const todo = sources.filter((s) => !cached.has(s.id))
  if (!todo.length) {
    finishAnalysis()
    return
  }

  const p = getPool()
  void p.status.then((v) => {
    if (myRun === runId) useSession.setState({ vision: { available: v.vision, reason: v.reason } })
  })

  // Results arrive one by one; apply them in small batches to keep React renders cheap.
  type Done = { id: string; features?: PhotoFeatures; thumb?: Blob; error?: string }
  let pending: Done[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    if (myRun !== runId || !pending.length) return
    const batch = pending
    pending = []
    const next = new Map(useSession.getState().entries)
    let ok = 0
    let failed = 0
    const toSave: { id: string; features: PhotoFeatures; thumb: Blob }[] = []
    for (const d of batch) {
      const e = next.get(d.id)!
      if (d.features && d.thumb) {
        next.set(d.id, { ...e, status: 'done', features: d.features, thumbUrl: URL.createObjectURL(d.thumb) })
        toSave.push({ id: d.id, features: d.features, thumb: d.thumb })
        ok++
      } else {
        next.set(d.id, { ...e, status: 'error', error: d.error })
        failed++
      }
    }
    void saveCached(toSave)
    useSession.setState((s) => ({
      entries: next,
      progress: { ...s.progress, done: s.progress.done + ok, failed: s.progress.failed + failed },
    }))
    const { progress } = useSession.getState()
    if (progress.done + progress.failed >= progress.total) finishAnalysis()
  }
  const push = (d: Done) => {
    pending.push(d)
    timer ??= setTimeout(flush, 120)
  }

  for (const s of todo) {
    p.analyze(s.file, s.kind).then(
      (r) => push({ id: s.id, features: r.features, thumb: r.thumb }),
      (err: unknown) => {
        if (err instanceof JobError && err.code === 'cancelled') return
        push({ id: s.id, error: err instanceof Error ? err.message : 'Could not read this file.' })
      },
    )
  }
}

function enginePhotos(s: SessionState): EnginePhoto[] {
  const out: EnginePhoto[] = []
  for (const id of s.ids) {
    const e = s.entries.get(id)
    if (e?.status === 'done' && e.features) out.push({ id, name: e.source.name, order: e.order, f: e.features })
  }
  return out
}

function finishAnalysis() {
  const s = useSession.getState()
  const result = cull(enginePhotos(s), getPrefs().cull)
  const firstMoment = result.moments[0]
  useSession.setState({ phase: 'review', result, selectedId: s.selectedId ?? firstMoment?.photoIds[0] ?? null })
  persist()
  track('shoot_culled', {
    photos: bucket(s.progress.total),
    failed: bucket(s.progress.failed),
    moments: bucket(result.moments.length),
    sample: s.isSample,
    seconds: Math.round((performance.now() - s.progress.startedAt) / 1000),
  })
}

export function setCullSettings(patch: Partial<CullSettings>): void {
  const cullSettings = { ...getPrefs().cull, ...patch }
  setPrefs({ cull: cullSettings })
  const s = useSession.getState()
  if (s.phase !== 'review') return
  useSession.setState({ result: cull(enginePhotos(s), cullSettings) })
  persist()
}

export function setVerdict(id: string, verdict: Verdict | null): void {
  useSession.setState((s) => {
    const overrides = { ...s.overrides }
    const auto = s.result?.byId.get(id)?.verdict
    if (verdict === null || verdict === auto) delete overrides[id]
    else overrides[id] = verdict
    return { overrides }
  })
  persist()
}

/** Sets the same decision for many photos at once, as a single change. */
export function setVerdicts(ids: string[], verdict: Verdict | null): void {
  useSession.setState((s) => {
    const overrides = { ...s.overrides }
    for (const id of ids) {
      const auto = s.result?.byId.get(id)?.verdict
      if (verdict === null || verdict === auto) delete overrides[id]
      else overrides[id] = verdict
    }
    return { overrides }
  })
  persist()
}

export function select(id: string | null): void {
  useSession.setState({ selectedId: id })
}

export function setFilter(filter: Filter): void {
  useSession.setState({ filter })
}

export function dismissNotice(): void {
  useSession.setState({ notice: null })
}

export function showNotice(notice: string): void {
  useSession.setState({ notice })
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const s = useSession.getState()
    if (!s.key || s.phase === 'empty') return
    let keepCount = 0
    for (const id of s.ids) if (finalVerdict(s, id) === 'keep') keepCount++
    void saveSession({
      key: s.key,
      name: s.name,
      photoCount: s.ids.length,
      keepCount,
      updatedAt: Date.now(),
      settings: getPrefs().cull,
      overrides: s.overrides,
      dirHandle: s.dirHandle ?? undefined,
      isSample: s.isSample,
    })
  }, 400)
}
