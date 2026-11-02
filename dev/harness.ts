// Dev-only page. scripts/eval.mjs drives it with Playwright to run Keeper's
// real pipeline (same pairing, analysis and scoring as the app) on a folder.
import { cull } from '../src/lib/engine/score'
import { DEFAULT_SETTINGS, type CullSettings, type EnginePhoto } from '../src/lib/engine/types'
import { buildSources, fromFileList } from '../src/lib/ingest/collect'
import { AnalyzerPool } from '../src/lib/worker/pool'

const params = new URLSearchParams(location.search)
const out = document.getElementById('out')!
const input = document.getElementById('files') as HTMLInputElement
const pool = new AnalyzerPool(Number(params.get('workers') ?? 2))
;(window as unknown as { keeperPool: AnalyzerPool }).keeperPool = pool

const settings: CullSettings = {
  picksPerMoment: Number(params.get('picks') ?? DEFAULT_SETTINGS.picksPerMoment) as 1 | 2 | 3,
  strictness: (params.get('strictness') as CullSettings['strictness']) ?? DEFAULT_SETTINGS.strictness,
  grouping: (params.get('grouping') as CullSettings['grouping']) ?? DEFAULT_SETTINGS.grouping,
}

input.addEventListener('change', async () => {
  const { sources, skipped } = buildSources(fromFileList(input.files ?? []))
  out.textContent = 'running'
  const status = await pool.status
  const t0 = performance.now()
  let done = 0
  const photos: EnginePhoto[] = []
  const errors: { name: string; error: string }[] = []
  const timings: Record<string, number>[] = []
  await Promise.all(
    sources.map(async (s, order) => {
      try {
        const r = await pool.analyze(s.file, s.kind)
        photos.push({ id: s.id, name: s.name, order, f: r.features })
        timings.push(r.features.timings)
      } catch (e) {
        errors.push({ name: s.relPath, error: String((e as Error).message) })
      }
      done++
      if (done % 25 === 0) out.textContent = `running ${done}/${sources.length}`
    }),
  )
  const analysisMs = Math.round(performance.now() - t0)
  const result = cull(photos, settings)
  const bySource = new Map(sources.map((s) => [s.id, s]))
  const verdicts = photos.map((p) => {
    const a = result.byId.get(p.id)!
    const s = bySource.get(p.id)!
    return {
      name: s.name,
      relPath: s.relPath,
      files: s.files.map((f) => f.name),
      verdict: a.verdict,
      rank: a.rank,
      momentId: a.momentId,
      needsLook: a.needsLook,
      issues: a.issues,
      reasons: a.reasons.map((r) => r.text),
      faces: p.f.faces.length,
    }
  })
  ;(window as unknown as { keeperResults: unknown }).keeperResults = {
    status,
    settings,
    workers: pool.size,
    analysisMs,
    photos: sources.length,
    skipped,
    errors,
    timings,
    moments: result.moments.length,
    verdicts,
    // Raw features for the fixture tests and debugging (embeddings dropped to keep it small).
    features: params.has('features') ? photos.map((p) => ({ name: p.name, ...p.f, embedding: undefined })) : undefined,
  }
  out.textContent = 'done'
})
