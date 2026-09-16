import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useDeparture } from './departure'
import './leg.css'

const BANNER_MS = 6500

/** "HANDOFF #48 COMPLETE / MARIANA HAS THE BATON", over the globe while the baton crosses it. */
export function DepartureBanner() {
  const current = useDeparture(state => state.current)
  const clear = useDeparture(state => state.clear)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(() => clear(current.key), BANNER_MS)
    return () => window.clearTimeout(timer)
  }, [current, clear])

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.key}
          className="nr-departure"
          role="status"
          aria-live="polite"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={() => clear(current.key)}
        >
          <p className="nr-departure__kicker">{current.batonName}</p>
          <p className="nr-departure__title">Handoff #{current.leg} complete</p>
          <p className="nr-departure__holder">
            <span>{current.recipientName}</span> has the baton
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
