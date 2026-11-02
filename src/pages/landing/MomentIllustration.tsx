import { Check, CircleCheck, X } from 'lucide-react'
import styles from './MomentIllustration.module.css'

/**
 * A drawn, honest picture of what Keeper does to one moment: five frames
 * from a burst, each with the problem Keeper would catch.
 */
type Variant = 'soft' | 'blink' | 'best' | 'blown' | 'softer'

const FRAMES: { v: Variant; label: string; keep: boolean }[] = [
  { v: 'soft', label: 'Soft focus', keep: false },
  { v: 'blink', label: 'Eyes closed', keep: false },
  { v: 'best', label: 'Best of 5', keep: true },
  { v: 'blown', label: 'Blown sky', keep: false },
  { v: 'softer', label: '74% as sharp', keep: false },
]

function Portrait({ v, id }: { v: Variant; id: string }) {
  const closed = v === 'blink'
  const blur = v === 'soft' ? 1.8 : v === 'softer' ? 0.7 : 0
  const smile = v === 'best' || v === 'softer'
  return (
    <svg viewBox="0 0 80 100" className={styles.svg} aria-hidden="true">
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={v === 'blown' ? '#fbf7ef' : '#c9d6dd'} />
          <stop offset="1" stopColor={v === 'blown' ? '#f1e6d2' : '#e8ddcc'} />
        </linearGradient>
        {blur > 0 && (
          <filter id={`blur-${id}`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation={blur} />
          </filter>
        )}
      </defs>
      <rect width="80" height="100" fill={`url(#sky-${id})`} />
      <g filter={blur > 0 ? `url(#blur-${id})` : undefined} opacity={v === 'blown' ? 0.72 : 1}>
        {/* Arch and garden behind the couple */}
        <path d="M6 100V46a34 34 0 0 1 68 0v54" fill="none" stroke={v === 'blown' ? '#efe5d4' : '#b9a68c'} strokeWidth="5" />
        <ellipse cx="14" cy="96" rx="20" ry="12" fill={v === 'blown' ? '#e6ecd9' : '#8fa37c'} />
        <ellipse cx="68" cy="98" rx="20" ry="12" fill={v === 'blown' ? '#e6ecd9' : '#7d9470'} />
        {/* Shoulders: suit and dress */}
        <path d="M14 100c2-17 10-24 22-25 7 0 11 4 12 25z" fill="#2f3440" />
        <path d="M38 100c1-15 8-22 18-22 10 0 16 8 17 22z" fill={v === 'blown' ? '#fbfaf7' : '#f4efe6'} />
        {/* Heads */}
        <circle cx="31" cy="56" r="11" fill="#c99a78" />
        <circle cx="55" cy="58" r="10" fill="#d8ab8b" />
        <path d="M20 54c0-10 7-14 12-14s11 3 11 11c-4-4-9-6-15-5-4 1-6 4-8 8z" fill="#3a2a22" />
        <path d="M44 60c-1-12 5-17 11-17 7 0 12 6 11 16 1 6 0 12-3 17l-2-15c-2-3-7-4-11-2z" fill="#6b4a33" />
        {/* Eyes */}
        {closed ? (
          <g stroke="#3a2a22" strokeWidth="1.1" fill="none" strokeLinecap="round">
            <path d="M25.5 57q2 1.4 4 0" />
            <path d="M32.5 57q2 1.4 4 0" />
            <path d="M50 59q2 1.4 4 0" />
            <path d="M56.5 59q2 1.4 4 0" />
          </g>
        ) : (
          <g fill="#2a1d17">
            <ellipse cx="27.5" cy="56.5" rx="1.2" ry="1.4" />
            <ellipse cx="34.5" cy="56.5" rx="1.2" ry="1.4" />
            <ellipse cx="52" cy="58.5" rx="1.1" ry="1.3" />
            <ellipse cx="58.5" cy="58.5" rx="1.1" ry="1.3" />
          </g>
        )}
        {/* Mouths */}
        <path d={smile ? 'M27 61.5q4 3.4 8 0' : 'M28 62h6'} stroke="#7a3f33" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d={smile ? 'M51.5 63.5q3.5 3 7 0' : 'M52.5 64h5'} stroke="#8a4538" strokeWidth="1" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export function MomentIllustration() {
  return (
    <figure className={styles.card} aria-label="Example: Keeper reviews five frames of one moment and keeps the third, which is sharp with everyone's eyes open.">
      <div className={styles.head}>
        <span className={styles.time}>5:02:09 PM</span>
        <span className={styles.meta}>5 photos · keeping 1</span>
      </div>
      <div className={styles.row}>
        {FRAMES.map((f, i) => (
          <div key={f.v} className={styles.frame} data-keep={f.keep || undefined} style={{ animationDelay: `${300 + i * 140}ms` }}>
            <div className={styles.photo}>
              <Portrait v={f.v} id={`f${i}`} />
              <span className={styles.chip} data-keep={f.keep || undefined} style={{ animationDelay: `${700 + i * 160}ms` }}>
                {f.keep ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}
              </span>
            </div>
            <span className={styles.label}>{f.label}</span>
          </div>
        ))}
      </div>
      <figcaption className={styles.why}>
        <span className={styles.whyTitle}>Why this one</span>
        <span>
          <CircleCheck aria-hidden="true" /> Sharpest eyes of the 5
        </span>
        <span>
          <CircleCheck aria-hidden="true" /> Both people have eyes open
        </span>
        <span>
          <CircleCheck aria-hidden="true" /> No blown highlights
        </span>
      </figcaption>
    </figure>
  )
}
