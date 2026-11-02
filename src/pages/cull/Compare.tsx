import { Check, ScanFace, X } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Dialog } from '../../components/Dialog'
import { subjectFaces } from '../../lib/engine/score'
import type { Assessment, Moment } from '../../lib/engine/types'
import { setPrefs, usePrefs } from '../../lib/store/prefs'
import { setVerdict, type PhotoEntry } from '../../lib/store/session'
import type { FaceInfo, Verdict } from '../../lib/types'
import { formatTime } from './lists'
import { prefetchPreviews, usePreview } from './usePreview'
import styles from './Compare.module.css'

interface Props {
  moment: Moment | null
  entries: Map<string, PhotoEntry>
  byId: Map<string, Assessment>
  verdictOf: (id: string) => Verdict | undefined
  initialId?: string | null
  onClose: () => void
}

function FaceCrop({ url, face, width, height }: { url: string; face: FaceInfo; width: number; height: number }) {
  // Square crop around the face, 1.3x its size, positioned with percentages of the crop.
  const fw = face.box.w * width
  const fh = face.box.h * height
  const side = Math.max(fw, fh) * 1.3
  const cx = (face.box.x + face.box.w / 2) * width
  const cy = (face.box.y + face.box.h * 0.45) * height
  const style = {
    width: `${(width / side) * 100}%`,
    left: `${(-(cx - side / 2) / side) * 100}%`,
    top: `${(-(cy - side / 2) / side) * 100}%`,
  }
  const closed = Math.min(face.blink[0], face.blink[1]) >= 0.55
  return (
    <div className={styles.face} data-closed={closed || undefined}>
      <img src={url} alt="" style={style} draggable={false} />
      {closed && <span className={styles.faceTag}>Eyes closed</span>}
    </div>
  )
}

function Frame({
  entry,
  assessment,
  verdict,
  active,
  showFaces,
  onActivate,
}: {
  entry: PhotoEntry
  assessment?: Assessment
  verdict?: Verdict
  active: boolean
  showFaces: boolean
  onActivate: () => void
}) {
  const { url } = usePreview(entry.source)
  const f = entry.features
  const faces = f ? subjectFaces(f.faces).slice(0, 3) : []
  const src = url ?? entry.thumbUrl
  return (
    <article className={styles.frame} data-active={active || undefined} data-verdict={verdict} onClick={onActivate}>
      <div className={styles.imageWrap}>{src && <img className={styles.image} src={src} alt={entry.source.name} draggable={false} />}</div>
      {showFaces && faces.length > 0 && src && f && (
        <div className={styles.faces} style={{ '--n': faces.length } as CSSProperties}>
          {faces.map((face, i) => (
            <FaceCrop key={i} url={src} face={face} width={f.width} height={f.height} />
          ))}
        </div>
      )}
      <div className={styles.meta}>
        <div className={styles.metaText}>
          <span className={styles.name}>{entry.source.name}</span>
          <span className={styles.sub}>
            {assessment?.rank === 0 ? 'Best' : assessment ? `#${assessment.rank + 1}` : ''}
            {assessment && ` · focus ${Math.max(1, Math.round(assessment.focusRel * 100))}%`}
            {assessment?.eyes === 'closed' && ' · eyes closed'}
            {assessment?.eyes === 'some-closed' && ' · a blink'}
          </span>
        </div>
        <div className={styles.toggle} role="group" aria-label={`Decision for ${entry.source.name}`}>
          <button
            type="button"
            className="icon-btn"
            data-on={verdict === 'keep' || undefined}
            data-kind="keep"
            aria-pressed={verdict === 'keep'}
            aria-label="Keep"
            onClick={(e) => {
              e.stopPropagation()
              setVerdict(entry.source.id, 'keep')
            }}
          >
            <Check />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-on={verdict === 'reject' || undefined}
            data-kind="reject"
            aria-pressed={verdict === 'reject'}
            aria-label="Reject"
            onClick={(e) => {
              e.stopPropagation()
              setVerdict(entry.source.id, 'reject')
            }}
          >
            <X />
          </button>
        </div>
      </div>
    </article>
  )
}

export function Compare({ moment, entries, byId, verdictOf, initialId, onClose }: Props) {
  const { showFaces } = usePrefs()
  const ids = useMemo(
    () =>
      moment
        ? [...moment.photoIds].sort((a, b) => (entries.get(a)?.features?.captureTime ?? 0) - (entries.get(b)?.features?.captureTime ?? 0) || entries.get(a)!.order - entries.get(b)!.order)
        : [],
    [moment, entries],
  )
  const [active, setActive] = useState(() => Math.max(0, initialId ? ids.indexOf(initialId) : 0))
  useEffect(() => {
    prefetchPreviews(ids.map((id) => entries.get(id)?.source))
  }, [ids, entries])

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Let Enter and Space press the focused button as usual.
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).closest('button')) return
    const id = ids[active]
    const key = e.key.toLowerCase()
    if (key === 'arrowright') setActive((a) => Math.min(ids.length - 1, a + 1))
    else if (key === 'arrowleft') setActive((a) => Math.max(0, a - 1))
    else if ((key === 'p' || key === 'k') && id) setVerdict(id, 'keep')
    else if ((key === 'x' || key === 'r') && id) setVerdict(id, 'reject')
    else if (key === 'u' && id) setVerdict(id, null)
    else if (key === 'f') setPrefs({ showFaces: !showFaces })
    else return
    e.preventDefault()
  }

  const title = moment ? `${formatTime(moment.start) ?? 'Moment'} · ${ids.length} photos` : ''
  return (
    <Dialog
      open={!!moment}
      onClose={onClose}
      title={title}
      size="full"
      onKeyDown={onKey}
      headerExtra={
        <button type="button" className={`btn btn-sm ${showFaces ? 'btn-primary' : ''}`} aria-pressed={showFaces} onClick={() => setPrefs({ showFaces: !showFaces })}>
          <ScanFace /> Faces <kbd>F</kbd>
        </button>
      }
    >
      <div
        className={styles.grid}
        style={{ '--cols': Math.min(ids.length, 4) } as CSSProperties}
        data-faces={showFaces || undefined}
        aria-label="Frames in this moment. Arrow keys move, P keeps, X rejects."
      >
        {ids.map((id, i) => {
          const entry = entries.get(id)
          if (!entry) return null
          return (
            <Frame
              key={id}
              entry={entry}
              assessment={byId.get(id)}
              verdict={verdictOf(id)}
              active={i === active}
              showFaces={showFaces}
              onActivate={() => setActive(i)}
            />
          )
        })}
      </div>
    </Dialog>
  )
}
