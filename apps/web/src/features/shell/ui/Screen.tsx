import { useEffect, useId, useRef, type ReactNode } from 'react'
import { motion, useDragControls, useIsPresent, useReducedMotion } from 'motion/react'
import { goBack, useRestoredScroll } from '../router'
import { Icon } from './Icon'
import { shouldDismiss } from './overlays'

interface ScreenProps {
  title: string
  /** Short line above the title, e.g. a relay's identity. */
  kicker?: ReactNode
  /** History entry this screen belongs to; keeps scroll restoration per entry. */
  entryKey: string
  /** Where back goes when the screen was opened from a shared link. */
  parent?: string
  /** `tall` leaves more of the globe visible above the sheet. */
  peek?: 'standard' | 'tall'
  actions?: ReactNode
  children: ReactNode
}

/** A route rendered as a glass sheet over the living world. Drag the handle down or use back to leave. */
export function Screen({ title, kicker, entryKey, parent = '/', peek = 'standard', actions, children }: ScreenProps) {
  const titleId = useId()
  const scroll = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const controls = useDragControls()
  const reduced = useReducedMotion()
  // A sheet on its way out stays painted briefly but is no longer part of the page.
  const present = useIsPresent()
  useRestoredScroll(scroll, entryKey)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [entryKey])
  return (
    <motion.section
      className={`nr-screen nr-screen--${peek}`}
      aria-labelledby={titleId}
      aria-hidden={!present || undefined}
      inert={!present}
      initial={reduced ? { opacity: 0 } : { y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { y: 40, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', damping: 36, stiffness: 340, opacity: { duration: 0.18 } }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => shouldDismiss(info) && goBack(parent)}
    >
      <div className="nr-screen__chrome" onPointerDown={event => controls.start(event)}>
        <div className="nr-handle" aria-hidden="true" />
        <header className="nr-screen__header">
          <button type="button" className="nr-icon-button" aria-label="Back" onClick={() => goBack(parent)} onPointerDown={event => event.stopPropagation()}>
            <Icon name="back" size={20} />
          </button>
          <div className="nr-screen__titles">
            {kicker && <p className="nr-screen__kicker">{kicker}</p>}
            <h1 id={titleId} ref={heading} tabIndex={-1}>
              {title}
            </h1>
          </div>
          {actions && (
            <div className="nr-screen__actions" onPointerDown={event => event.stopPropagation()}>
              {actions}
            </div>
          )}
        </header>
      </div>
      <div className="nr-screen__scroll" ref={scroll}>
        {children}
      </div>
    </motion.section>
  )
}
