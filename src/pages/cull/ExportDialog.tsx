import { CircleCheck, FileArchive, FolderInput, LoaderCircle, Star, TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { copyToFolder, downloadAsZip, fileEntries, formatBytes, sidecarEntries, writeSidecarsToFolder, type ExportOutcome, type ExportProgress, type Rated } from '../../lib/export/exporters'
import { canWriteFolders } from '../../lib/export/fsaccess'
import { freshSidecar, mergeSidecar } from '../../lib/export/xmp'
import { setPrefs, usePrefs } from '../../lib/store/prefs'
import { finalVerdict, useSession } from '../../lib/store/session'
import type { PhotoSource } from '../../lib/types'
import styles from './ExportDialog.module.css'

type Job = 'ratings' | 'copy' | 'zip'

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession()
  const prefs = usePrefs()
  const [running, setRunning] = useState<Job | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [outcome, setOutcome] = useState<(ExportOutcome & { job: Job; ok: boolean }) | null>(null)
  const abort = useRef<AbortController | null>(null)

  const { keepers, rated, rawCount, bytes } = useMemo(() => {
    const keepers: PhotoSource[] = []
    const rated: Rated[] = []
    let bytes = 0
    for (const id of s.ids) {
      const e = s.entries.get(id)
      if (!e || e.status !== 'done') continue
      const v = finalVerdict(s, id)
      if (v === 'keep') {
        keepers.push(e.source)
        bytes += e.source.files.reduce((n, f) => n + f.size, 0)
      }
      if (e.source.raw && v) {
        rated.push({
          source: e.source,
          tags: v === 'keep' ? { rating: prefs.keeperStars, label: '' } : { rating: 0, label: prefs.rejectLabel === 'Red' ? 'Red' : '' },
        })
      }
    }
    return { keepers, rated, rawCount: rated.length, bytes }
  }, [s, prefs.keeperStars, prefs.rejectLabel])

  const run = async (job: Job, fn: (signal: AbortSignal) => Promise<ExportOutcome>) => {
    if (running) return
    setRunning(job)
    setOutcome(null)
    setProgress(null)
    abort.current = new AbortController()
    try {
      const result = await fn(abort.current.signal)
      setOutcome({ ...result, job, ok: !abort.current.signal.aborted })
    } catch (err) {
      const e = err as DOMException
      if (e?.name === 'AbortError') setOutcome(null)
      else {
        console.error(err)
        setOutcome({ job, ok: false, message: e?.message && !/^[A-Z][a-zA-Z]+Error/.test(e.message) ? e.message : 'The export stopped before it finished. Check that there is enough free space and try again.', warnings: [] })
      }
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  // Sidecars that travel with copied or zipped keepers, so ratings survive the move.
  const keeperSidecars = async () => {
    const map = new Map<string, string>()
    for (const r of rated) {
      if (r.tags.rating !== prefs.keeperStars || r.tags.label) continue
      const text = r.source.xmp ? mergeSidecar(await r.source.xmp.text(), r.tags) : freshSidecar(r.tags)
      if (text) map.set(r.source.id, text)
    }
    return map
  }

  const writeRatings = () =>
    run('ratings', async (signal) => {
      if (canWriteFolders && s.dirHandle) return writeSidecarsToFolder(s.dirHandle, rated, setProgress, signal)
      const { entries, warnings } = await sidecarEntries(rated)
      const out = await downloadAsZip(`${s.name} ratings`, entries, setProgress, signal)
      return { message: `${out.message} Unzip it into the shoot folder, next to the RAW files.`, warnings }
    })

  const copy = () => run('copy', async (signal) => copyToFolder(keepers, await keeperSidecars(), setProgress, signal))
  const zip = () => run('zip', async (signal) => downloadAsZip(`${s.name} keepers`, fileEntries(keepers, await keeperSidecars()), setProgress, signal))

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const busy = (job: Job) => running === job
  const progressBlock = (job: Job) =>
    busy(job) && (
      <div className={styles.progress}>
        <div className={styles.bar} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Export progress">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.progressText}>
          {progress ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}${progress.label ? ` · ${progress.label}` : ''}` : 'Waiting for you to pick a location'}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => abort.current?.abort()}>
          Stop
        </button>
      </div>
    )
  const outcomeBlock = (job: Job) =>
    outcome?.job === job && (
      <div className={styles.outcome} data-ok={outcome.ok || undefined} role="status">
        {outcome.ok ? <CircleCheck /> : <TriangleAlert />}
        <div>
          <p>{outcome.message}</p>
          {outcome.warnings.slice(0, 3).map((w) => (
            <p key={w} className={styles.warning}>
              {w}
            </p>
          ))}
        </div>
      </div>
    )

  return (
    <Dialog open={open} onClose={onClose} title={`Export ${keepers.length.toLocaleString()} keepers`} size="lg">
      <p className={styles.summary}>
        {keepers.length.toLocaleString()} keepers · {formatBytes(bytes)} · {rawCount.toLocaleString()} RAW {rawCount === 1 ? 'file' : 'files'} with a decision
      </p>
      <div className={styles.options}>
        <section className={styles.option} aria-labelledby="ex-ratings">
          <div className={styles.optionIcon} aria-hidden="true">
            <Star />
          </div>
          <div className={styles.optionBody}>
            <h3 id="ex-ratings">Ratings for Lightroom and Capture One</h3>
            <p>
              Writes small .xmp files next to your RAW files. Keepers get {prefs.keeperStars} {prefs.keeperStars === 1 ? 'star' : 'stars'}
              {prefs.rejectLabel === 'Red' ? ' and rejects get a red label' : ''}. Import the folder, or use Metadata, Read Metadata from Files, then filter by rating.
            </p>
            <div className={styles.controls}>
              <div className="segmented" role="group" aria-label="Stars for keepers">
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <button key={n} type="button" aria-pressed={prefs.keeperStars === n} onClick={() => setPrefs({ keeperStars: n })} aria-label={`${n} stars`}>
                    {n}★
                  </button>
                ))}
              </div>
              <label className={styles.check}>
                <input type="checkbox" checked={prefs.rejectLabel === 'Red'} onChange={(e) => setPrefs({ rejectLabel: e.currentTarget.checked ? 'Red' : 'none' })} />
                Label rejects red
              </label>
            </div>
            {rawCount === 0 ? (
              <p className={styles.note}>This shoot has no RAW files. JPEG and HEIC photos keep ratings inside the file, so use one of the options below for them.</p>
            ) : (
              <button type="button" className="btn btn-primary" onClick={writeRatings} disabled={!!running}>
                {busy('ratings') ? <LoaderCircle className={styles.spin} /> : <Star />}
                {canWriteFolders && s.dirHandle ? `Save ratings into "${s.name}"` : 'Download ratings (.zip)'}
              </button>
            )}
            {progressBlock('ratings')}
            {outcomeBlock('ratings')}
          </div>
        </section>

        <section className={styles.option} aria-labelledby="ex-copy">
          <div className={styles.optionIcon} aria-hidden="true">
            <FolderInput />
          </div>
          <div className={styles.optionBody}>
            <h3 id="ex-copy">Copy keepers to a folder</h3>
            <p>Copies every keeper, with its RAW and JPEG files and ratings, into a folder you choose. Your originals are not moved.</p>
            {canWriteFolders ? (
              <button type="button" className="btn" onClick={copy} disabled={!!running || !keepers.length}>
                {busy('copy') ? <LoaderCircle className={styles.spin} /> : <FolderInput />}
                Choose a folder
              </button>
            ) : (
              <p className={styles.note}>Your browser cannot save into folders. Use Chrome or Edge on a computer, or download a ZIP below.</p>
            )}
            {progressBlock('copy')}
            {outcomeBlock('copy')}
          </div>
        </section>

        <section className={styles.option} aria-labelledby="ex-zip">
          <div className={styles.optionIcon} aria-hidden="true">
            <FileArchive />
          </div>
          <div className={styles.optionBody}>
            <h3 id="ex-zip">Download keepers as a ZIP</h3>
            <p>Works in every browser. Photos are stored as they are, with no recompression.</p>
            <button type="button" className="btn" onClick={zip} disabled={!!running || !keepers.length}>
              {busy('zip') ? <LoaderCircle className={styles.spin} /> : <FileArchive />}
              Download ZIP ({formatBytes(bytes)})
            </button>
            {progressBlock('zip')}
            {outcomeBlock('zip')}
          </div>
        </section>
      </div>
    </Dialog>
  )
}
