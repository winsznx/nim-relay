import { useId } from 'react'
import type { OpsReport, OpsTour, OpsTourStep } from '@nim-relay/shared'
import { formatCount } from '../relays/format'
import { SectionHeader } from '../shell/ui/primitives'
import { DEFINITIONS, TOUR_LABELS } from './copy'
import { utcDateTime } from './dates'
import { percentOf, shareStyle } from './share'

function tourLabel(tour: OpsTour): string {
  return `${TOUR_LABELS[tour.tourId] ?? tour.tourId}, ${tour.version}`
}

function outcomes(tour: OpsTour): string {
  const parts = [`${percentOf(tour.started, tour.offered)} of offers started`, `${percentOf(tour.completed, tour.started)} of starts completed`]
  if (tour.declined > 0) parts.push(`${formatCount(tour.declined)} declined the offer`)
  if (tour.replayed > 0) parts.push(`${formatCount(tour.replayed)} ${tour.replayed === 1 ? 'replay' : 'replays'}`)
  return `${parts.join(', ')}.`
}

function StepRow({ step, started }: { step: OpsTourStep; started: number }) {
  return (
    <li className="nr-ops-stage" style={shareStyle(step.viewed, started)}>
      <p className="nr-ops-stage__head">
        <span>
          {step.stepNumber}. <code className="nr-ops-code">{step.stepId}</code>
        </span>
        <span className="nr-num">
          {formatCount(step.viewed)}
          <span className="nr-ops-stage__share">{percentOf(step.viewed, started)}</span>
        </span>
      </p>
      <span className="nr-ops-track" aria-hidden="true">
        <span className="nr-ops-track__fill" />
      </span>
      <p className="nr-ops-step nr-num">
        {formatCount(step.completed)} went on
        {step.skippedHere > 0 && <span className="nr-ops-step__left">, {formatCount(step.skippedHere)} left here</span>}
        {step.missing > 0 && (
          <span className="nr-ops-step__missing">
            , {formatCount(step.missing)} with nothing to point at
          </span>
        )}
      </p>
    </li>
  )
}

function TourFunnel({ tour }: { tour: OpsTour }) {
  const titleId = useId()
  const figures = [
    { label: 'Offered', value: tour.offered },
    { label: 'Started', value: tour.started },
    { label: 'Completed', value: tour.completed },
    { label: 'Skipped', value: tour.skipped + tour.declined },
  ]
  return (
    <div className="nr-ops-tour" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="nr-ops-group__title">
        {tourLabel(tour)}
      </h3>
      <dl className="nr-ops-outcomes nr-ops-outcomes--four">
        {figures.map(figure => (
          <div key={figure.label}>
            <dt>{figure.label}</dt>
            <dd className="nr-num">{formatCount(figure.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="nr-ops-definition nr-num">{outcomes(tour)}</p>
      {tour.steps.length > 0 && (
        <ol className="nr-ops-funnel nr-ops-tour__steps" aria-label={`${tourLabel(tour)} steps`}>
          {tour.steps.map(step => (
            <StepRow key={step.stepId} step={step} started={tour.started} />
          ))}
        </ol>
      )}
      {tour.entries.length > 0 && (
        <p className="nr-ops-definition nr-num">Started from {tour.entries.map(entry => `${entry.section} (${formatCount(entry.started)})`).join(', ')}.</p>
      )}
    </div>
  )
}

/** How first-time runners take the guided tours: offers, starts, completions and where on the way they leave. */
export function OpsOnboarding({ report }: { report: OpsReport }) {
  const { onboarding, windowDays } = report
  return (
    <section className="nr-section" aria-labelledby="ops-onboarding">
      <SectionHeader id="ops-onboarding" title="Onboarding" detail={`Guided tours in the last ${windowDays} UTC days.`} />
      <p className="nr-ops-definition">
        {DEFINITIONS.onboarding} Counted since {utcDateTime(onboarding.countingSince)}.
      </p>
      {onboarding.tours.length === 0 ? (
        <p className="nr-note">No tour has been offered or started yet.</p>
      ) : (
        <div className="nr-ops-tours">
          {onboarding.tours.map(tour => (
            <TourFunnel key={`${tour.tourId}:${tour.version}`} tour={tour} />
          ))}
        </div>
      )}
    </section>
  )
}
