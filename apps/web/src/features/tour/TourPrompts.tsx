import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BatonEmblem } from '../baton/BatonEmblem'
import { Button } from '../shell/ui/Button'
import { Icon } from '../shell/ui/Icon'

const EASE = [0.22, 1, 0.36, 1] as const

/** The first-run invitation over a calm world home. It never takes focus or blocks the world beneath it. */
export function TourOffer({ onAccept, onDecline }: { onAccept(): void; onDecline(): void }) {
  const reduced = useReducedMotion()
  const titleId = useId()
  return (
    <motion.section
      className="nr-tour-offer"
      aria-labelledby={titleId}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.38, ease: EASE }}
    >
      <div className="nr-tour-offer__head">
        <BatonEmblem size={46} className="nr-tour-offer__emblem" />
        <div className="nr-tour-offer__titles">
          <p className="nr-tour-offer__eyebrow">Welcome to NIM Relay</p>
          <h2 id={titleId} className="nr-tour-offer__title">
            Want a 60-second tour?
          </h2>
        </div>
      </div>
      <div className="nr-tour-offer__actions">
        <Button variant="primary" onClick={onAccept}>
          Show me around
        </Button>
        <Button variant="secondary" onClick={onDecline}>
          I’ll explore
        </Button>
      </div>
    </motion.section>
  )
}

/** After an urgent visit: a quiet line that can be ignored, dismissed, or taken up. */
export function TourNudge({ onAccept, onDismiss }: { onAccept(): void; onDismiss(): void }) {
  const reduced = useReducedMotion()
  return (
    <motion.aside
      className="nr-tour-nudge"
      aria-label="Product tour"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.32, ease: EASE }}
    >
      <button type="button" className="nr-tour-nudge__take" onClick={onAccept}>
        <BatonEmblem size={22} className="nr-tour-nudge__emblem" />
        <span>
          New here? <span className="nr-tour-nudge__action">Take the 60-second tour.</span>
        </span>
      </button>
      <button type="button" className="nr-icon-button nr-tour-nudge__close" aria-label="Dismiss the tour suggestion" onClick={onDismiss}>
        <Icon name="close" size={16} />
      </button>
    </motion.aside>
  )
}
