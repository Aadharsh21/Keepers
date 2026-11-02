import { Link } from '../router'
import styles from './Logo.module.css'

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={styles.mark}>
      <rect width="32" height="32" rx="8" className={styles.tile} />
      <path d="M9 7h4v7.2L19.6 7H24l-7 7.4L24.4 25H19.7l-5.2-7.6-1.5 1.6V25H9z" className={styles.glyph} />
    </svg>
  )
}

export function Logo() {
  return (
    <Link href="/" className={styles.logo} aria-label="Keeper home">
      <LogoMark />
      <span className={styles.word}>Keeper</span>
    </Link>
  )
}
