import { Clock, FolderOpen, Images, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ACCEPT_ATTR, FORMAT_LABELS } from '../../lib/formats/detect'
import { fromDataTransfer, fromDirectoryHandle, fromFileList, type FileWithPath } from '../../lib/ingest/collect'
import { loadSampleShoot, sampleManifest } from '../../lib/ingest/sample'
import { deleteSession, recentSessions, type SavedSession } from '../../lib/store/db'
import { dismissNotice, openShoot, showNotice, useSession } from '../../lib/store/session'
import styles from './OpenScreen.module.css'

type ShowDirectoryPicker = (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
const pickerSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function OpenScreen({ autoSample }: { autoSample?: boolean }) {
  const notice = useSession((s) => s.notice)
  const [busy, setBusy] = useState<null | 'folder' | 'files' | 'sample' | 'drop' | string>(null)
  const [dragging, setDragging] = useState(false)
  const [hasSample, setHasSample] = useState(false)
  const [recent, setRecent] = useState<SavedSession[] | null>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const startedSample = useRef(false)

  useEffect(() => {
    void sampleManifest().then((m) => setHasSample(!!m))
    void recentSessions(3).then(setRecent)
  }, [])

  const start = async (kind: string, load: () => Promise<{ files: FileWithPath[]; name: string; handle?: FileSystemDirectoryHandle | null; isSample?: boolean } | null>) => {
    if (busy) return
    setBusy(kind)
    dismissNotice()
    try {
      const loaded = await load()
      if (loaded) await openShoot(loaded)
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error(err)
        showNotice('Keeper could not open those files. If they are on a memory card, copy them to your computer and try again.')
      }
    } finally {
      setBusy(null)
    }
  }

  const openFolder = () => {
    if (!pickerSupported) {
      folderInput.current?.click()
      return
    }
    void start('folder', async () => {
      const handle = await (window as unknown as { showDirectoryPicker: ShowDirectoryPicker }).showDirectoryPicker({ id: 'keeper-shoot', mode: 'read' })
      return { files: await fromDirectoryHandle(handle), name: handle.name, handle }
    })
  }

  const openSample = () =>
    start('sample', async () => {
      const shoot = await loadSampleShoot()
      return { files: shoot.files, name: shoot.name, isSample: true }
    })

  useEffect(() => {
    if (autoSample && hasSample && !startedSample.current) {
      startedSample.current = true
      void openSample()
    }
    // openSample is stable enough for a one-time auto start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSample, hasSample])

  const resume = (s: SavedSession) => {
    if (s.isSample) {
      void openSample()
      return
    }
    const handle = s.dirHandle as (FileSystemDirectoryHandle & { requestPermission?: (o: { mode: string }) => Promise<string> }) | undefined
    if (handle?.requestPermission) {
      void start(s.key, async () => {
        const permission = await handle.requestPermission!({ mode: 'read' })
        if (permission !== 'granted') {
          showNotice(`Keeper needs permission to read "${s.name}" again. Open the folder to continue.`)
          return null
        }
        return { files: await fromDirectoryHandle(handle), name: handle.name, handle }
      })
    } else {
      // Reopening the same folder matches the saved decisions automatically.
      openFolder()
    }
  }

  const forget = async (s: SavedSession) => {
    await deleteSession(s.key)
    setRecent((r) => r?.filter((x) => x.key !== s.key) ?? null)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dt = e.dataTransfer
    void start('drop', async () => {
      const r = await fromDataTransfer(dt)
      return { files: r.files, name: r.name, handle: r.handle }
    })
  }

  return (
    <main className={styles.page}>
      <section
        className={styles.drop}
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={onDrop}
        aria-labelledby="open-title"
      >
        <div className={styles.icon} aria-hidden="true">
          <Images />
        </div>
        <h1 id="open-title" className={styles.title}>
          Open a shoot
        </h1>
        <p className={styles.lede}>
          Pick the folder you copied from your memory card, or drop it here. Keeper reads every photo on this computer: nothing is uploaded.
        </p>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary btn-lg" onClick={openFolder} disabled={!!busy}>
            {busy === 'folder' || busy === 'drop' ? <LoaderCircle className={styles.spin} /> : <FolderOpen />}
            {busy === 'folder' || busy === 'drop' ? 'Reading folder' : 'Open a folder'}
          </button>
          <button type="button" className="btn btn-lg" onClick={() => filesInput.current?.click()} disabled={!!busy}>
            {busy === 'files' ? <LoaderCircle className={styles.spin} /> : <Images />}
            Choose photos
          </button>
        </div>
        {hasSample && (
          <p className={styles.sample}>
            No photos handy?{' '}
            <button type="button" className={styles.linkBtn} onClick={openSample} disabled={!!busy}>
              {busy === 'sample' ? 'Loading the sample shoot' : 'Try a sample shoot'}
            </button>
          </p>
        )}
        <p className={styles.formats}>{FORMAT_LABELS.join(' · ')}</p>
        <input
          ref={folderInput}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            const list = e.currentTarget.files
            if (!list?.length) return
            const first = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
            const name = first.split('/')[0] || 'Photos'
            const files = fromFileList(list)
            e.currentTarget.value = ''
            void start('folder', async () => ({ files, name }))
          }}
        />
        <input
          ref={filesInput}
          type="file"
          hidden
          multiple
          accept={ACCEPT_ATTR}
          onChange={(e) => {
            const list = e.currentTarget.files
            if (!list?.length) return
            const files = fromFileList(list)
            e.currentTarget.value = ''
            void start('files', async () => ({ files, name: 'Selected photos' }))
          }}
        />
      </section>

      {notice && (
        <div className={styles.notice} role="alert">
          <TriangleAlert aria-hidden="true" />
          <p>{notice}</p>
          <button type="button" className="icon-btn" onClick={dismissNotice} aria-label="Dismiss">
            <X />
          </button>
        </div>
      )}

      {recent === null ? (
        <div className={styles.recent} aria-hidden="true">
          <div className={`skeleton ${styles.recentSkeleton}`} />
        </div>
      ) : (
        recent.length > 0 && (
          <section className={styles.recent} aria-labelledby="recent-title">
            <h2 id="recent-title" className={styles.recentTitle}>
              Pick up where you left off
            </h2>
            <ul className={styles.recentList}>
              {recent.map((s) => (
                <li key={s.key} className={styles.recentItem}>
                  <div className={styles.recentText}>
                    <span className={styles.recentName}>{s.name}</span>
                    <span className={styles.recentMeta}>
                      <Clock aria-hidden="true" /> {timeAgo(s.updatedAt)} · {s.photoCount.toLocaleString()} photos ·{' '}
                      {s.keepCount.toLocaleString()} keepers
                    </span>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => resume(s)} disabled={!!busy}>
                    {busy === s.key ? 'Opening' : 'Continue'}
                  </button>
                  <button type="button" className="icon-btn" onClick={() => void forget(s)} aria-label={`Forget ${s.name}`} title="Forget">
                    <X />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {!pickerSupported && (
        <p className={styles.browserNote}>
          Tip: in Chrome or Edge, Keeper can also save keepers straight into your folder. In this browser, exports download as a ZIP.
        </p>
      )}
    </main>
  )
}
