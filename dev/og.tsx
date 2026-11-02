// Renders the 1200x630 social card; scripts/og.mjs screenshots it into public/og.png.
import '@fontsource-variable/inter'
import '../src/styles/tokens.css'
import '../src/styles/base.css'
import { createRoot } from 'react-dom/client'
import { LogoMark } from '../src/components/Logo'
import { MomentIllustration } from '../src/pages/landing/MomentIllustration'

function Card() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: 'grid',
        gridTemplateColumns: '1fr 1.1fr',
        alignItems: 'center',
        gap: 48,
        padding: '0 64px',
        background: 'var(--bg)',
      }}
    >
      <div style={{ display: 'grid', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 28, fontWeight: 700 }}>
          <LogoMark size={44} /> Keeper
        </div>
        <h1 style={{ fontSize: 64, lineHeight: 1.02, letterSpacing: '-0.035em', fontWeight: 720 }}>Find your keepers. Skip the grind.</h1>
        <p style={{ fontSize: 24, color: 'var(--text-2)', lineHeight: 1.45 }}>Photo culling that runs in your browser. Your photos never leave your computer.</p>
      </div>
      <div style={{ zoom: 1.08 }}>
        <MomentIllustration />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Card />)
