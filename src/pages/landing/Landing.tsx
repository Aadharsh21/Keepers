import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LogoMark } from '../../components/Logo'
import { ThemeToggle } from '../../components/ThemeToggle'
import { sampleManifest, type Manifest } from '../../lib/ingest/sample'
import { Link } from '../../router'
import styles from './Landing.module.css'

const REPO = 'https://github.com/Aadharsh21/Keepers'

const FORMATS = ['Canon CR3', 'Canon CR2', 'Sony ARW', 'Nikon NEF', 'Fujifilm RAF', 'Panasonic RW2', 'Olympus ORF', 'Adobe DNG', 'iPhone HEIC', 'JPEG']

const FEATURES = [
  {
    id: 'moments',
    title: 'Moments',
    tagline: 'Bursts become moments.',
    text: 'Frames shot seconds apart that show the same scene are grouped, ranked, and the best one is kept. You review moments, not two thousand files.',
    tags: ['Grouping', 'Image embeddings', 'Layout hash'],
    alt: 'Keeper reviewing a sample shoot: each moment is a row of frames with the best one kept.',
  },
  {
    id: 'faces',
    title: 'Faces',
    tagline: 'Focus where it matters.',
    text: 'Sharpness is measured on the eyes, and every face gets blink and smile scores, so a crisp frame of a blink loses to a slightly softer smile.',
    tags: ['Eye focus', 'Blink detection'],
    alt: 'Compare view: every frame of a moment side by side with zoomed face crops.',
  },
  {
    id: 'screens',
    title: 'Screenshots',
    tagline: 'Not every file is a photo.',
    text: 'Screenshots and graphics are recognised by name, by the tag phones write, or by their drawn pixels, then set aside instead of being judged like photos.',
    tags: ['Detection'],
    alt: 'Screenshots collected in their own group with keep all and reject all.',
  },
  {
    id: 'export',
    title: 'Export',
    tagline: 'Back to Lightroom in one step.',
    text: 'Star ratings and labels land in .xmp sidecars, merged without touching your edits. Or copy the keepers into a folder, or stream a ZIP.',
    tags: ['XMP', 'Lightroom', 'Capture One'],
    alt: 'Export options: ratings for Lightroom and Capture One, copy to a folder, or download a ZIP.',
  },
]

const CHECKS = [
  { title: 'Focus', items: ['Eye sharpness', 'Subject sharpness', 'Soft against the shoot'] },
  { title: 'Faces', items: ['Closed eyes', 'Mid blinks', 'Smiles', 'Who looked away'] },
  { title: 'Frames', items: ['Bursts and repeats', 'Exact duplicates', 'Blown highlights', 'Underexposure', 'Screenshots'] },
]

const READS: [string, string, string][] = [
  ['Canon', 'CR2, CR3', 'Embedded preview'],
  ['Sony', 'ARW', 'Embedded preview'],
  ['Nikon', 'NEF', 'Embedded preview'],
  ['Fujifilm', 'RAF', 'Embedded preview'],
  ['Panasonic, Olympus', 'RW2, ORF', 'Embedded preview'],
  ['Adobe and phones', 'DNG', 'Embedded preview'],
  ['iPhone and Android', 'HEIC, JPEG', 'Decoded directly'],
]

const WRITES: [string, string, string][] = [
  ['Lightroom Classic and Lightroom', 'Stars and labels', '.xmp sidecar'],
  ['Capture One and Bridge', 'Stars and labels', '.xmp sidecar'],
  ['Any folder', 'Keepers with their RAW and JPEG', 'Copy'],
  ['Anywhere', 'Keepers as they are', 'ZIP'],
]

/** Fades a block up the first time it scrolls into view. */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`${styles.reveal} ${className ?? ''}`} data-shown={shown || undefined}>
      {children}
    </div>
  )
}

function Row({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <section className={styles.row} id={id} aria-label={label}>
      <h2 className={styles.label}>{label}</h2>
      <div className={styles.content}>{children}</div>
    </section>
  )
}

