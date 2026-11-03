// Renders the 1200x630 social card. Open /dev/og.html in the dev server and screenshot it at 1200x630 into public/og.png.
import '@fontsource-variable/geist'
import '../src/styles/tokens.css'
import '../src/styles/base.css'
import { createRoot } from 'react-dom/client'
import { LogoMark } from '../src/components/Logo'

function Card() {
  return (
    <div style={{ position: 'relative', width: 1200, height: 630, overflow: 'hidden', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ position: 'absolute', left: 56, top: 52, display: 'flex', alignItems: 'center', gap: 14, fontSize: 24 }}>
        <LogoMark size={30} /> Keeper
      </div>
      <div style={{ position: 'absolute', left: 56, bottom: 56, width: 500, display: 'grid', gap: 20 }}>
        <h1 style={{ fontSize: 58, fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.04em' }}>Find your keepers. Skip the grind.</h1>
        <p style={{ fontSize: 22, lineHeight: 1.45, color: 'var(--text-3)' }}>Photo culling in your browser. Your photos never leave your computer.</p>
      </div>
      <img
        src="/media/moments-dark.webp"
        alt=""
        style={{ position: 'absolute', left: 600, top: 60, width: 920, border: '1px solid var(--border-strong)', borderRadius: 6 }}
      />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Card />)
