import { RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

interface State {
  failed: boolean
}

/**
 * Last line of defence: if a screen throws while rendering, show a calm
 * message and a way back instead of a blank page. Decisions are saved as
 * they are made, so reloading loses nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[keeper] screen crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className={styles.wrap} role="alert">
        <h1 className={styles.title}>Something went wrong on this screen</h1>
        <p className={styles.text}>
          Your decisions are saved as you make them, so reloading is safe. If it keeps happening, try Chrome or Edge, or open fewer photos at once.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          <RotateCcw /> Reload Keeper
        </button>
      </main>
    )
  }
}
