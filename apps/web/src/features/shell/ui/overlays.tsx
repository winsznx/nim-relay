import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'motion/react'
import { useToasts } from '../toast'
import { Icon } from './Icon'

const TOAST_MS = 5200

export function ToastViewport() {
  const current = useToasts(state => state.current)
  const dismiss = useToasts(state => state.dismiss)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(() => dismiss(current.id), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [current, dismiss])
  return (
    <div aria-live="polite" role="status">
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.id}
            className={`nr-toast nr-toast--${current.tone}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <span className="nr-toast__dot" aria-hidden="true" />
            <p>{current.text}</p>
            <button type="button" className="nr-icon-button" aria-label="Dismiss" onClick={() => dismiss(current.id)}>
              <Icon name="close" size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Downward drag distance or speed that dismisses a sheet. */
export function shouldDismiss(info: PanInfo): boolean {
  return info.offset.y > 110 || info.velocity.y > 700
}

interface BottomSheetProps {
  open: boolean
  title: string
  onClose(): void
  children: ReactNode
}

/** Modal sheet from the bottom edge with a drag handle. Escape, the scrim and a downward drag close it. */
export function BottomSheet({ open, title, onClose, children }: BottomSheetProps) {
  const titleId = useId()
  const controls = useDragControls()
  const reduced = useReducedMotion()
  const sheet = useRef<HTMLDivElement>(null)
  const closeOnEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
  })
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheet.current?.focus()
    const escape = (event: KeyboardEvent) => closeOnEscape(event)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', escape)
      previous?.focus()
    }
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="nr-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            key="sheet"
            ref={sheet}
            className="nr-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 380 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => shouldDismiss(info) && onClose()}
          >
            <div className="nr-handle" onPointerDown={event => controls.start(event)} aria-hidden="true" />
            <h2 id={titleId}>{title}</h2>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
