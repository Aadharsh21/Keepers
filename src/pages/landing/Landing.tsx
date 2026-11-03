import { ArrowRight, Copy, EyeOff, FileArchive, Focus, FolderInput, FolderOpen, Lock, Star, SunMedium, WifiOff, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from '../../components/Logo'
import { ThemeToggle } from '../../components/ThemeToggle'
import { sampleManifest } from '../../lib/ingest/sample'
import { Link } from '../../router'
import { MomentIllustration } from './MomentIllustration'
import styles from './Landing.module.css'

const REPO = 'https://github.com/Aadharsh21/Keepers'

const CHECKS = [
  {
    icon: Focus,
    title: 'Focus where it matters',
    text: 'Keeper measures sharpness on the eyes, not the background. A portrait at f/1.8 with a creamy backdrop is not marked soft.',
  },
  {
    icon: EyeOff,
    title: 'Blinks, even in group shots',
    text: 'Every face gets 52 expression readings. Keeper knows when one person in a group of eight closed their eyes.',
  },
  {
    icon: Copy,
    title: 'Bursts become moments',
    text: 'Frames shot seconds apart that show the same scene are grouped, ranked, and the best one is kept.',
  },
  {
    icon: SunMedium,
    title: 'Exposure you cannot save',
    text: 'Blown highlights and frames too dark to recover are flagged, with how much of the frame is clipped.',
  },
]

const FAQ = [
  {
    q: 'Do my photos get uploaded?',
    a: 'No. Keeper is a website, but the analysis runs on your computer with WebAssembly. Photos are read from your disk and never sent anywhere. After your first visit it even works offline, and you can install it like a desktop app.',
  },
  {
    q: 'Which files can it read?',
    a: 'JPEG, HEIC, PNG and WebP, plus RAW files from Canon (CR2, CR3), Sony (ARW), Nikon (NEF), Fujifilm (RAF), Panasonic (RW2), Olympus (ORF) and DNG. For RAW files Keeper uses the full-size preview the camera embeds, the same image you saw on the back of the camera.',
  },
  {
    q: 'How do my picks get into Lightroom?',
    a: 'Keeper writes .xmp sidecar files next to your RAW files with a star rating for keepers and a red label for rejects. Lightroom Classic, Lightroom and Capture One read them on import, or with Read Metadata from Files.',
  },
  {
    q: 'What if my folder has screenshots in it?',
    a: 'Keeper spots screenshots and graphics by their name, the screenshot tag phones add, or their flat drawn pixels, and sets them aside in their own group. They are never judged like photos, and one click keeps or rejects them all.',
  },
  {
    q: 'Does it replace my judgment?',
    a: 'It replaces the first pass. Keeper shows its reason for every decision, marks close calls for you to check, and one key flips any call. You stay the editor.',
  },
  {
    q: 'Which browser should I use?',
    a: 'Chrome or Edge on a computer gets everything, including saving straight into your folders. Safari and Firefox work too; exports download as a ZIP there.',
  },
]

export default function Landing() {
  const [hasSample, setHasSample] = useState(false)
  useEffect(() => {
    void sampleManifest().then((m) => setHasSample(!!m))
  }, [])

  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Logo />
          <nav className={styles.nav} aria-label="Main">
            <a href="#how" className={styles.navLink}>
              How it works
            </a>
            <a href="#privacy" className={styles.navLink}>
              Privacy
            </a>
            <a href={REPO} className={styles.navLink} target="_blank" rel="noreferrer">
              Source
            </a>
            <ThemeToggle />
            <Link href="/cull" className={`btn btn-primary btn-sm ${styles.navCta}`}>
              Open Keeper
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Photo culling that runs in your browser</p>
            <h1 className={styles.h1}>Find your keepers. Skip the grind.</h1>
            <p className={styles.lede}>
              Keeper culls a whole shoot in minutes. It groups bursts into moments, checks focus on the eyes, catches blinks and blown highlights, and
              picks the best frame of every moment. Your photos never leave your computer.
            </p>
            <div className={styles.ctas}>
              <Link href="/cull" className="btn btn-primary btn-lg">
                <FolderOpen /> Open a shoot
              </Link>
              {hasSample && (
                <Link href="/cull?sample" className="btn btn-lg">
                  Try a sample shoot <ArrowRight />
                </Link>
              )}
            </div>
            <p className={styles.fine}>Free. No sign-up. JPEG, HEIC and RAW from Canon, Sony, Nikon and more.</p>
          </div>
          <div className={styles.heroArt}>
            <MomentIllustration />
          </div>
        </section>

        <section id="how" className={styles.section} aria-labelledby="how-title">
          <div className={styles.sectionHead}>
            <h2 id="how-title" className={styles.h2}>
              From memory card to keepers in three steps
            </h2>
            <p className={styles.sectionLede}>A wedding can come home as 2,000 frames. Most are near repeats. Keeper does the first pass so you only judge the close calls.</p>
          </div>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <h3>Open the folder</h3>
              <p>Pick the folder you copied from your card, or drop it on the page. RAW+JPEG pairs count as one photo.</p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <h3>Keeper checks every frame</h3>
              <p>Focus on the eyes, blinks, exposure, and which shots belong to the same moment. You watch the grid fill in.</p>
            </li>
            <li className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <h3>Review and export</h3>
              <p>Flip any call with one key, compare frames side by side, then send ratings to Lightroom or copy the keepers out.</p>
            </li>
          </ol>
        </section>

        <section className={`${styles.section} ${styles.alt}`} aria-labelledby="checks-title">
          <div className={styles.sectionHead}>
            <h2 id="checks-title" className={styles.h2}>
              What Keeper looks at
            </h2>
            <p className={styles.sectionLede}>The same things you check at 100% zoom, measured on every frame, with a reason you can read for each decision.</p>
          </div>
          <div className={styles.checks}>
            {CHECKS.map(({ icon: Icon, title, text }) => (
              <article key={title} className={styles.check}>
                <span className={styles.checkIcon} aria-hidden="true">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="privacy" className={styles.section} aria-labelledby="privacy-title">
          <div className={styles.split}>
            <div>
              <h2 id="privacy-title" className={styles.h2}>
                Your photos never leave your computer
              </h2>
              <p className={styles.sectionLede}>
                Client work is private. Keeper loads its face and image models into your browser and does all the work there, on your own CPU. There is no
                server that sees a single pixel.
              </p>
            </div>
            <ul className={styles.facts}>
              <li>
                <Lock aria-hidden="true" />
                <div>
                  <strong>No uploads</strong>
                  <span>Files are read straight from your disk.</span>
                </div>
              </li>
              <li>
                <UserX aria-hidden="true" />
                <div>
                  <strong>No account</strong>
                  <span>Nothing to sign up for, nothing stored about you.</span>
                </div>
              </li>
              <li>
                <WifiOff aria-hidden="true" />
                <div>
                  <strong>Works offline</strong>
                  <span>After your first visit, culling needs no connection.</span>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className={`${styles.section} ${styles.alt}`} aria-labelledby="export-title">
          <div className={styles.sectionHead}>
            <h2 id="export-title" className={styles.h2}>
              Fits the way you already edit
            </h2>
          </div>
          <div className={styles.exports}>
            <div className={styles.export}>
              <Star aria-hidden="true" />
              <h3>Lightroom and Capture One</h3>
              <p>Star ratings and labels in .xmp sidecars. Existing sidecars are updated, never overwritten.</p>
            </div>
            <div className={styles.export}>
              <FolderInput aria-hidden="true" />
              <h3>A folder of keepers</h3>
              <p>Copies keepers with their RAW and JPEG files into any folder. Originals stay where they are.</p>
            </div>
            <div className={styles.export}>
              <FileArchive aria-hidden="true" />
              <h3>A ZIP to send</h3>
              <p>Keepers as they are, no recompression, streamed to disk so size does not matter.</p>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="faq-title">
          <div className={styles.faqWrap}>
            <h2 id="faq-title" className={styles.h2}>
              Questions
            </h2>
            <div className={styles.faq}>
              {FAQ.map(({ q, a }) => (
                <details key={q} className={styles.qa}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.final} aria-labelledby="final-title">
          <h2 id="final-title" className={styles.h2}>
            Cull tonight&apos;s shoot before dinner
          </h2>
          <Link href="/cull" className="btn btn-primary btn-lg">
            <FolderOpen /> Open a shoot
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          Built by Aadharsh Arunn. Face and image models by{' '}
          <a href="https://ai.google.dev/edge/mediapipe/solutions/guide" target="_blank" rel="noreferrer">
            Google MediaPipe
          </a>
          .
        </span>
        <a href={REPO} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  )
}
