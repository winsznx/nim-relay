import { useId, type CSSProperties, type Ref } from 'react'
import { Button } from '../shell/ui/Button'
import type { TourStepView } from './controller'

interface CoachMarkProps {
  view: TourStepView
  cardRef: Ref<HTMLDivElement>
  arrowRef: Ref<HTMLSpanElement>
  onBack(): void
  onNext(): void
  onSkip(): void
  onSecondary(): void
}

/**
 * One step's explanation, beside what it points at. A non-modal dialog: focus lands on its main button, and the
 * runner can still leave it with Tab, Escape or Skip tour.
 */
export function CoachMark({ view, cardRef, arrowRef, onBack, onNext, onSkip, onSecondary }: CoachMarkProps) {
  const titleId = useId()
  const bodyId = useId()
  const secondary = view.step.secondaryAction
  return (
    <div ref={cardRef} className="nr-coach" role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={bodyId} data-interaction={view.interaction}>
      <span className="nr-coach__progress" style={{ '--nr-coach-progress': view.number / view.total } as CSSProperties} aria-hidden="true" />
      <span ref={arrowRef} className="nr-coach__arrow" aria-hidden="true" />
      <div className="nr-coach__head">
        <p className="nr-coach__category">{view.copy.category}</p>
        <button type="button" className="nr-coach__skip" onClick={onSkip}>
          Skip tour
        </button>
      </div>
      <h2 id={titleId} className="nr-coach__title">
        {view.copy.title}
      </h2>
      <p id={bodyId} className="nr-coach__body">
        {view.copy.body}
      </p>
      <div className="nr-coach__foot">
        <p className="nr-coach__count nr-num">
          <span aria-hidden="true">
            {view.number} / {view.total}
          </span>
          <span className="nr-visually-hidden">
            Step {view.number} of {view.total}
          </span>
        </p>
        {secondary && (
          <Button variant="quiet" size="sm" onClick={onSecondary}>
            {secondary.label}
          </Button>
        )}
        {view.canGoBack && (
          <Button variant="secondary" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        <Button variant="primary" size="sm" className="nr-coach__next" onClick={onNext} data-tour-primary="">
          {view.last ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>
  )
}