export default function Landing() {
  const [sample, setSample] = useState<Manifest | null>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    void sampleManifest().then(setSample)
    const onScroll = () => setScrolled(window.scrollY > 160)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Keeper home">
          <LogoMark />
          <span className={styles.brandText} data-visible={scrolled || undefined}>
            Keeper <span className={styles.dim}>· Photo culling</span>
          </span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <a href="#how" className={styles.navLink}>
            How it works
          </a>
          <a href={REPO} className={styles.navLink} target="_blank" rel="noreferrer">
            Source
          </a>
          <ThemeToggle />
          <Link href="/cull" className={styles.navCta}>
            Open Keeper
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className={styles.intro} aria-labelledby="intro-title">
          <div className={styles.introLabel}>
            <p>Keeper</p>
            <p className={styles.dim}>Photo culling in your browser</p>
          </div>
          <div className={styles.introBody}>
            <h1 id="intro-title" className={styles.headline}>
              Find your keepers. Skip the grind.
            </h1>
            <p className={styles.sub}>
              Keeper culls a whole shoot on your computer: it groups bursts, checks focus on the eyes, catches blinks, and picks the best frame of every
              moment. Your photos are never uploaded.
            </p>
            <div className={styles.actions}>
              <Link href="/cull" className="btn btn-primary btn-lg">
                Open a shoot
              </Link>
              {sample && (
                <Link href="/cull?sample" className="btn btn-lg">
                  Try the sample shoot
                </Link>
              )}
            </div>
            {sample?.credit && (
              <p className={styles.credit}>
                Sample: real phone bursts from the{' '}
                <a href={sample.credit.url} target="_blank" rel="noreferrer">
                  {sample.credit.text}
                </a>
                ,{' '}
                <a href={sample.credit.licenseUrl} target="_blank" rel="noreferrer">
                  {sample.credit.license}
                </a>
              </p>
            )}
            <div className={styles.marquee} aria-label="Formats Keeper reads">
              <ul className={styles.marqueeTrack}>
                {[...FORMATS, ...FORMATS].map((f, i) => (
                  <li key={i} className={styles.tile} aria-hidden={i >= FORMATS.length || undefined}>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={styles.work} aria-label="Features">
          {FEATURES.map((f) => (
            <Reveal key={f.id} className={styles.project}>
              <div className={styles.projectMeta}>
                <h2 className={styles.projectTitle}>{f.title}</h2>
                <p>{f.tagline}</p>
                <p className={styles.dim}>{f.text}</p>
                <ul className={styles.tags}>
                  {f.tags.map((t) => (
                    <li key={t} className="tag">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <figure className={styles.media}>
                <img className="only-dark" src={`/media/${f.id}-dark.webp`} alt={f.alt} loading="lazy" decoding="async" width={1440} height={900} />
                <img className="only-light" src={`/media/${f.id}-light.webp`} alt={f.alt} loading="lazy" decoding="async" width={1440} height={900} />
              </figure>
            </Reveal>
          ))}
        </section>

        <Reveal>
          <Row label="How it works" id="how">
            <p className={styles.lead}>
              Keeper is a website, but nothing leaves your computer. Photos are read from disk, analysed in Web Workers with on-device models, and remembered in
              your browser so a shoot reopens instantly.
            </p>
            <div className={styles.prose}>
              <p>
                RAW files are read through the full-size JPEG the camera embeds, found by a small parser for TIFF and ISO media containers, so a Canon CR3 opens
                as fast as a JPEG.
              </p>
              <p>
                Each frame gets a focus map, an exposure histogram, a layout hash, face landmarks with blink and smile scores, and an image fingerprint.
                Frames that belong together become one moment, and the best one is kept.
              </p>
              <p>Every decision comes with its reason. One key flips any call, and close calls are marked for a second look.</p>
            </div>
          </Row>
        </Reveal>

        <Reveal>
          <Row label="What it checks">
            <div className={styles.columns}>
              {CHECKS.map((c) => (
                <div key={c.title}>
                  <h3 className={styles.colTitle}>{c.title}</h3>
                  <ul className={styles.list}>
                    {c.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Row>
        </Reveal>

        <Reveal>
          <Row label="Reads">
            <table className={styles.table}>
              <tbody>
                {READS.map(([a, b, c]) => (
                  <tr key={a}>
                    <th scope="row">{a}</th>
                    <td className={styles.dim}>{b}</td>
                    <td className={styles.dim}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Row>
        </Reveal>

        <Reveal>
          <Row label="Writes">
            <table className={styles.table}>
              <tbody>
                {WRITES.map(([a, b, c]) => (
                  <tr key={a}>
                    <th scope="row">{a}</th>
                    <td className={styles.dim}>{b}</td>
                    <td className={styles.dim}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Row>
        </Reveal>

        <Reveal>
          <Row label="Privacy">
            <ol className={styles.notes}>
              <li>
                <sup>1</sup> Photos are read from your disk and never uploaded.
              </li>
              <li>
                <sup>2</sup> No account, no tracking, nothing to sign up for.
              </li>
              <li>
                <sup>3</sup> After your first visit, culling works with no connection.
              </li>
              <li>
                <sup>4</sup> A strict Content Security Policy keeps the page from talking to anything else.
              </li>
            </ol>
            <p className={styles.after}>
              <a href={REPO} target="_blank" rel="noreferrer">
                Read the source on GitHub
              </a>
            </p>
          </Row>
        </Reveal>

        <Reveal>
          <Row label="Built with">
            <p className={styles.dim}>
              React, TypeScript, Vite, Web Workers, WebAssembly, MediaPipe Face Landmarker, MobileNetV3, IndexedDB, a service worker and Netlify.
            </p>
          </Row>
        </Reveal>
      </main>

      <footer className={styles.footer}>
        <Link href="/cull">Open Keeper</Link>
        <span className={styles.dim}>© 2026 Aadharsh Arunn</span>
      </footer>
    </div>
  )
}
