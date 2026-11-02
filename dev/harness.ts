// Dev-only page used by scripts and Playwright to run the analysis pipeline headless.
import { kindOf } from '../src/lib/formats/detect'
import { AnalyzerPool } from '../src/lib/worker/pool'

const out = document.getElementById('out')!
const input = document.getElementById('files') as HTMLInputElement
const pool = new AnalyzerPool(Number(new URLSearchParams(location.search).get('workers') ?? 2))
;(window as unknown as { keeperPool: AnalyzerPool }).keeperPool = pool

input.addEventListener('change', async () => {
  const files = Array.from(input.files ?? [])
  out.textContent = 'running'
  const status = await pool.status
  const t0 = performance.now()
  const results = await Promise.all(
    files.map(async (f) => {
      const kind = kindOf(f.name)
      if (!kind) return { name: f.name, error: 'unsupported' }
      try {
        const r = await pool.analyze(f, kind)
        const { embedding, ...rest } = r.features
        return { name: f.name, thumbBytes: r.thumb.size, embeddingLength: embedding?.length ?? 0, embedding: embedding ? Array.from(embedding) : null, ...rest }
      } catch (e) {
        return { name: f.name, error: String((e as Error).message) }
      }
    }),
  )
  ;(window as unknown as { keeperResults: unknown }).keeperResults = { status, ms: Math.round(performance.now() - t0), results }
  out.textContent = 'done'
})
