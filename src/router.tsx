import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

/** A two-route app does not need a router library: this listens to the History API. */
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('popstate', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('popstate', cb)
  }
}

export function usePath(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '/',
  )
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search) return
  if (opts.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.scrollTo(0, 0)
  listeners.forEach((l) => l())
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (!href.startsWith('/')) return
    e.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={handle} {...rest} />
}
