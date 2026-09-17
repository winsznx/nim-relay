import type { ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'

/**
 * The handoff's visual language: plates of light the handoff gate projects into the finish scene.
 * Gold is the baton and the actions that move it; cyan is the Nimiq network confirming; alert is a pass that stalled.
 */

export type HoloTone = 'gold' | 'live' | 'alert'

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]
/** Resting tilt of a plate, leaning back from the viewer like a projection rising off the platform. */
const TILT = 5
/**
 * Each plate carries its own perspective. A shared 3D context would put the tilted plates behind their flat
 * wrapper, and the wrapper would take every tap.
 */
const PERSPECTIVE = 1100

interface HoloCardProps {
  tone?: HoloTone
  /** Position in a stack of plates, for the staggered entrance. */
  order?: number
  className?: string
  labelledBy?: string
  label?: string
  /** Stage plates are live dialogs, so each beat of the ceremony is announced; browsing plates are regions. */
  role?: 'dialog' | 'region'
  children: ReactNode
}

export function HoloCard({ tone = 'gold', order = 0, className, labelledBy, label, role = 'dialog', children }: HoloCardProps) {
  const reduced = useReducedMotion()
  return (
    <motion.section
      className={['holo-card', `holo-card--${tone}`, className].filter(Boolean).join(' ')}
      role={role}
      {...(role === 'dialog' ? { 'aria-modal': false, 'aria-live': 'polite' } : {})}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
      {...(label ? { 'aria-label': label } : {})}
      style={{ transformPerspective: PERSPECTIVE }}
      initial={reduced ? { opacity: 0, rotateX: TILT } : { opacity: 0, y: 40, rotateX: 28, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, rotateX: TILT, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, rotateX: 16, transition: { duration: 0.2, ease: 'easeIn' } }}
      transition={{ duration: reduced ? 0.2 : 0.6, delay: reduced ? 0 : order * 0.08, ease: EASE }}
    >
      <span className="holo-card__ticks" aria-hidden="true" />
      {children}
    </motion.section>
  )
}

const listVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.055, delayChildren: 0.18 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14, rotateX: -18, transformPerspective: 700 },
  shown: { opacity: 1, y: 0, rotateX: 0, transformPerspective: 700, transition: { duration: 0.42, ease: EASE } },
}

const reducedItemVariants: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.2 } },
}

/** A list whose items light up one after another once its plate has landed. */
export function HoloList({ className, children }: { className: string; children: ReactNode }) {
  return (
    <motion.ul className={className} variants={listVariants} initial="hidden" animate="shown">
      {children}
    </motion.ul>
  )
}

export function HoloItem({ className, children }: { className?: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.li className={className} variants={reduced ? reducedItemVariants : itemVariants}>
      {children}
    </motion.li>
  )
}
