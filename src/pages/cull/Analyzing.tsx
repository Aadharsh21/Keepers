import { useEffect, useMemo, useState } from 'react'
import { Logo } from '../../components/Logo'
import { ThemeToggle } from '../../components/ThemeToggle'
import { closeShoot, useSession } from '../../lib/store/session'
import { PhotoGrid } from './lists'
import styles from './Analyzing.module.css'

function eta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'almost done'
  if (seconds < 50) return 'less than a minute left'
  const m = Math.round(seconds / 60)
  return m === 1 ? 'about a minute left' : `about ${m} minutes left`
}

/** Re-renders once a second so the rate and time left stay current. */
function useNow(): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function Analyzing() {
  const s = useSession()
  const now = useNow()
  const { total, done, failed, cached, startedAt } = s.progress
  const finished = done + failed
  const fresh = Math.max(0, finished - cached)
  const elapsed = Math.max(0, now - startedAt) / 1000
  const rate = elapsed > 1.5 ? fresh / elapsed : 0
  const remaining = total - finished
  const pct = total ? Math.round((finished / total) * 100) : 0
  const noop = () => {}
  const empty = useMemo(() => new Map(), [])

  return (
    <div className={styles.app}>
      <header className={styles.top}>
        <Logo />
        <span className={styles.name}>{total.toLocaleString()} photos</span>
        <ThemeToggle />
      </header>
      <main className={styles.body}>
        <section className={styles.panel} aria-live="polite">
          <div className={styles.label}>
            <p>Analyzing</p>
            <p className={styles.dim}>{s.name}</p>
          </div>
          <div className={styles.headline}>
            <h1 className={styles.title}>
              Analyzing {finished.toLocaleString()} of {total.toLocaleString()} photos
            </h1>
            <button type="button" className="btn" onClick={closeShoot}>
              Cancel
            </button>
          </div>
          <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Analysis progress">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className={styles.detail}>
            {rate > 0 ? `${rate.toFixed(1)} photos a second · ${eta(remaining / rate)}` : 'Loading the face and focus models'}
            {cached > 0 && ` · ${cached.toLocaleString()} remembered from last time`}
            {failed > 0 && ` · ${failed} could not be read`}
          </p>
          <p className={styles.detail}>Checking focus on the eyes, blinks, exposure, and which shots are near duplicates. Your photos stay on this computer.</p>
          {s.vision && !s.vision.available && (
            <p className={styles.warn}>Face and blink checks could not start in this browser. Keepers will still judge focus, exposure and duplicates.</p>
          )}
        </section>
        <div className={styles.grid}>
          <PhotoGrid ids={s.ids} entries={s.entries} byId={empty} overrides={{}} selectedId={null} onSelect={noop} onOpen={noop} />
        </div>
      </main>
    </div>
  )
}
