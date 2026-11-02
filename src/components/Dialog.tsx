import { X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './Dialog.module.css'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg' | 'full'
  /** Extra content in the header, right of the title. */
  headerExtra?: ReactNode
  /** Keyboard shortcuts that should work wherever focus is inside the dialog. */
  onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void
}

/**
 * Modal built on the native <dialog> element: focus is trapped, Escape closes
 * it and the rest of the page becomes inert, all handled by the browser.
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md', headerExtra, onKeyDown }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles[size]}`}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby="dialog-title"
    >
      {open && (
        <div className={styles.inner}>
          <header className={styles.header}>
            <h2 id="dialog-title" className={styles.title}>
              {title}
            </h2>
            {headerExtra}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  )
}
