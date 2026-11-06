import { Check, CircleCheck, CircleX, Info, RotateCcw, ScanFace, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Assessment, Moment } from '../../lib/engine/types'
import { setPrefs, usePrefs } from '../../lib/store/prefs'
import { setVerdict, type PhotoEntry } from '../../lib/store/session'
import type { Verdict } from '../../lib/types'
import { formatTime } from './lists'
import { usePreview } from './usePreview'
import styles from './Inspector.module.css'

interface Props {
  entry: PhotoEntry
  assessment?: Assessment
  moment?: Moment
  verdict?: Verdict
  overridden: boolean
}

function shutter(t?: number) {
  if (!t) return null
  return t >= 1 ? `${Math.round(t * 10) / 10} s` : `1/${Math.round(1 / t)} s`
}

function cameraLine(e: PhotoEntry): string | null {
  const f = e.features
  if (!f) return null
  const bits = [
    shutter(f.exposureTime),
    f.fNumber ? `f/${Math.round(f.fNumber * 10) / 10}` : null,
    f.iso ? `ISO ${f.iso}` : null,
    f.focalLength ? `${Math.round(f.focalLength)} mm` : null,
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : null
}

export function Inspector({ entry, assessment, moment, verdict, overridden }: Props) {
  const { url } = usePreview(entry.source)
  const { showFaces } = usePrefs()
  const f = entry.features
  const id = entry.source.id
  const exposureLabel = !f
    ? ''
    : assessment?.issues.includes('overexposed')
      ? `Blown highlights on ${Math.round(f.exposure.clipHigh * 100)}% of the frame`
      : assessment?.issues.includes('underexposed')
        ? 'Underexposed'
        : 'Looks good'
  const focusPct = assessment ? Math.round(assessment.focusRel * 100) : 0
  const autoVerdict = assessment?.verdict
  const camera = cameraLine(entry)
  const time = formatTime(f?.captureTime)

  return (
    <aside className={styles.inspector} aria-label="Selected photo">
      <div className={styles.stage}>
        {url || entry.thumbUrl ? (
          <div className={styles.frame} style={f ? ({ '--ar': f.width / f.height } as CSSProperties) : undefined}>
            <img src={url ?? entry.thumbUrl} alt={entry.source.name} className={styles.image} />
            {showFaces &&
              f?.faces.map((face, i) => (
                <span
                  key={i}
                  className={styles.faceBox}
                  data-closed={Math.min(face.blink[0], face.blink[1]) >= 0.55 || undefined}
                  style={{
                    left: `${face.box.x * 100}%`,
                    top: `${face.box.y * 100}%`,
                    width: `${face.box.w * 100}%`,
                    height: `${face.box.h * 100}%`,
                  }}
                />
              ))}
          </div>
        ) : (
          <div className={`skeleton ${styles.frameSkeleton}`} />
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h2 className={styles.name} title={entry.source.relPath}>
            {entry.source.name}
          </h2>
          {f?.faces.length ? (
            <button
              type="button"
              className="icon-btn"
              aria-pressed={showFaces}
              onClick={() => setPrefs({ showFaces: !showFaces })}
              title={showFaces ? 'Hide face boxes (F)' : 'Show face boxes (F)'}
              aria-label="Show face boxes"
            >
              <ScanFace />
            </button>
          ) : null}
        </div>
        {(time || f?.camera) && <p className={styles.meta}>{[time, f?.camera].filter(Boolean).join(' · ')}</p>}
        {camera && <p className={styles.meta}>{camera}</p>}

        <div className={styles.verdicts} role="group" aria-label="Decision">
          <button
            type="button"
            className="btn btn-keep"
            aria-pressed={verdict === 'keep'}
            onClick={() => setVerdict(id, 'keep')}
          >
            <Check /> Keep <kbd>P</kbd>
          </button>
          <button
            type="button"
            className="btn btn-reject"
            aria-pressed={verdict === 'reject'}
            onClick={() => setVerdict(id, 'reject')}
          >
            <X /> Reject <kbd>X</kbd>
          </button>
        </div>
        {overridden && autoVerdict && (
          <p className={styles.override}>
            You changed this. Keepers suggested {autoVerdict === 'keep' ? 'keeping' : 'rejecting'} it.
            <button type="button" className={styles.reset} onClick={() => setVerdict(id, null)}>
              <RotateCcw /> Undo <kbd>U</kbd>
            </button>
          </p>
        )}

        {assessment && (
          <section className={styles.section} aria-labelledby="why-title">
            <h3 id="why-title" className={styles.sectionTitle}>
              Why
            </h3>
            <ul className={styles.reasons}>
              {assessment.reasons.map((r) => (
                <li key={r.text} data-tone={r.tone}>
                  {r.tone === 'good' ? <CircleCheck /> : r.tone === 'bad' ? <CircleX /> : <Info />}
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {f && assessment && !assessment.issues.includes('screenshot') && (
          <section className={styles.section} aria-labelledby="checks-title">
            <h3 id="checks-title" className={styles.sectionTitle}>
              Checks
            </h3>
            <dl className={styles.checks}>
              <div>
                <dt>Focus</dt>
                <dd>
                  <span className={styles.meter} aria-hidden="true">
                    <span style={{ width: `${Math.max(4, focusPct)}%` }} data-low={focusPct < 50 || undefined} />
                  </span>
                  <span>{moment && moment.photoIds.length > 1 ? (focusPct >= 99 ? 'Sharpest in moment' : `${Math.max(1, focusPct)}% as sharp as the best`) : assessment.issues.includes('soft') ? 'Soft' : 'Sharp'}</span>
                </dd>
              </div>
              <div>
                <dt>Eyes</dt>
                <dd>
                  {!f.facesChecked
                    ? 'Not checked'
                    : assessment.eyes === 'none'
                      ? 'No faces found'
                      : assessment.eyes === 'open'
                        ? assessment.faces === 1
                          ? 'Open'
                          : `Open on all ${assessment.faces} faces`
                        : assessment.eyes === 'closed'
                          ? assessment.faces === 1
                            ? 'Closed'
                            : 'Closed on every face'
                          : `${assessment.closed || 'Some'} of ${assessment.faces} closed or mid-blink`}
                </dd>
              </div>
              <div>
                <dt>Exposure</dt>
                <dd>
                  <span className={styles.histogram} aria-hidden="true">
                    {f.exposure.histogram.map((v, i) => (
                      <span key={i} style={{ height: `${Math.max(2, v * 100)}%` }} />
                    ))}
                  </span>
                  <span>{exposureLabel}</span>
                </dd>
              </div>
              {moment && (
                <div>
                  <dt>Moment</dt>
                  <dd>
                    {moment.photoIds.length === 1 ? 'Only frame' : `Ranked ${assessment.rank + 1} of ${moment.photoIds.length}`}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}
        {entry.status === 'error' && <p className={styles.error}>{entry.error}</p>}
      </div>
    </aside>
  )
}
