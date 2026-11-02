import { lazy, Suspense, useEffect } from 'react'
import { pruneCache } from './lib/store/db'
import { applyTheme, getPrefs } from './lib/store/prefs'
import { usePath } from './router'
import Landing from './pages/landing/Landing'

// The culling app (workers, models, virtual lists) loads only when it is opened.
const CullPage = lazy(() => import('./pages/cull/CullPage'))

function PageSkeleton() {
  return <div className="skeleton" style={{ height: '3.75rem' }} aria-hidden="true" />
}

export function App() {
  const path = usePath()
  useEffect(() => {
    applyTheme(getPrefs().theme)
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2000))
    idle(() => void pruneCache())
  }, [])

  if (path.startsWith('/cull')) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <CullPage />
      </Suspense>
    )
  }
  return <Landing />
}
