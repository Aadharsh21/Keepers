import { Check, Copy, EyeOff, Focus, Moon, Sun, X } from 'lucide-react'
import { memo } from 'react'
import type { Assessment } from '../../lib/engine/types'
import type { PhotoEntry } from '../../lib/store/session'
import type { Verdict } from '../../lib/types'
import styles from './Thumb.module.css'

interface Props {
  id: string
  entry: PhotoEntry
  assessment?: Assessment
  verdict?: Verdict
  overridden?: boolean
  selected: boolean
  momentSize?: number
  /** Fixed height for moment strips; grid tiles fill their cell instead. */
  height?: number
  onSelect: (id: string) => void
  onOpen?: (id: string) => void
}

function describe(name: string, a: Assessment | undefined, verdict: Verdict | undefined, size: number | undefined) {
  const parts = [name]
  if (verdict) parts.push(verdict === 'keep' ? 'keeper' : 'rejected')
  if (a?.rank === 0 && size && size > 1) parts.push(`best of ${size}`)
  if (a?.issues.length) parts.push(a.issues.join(', ').replace('-', ' '))
  if (a?.needsLook) parts.push('needs a look')
  return parts.join(', ')
}

export const Thumb = memo(function Thumb({ id, entry, assessment, verdict, overridden, selected, momentSize, height, onSelect, onOpen }: Props) {
  const f = entry.features
  const aspect = f ? f.width / f.height : 1.5
  const issues = assessment?.issues ?? []
  const best = assessment?.rank === 0 && (momentSize ?? 0) > 1
  return (
    <button
      type="button"
      className={styles.thumb}
      style={height ? { height, width: Math.round(height * aspect) } : undefined}
      data-verdict={verdict}
      data-selected={selected || undefined}
      data-fill={!height || undefined}
      aria-pressed={selected}
      aria-label={describe(entry.source.name, assessment, verdict, momentSize)}
      data-photo-id={id}
      onClick={() => onSelect(id)}
      onDoubleClick={() => onOpen?.(id)}
    >
      {entry.thumbUrl ? (
        <img src={entry.thumbUrl} alt="" draggable={false} decoding="async" />
      ) : (
        <span className={`skeleton ${styles.placeholder}`} />
      )}
      {verdict && (
        <span className={styles.verdict} data-overridden={overridden || undefined} aria-hidden="true">
          {verdict === 'keep' ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}
        </span>
      )}
      {best && (
        <span className={styles.best} aria-hidden="true">
          Best
        </span>
      )}
      {assessment?.needsLook && !overridden && <span className={styles.look} aria-hidden="true" title="Needs a look" />}
      {issues.length > 0 && (
        <span className={styles.issues} aria-hidden="true">
          {(issues.includes('eyes-closed') || issues.includes('blink')) && <EyeOff />}
          {issues.includes('soft') && <Focus />}
          {issues.includes('overexposed') && <Sun />}
          {issues.includes('underexposed') && <Moon />}
          {issues.includes('duplicate') && <Copy />}
        </span>
      )}
    </button>
  )
})
