import { Logo } from '../../components/Logo'
import { ThemeToggle } from '../../components/ThemeToggle'
import { Link } from '../../router'
import { useSession } from '../../lib/store/session'
import { Analyzing } from './Analyzing'
import { OpenScreen } from './OpenScreen'
import { Review } from './Review'
import styles from './CullPage.module.css'

export default function CullPage() {
  const phase = useSession((s) => s.phase)
  const autoSample = new URLSearchParams(window.location.search).has('sample')
  if (phase === 'analyzing') return <Analyzing />
  if (phase === 'review') return <Review />
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Logo />
        <nav className={styles.nav} aria-label="Site">
          <Link href="/" className={styles.navLink}>
            How it works
          </Link>
          <ThemeToggle />
        </nav>
      </header>
      <OpenScreen autoSample={autoSample} />
    </div>
  )
}
