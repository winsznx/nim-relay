import { useEffect, useId, useRef } from 'react'
import { BatonEmblem } from '../baton/BatonEmblem'
import { Button } from '../shell/ui/Button'
import type { TourCompletion } from './types'

/** The last card of a tour, with the spotlight gone: go explore, or go straight to the next thing. */
export function TourFinale({ completion, onPrimary, onSecondary }: { completion: TourCompletion; onPrimary(): void; onSecondary(to: string): void }) {
  const titleId = useId()
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus({ preventScroll: true })
  }, [])
  const { secondary } = completion
  return (
    <div className="nr-tour__finale">
      <div ref={card} className="nr-finale" role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <BatonEmblem size={60} className="nr-finale__emblem" />
        <p className="nr-finale__category">{completion.category}</p>
        <h2 id={titleId} className="nr-finale__title">
          {completion.title}
        </h2>
        <div className="nr-finale__actions">
          <Button variant="primary" size="lg" block onClick={onPrimary} data-tour-primary="">
            {completion.primaryLabel}
          </Button>
          {secondary && (
            <Button variant="secondary" size="lg" block onClick={() => onSecondary(secondary.to)}>
              {secondary.label}
            </Button>
          )}
        </div>
        {completion.note && <p className="nr-finale__note">{completion.note}</p>}
      </div>
    </div>
  )
}
