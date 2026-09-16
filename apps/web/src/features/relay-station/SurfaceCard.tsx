import type { StationCard } from './view-model'

interface SurfaceCardProps {
  card: StationCard
  previousTitle: string
  nextTitle: string
  onAction(route: string): void
  onPrevious(): void
  onNext(): void
  onClose(): void
}

/** What a focused surface says, in words, with the one thing to do next. */
export function SurfaceCard({ card, previousTitle, nextTitle, onAction, onPrevious, onNext, onClose }: SurfaceCardProps) {
  return (
    <section className="relay-station-card" aria-labelledby="relay-station-card-title">
      <header className="relay-station-card-head">
        <h2 id="relay-station-card-title" className="relay-station-card-title">
          {card.title}
        </h2>
        <div className="relay-station-card-controls">
          <button type="button" className="relay-station-icon-button" aria-label={`Previous: ${previousTitle}`} onClick={onPrevious}>
            <Chevron direction="left" />
          </button>
          <button type="button" className="relay-station-icon-button" aria-label={`Next: ${nextTitle}`} onClick={onNext}>
            <Chevron direction="right" />
          </button>
          <button type="button" className="relay-station-icon-button" aria-label="Back to the station" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
          </button>
        </div>
      </header>
      <ul className="relay-station-facts">
        {card.facts.map(fact => (
          <li key={fact.text} className="relay-station-fact" data-tone={fact.tone}>
            {fact.text}
          </li>
        ))}
      </ul>
      <button type="button" className="relay-station-action" onClick={() => onAction(card.action.route)}>
        {card.action.label}
      </button>
    </section>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d={direction === 'left' ? 'M12 4.5L6.5 10l5.5 5.5' : 'M8 4.5l5.5 5.5L8 15.5'} />
    </svg>
  )
}
