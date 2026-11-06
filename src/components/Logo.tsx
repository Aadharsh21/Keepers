import { Link } from '../router'
import styles from './Logo.module.css'

/** Viewfinder corners around a focus point. Drawn in currentColor. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={styles.mark} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
      <path d="M3 8.5V3h5.5M15.5 3H21v5.5M21 15.5V21h-5.5M8.5 21H3v-5.5" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function Logo({ label }: { label?: string }) {
  return (
    <Link href="/" className={styles.logo} aria-label="Keepers home">
      <LogoMark />
      {label !== '' && <span className={styles.word}>{label ?? 'Keepers'}</span>}
    </Link>
  )
}
