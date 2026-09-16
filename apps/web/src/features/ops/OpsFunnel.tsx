import type { CSSProperties } from 'react'
import type { HandoffRejectionReason, OpsFunnel as Funnel, OpsReport } from '@nim-relay/shared'
import { formatCount } from '../relays/format'
import { SectionHeader } from '../shell/ui/primitives'
import { DEFINITIONS, REJECTION_LABELS } from './copy'
import { utcDateTime } from './dates'

const STAGES = [
  { key: 'prepared', label: 'Prepared', definition: DEFINITIONS.prepared },
  { key: 'attempted', label: 'Sent to Nimiq Pay', definition: DEFINITIONS.attempted },
  { key: 'submitted', label: 'Transaction hash received', definition: DEFINITIONS.submitted },
  { key: 'verified', label: 'Verified', definition: DEFINITIONS.verified },
] as const satisfies readonly { key: keyof Funnel; label: string; definition: string }[]

function isRejectionReason(value: string): value is HandoffRejectionReason {
  return Object.hasOwn(REJECTION_LABELS, value)
}

function percentOf(count: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((count / whole) * 100)}%`
}

/** Seconds stay visible: a pass usually verifies within a few minutes. */
function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function shareStyle(part: number, whole: number): CSSProperties {
  return { '--nr-ops-share': whole > 0 ? part / whole : 0 } as CSSProperties
}

/** Where handoffs drop out between preparation and verification, and why submitted transactions were rejected. */
export function OpsFunnel({ report }: { report: OpsReport }) {
  const { funnel, windowDays, countingSince, days } = report
  const rejections = Object.keys(funnel.rejections)
    .filter(isRejectionReason)
    .map(reason => ({ reason, count: funnel.rejections[reason] }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count)
  const mostRejected = rejections[0]?.count ?? 0
  const firstDate = days[0]?.date
  const countedLate = firstDate !== undefined && new Date(countingSince.runs).toISOString().slice(0, 10) > firstDate
  return (
    <section className="nr-section" aria-labelledby="ops-funnel">
      <SectionHeader id="ops-funnel" title="Handoff funnel" detail={`Passes prepared in the last ${windowDays} UTC days.`} />
      <ol className="nr-ops-funnel">
        {STAGES.map(stage => {
          const count = funnel[stage.key]
          return (
            <li key={stage.key} className={`nr-ops-stage${stage.key === 'verified' ? ' nr-ops-stage--verified' : ''}`} style={shareStyle(count, funnel.prepared)}>
              <p className="nr-ops-stage__head">
                <span>{stage.label}</span>
                <span className="nr-num">
                  {formatCount(count)}
                  {stage.key !== 'prepared' && <span className="nr-ops-stage__share">{percentOf(count, funnel.prepared)}</span>}
                </span>
              </p>
              <span className="nr-ops-track" aria-hidden="true">
                <span className="nr-ops-track__fill" />
              </span>
              <p className="nr-ops-definition">{stage.definition}</p>
            </li>
          )
        })}
      </ol>

      <dl className="nr-ops-outcomes">
        <div>
          <dt>Cancelled</dt>
          <dd className="nr-num">{formatCount(funnel.cancelled)}</dd>
        </div>
        <div>
          <dt>Expired</dt>
          <dd className="nr-num">{formatCount(funnel.expired)}</dd>
        </div>
        <div>
          <dt>Still open</dt>
          <dd className="nr-num">{formatCount(funnel.open)}</dd>
        </div>
      </dl>
      <p className="nr-ops-definition">{DEFINITIONS.outcomes}</p>

      <dl className="nr-ops-median">
        <dt>Median wait for verification</dt>
        <dd className="nr-num">{funnel.medianAttemptToVerifiedMs === null ? 'No verified pass yet' : formatWait(funnel.medianAttemptToVerifiedMs)}</dd>
        <dd className="nr-ops-definition">{DEFINITIONS.medianAttemptToVerified}</dd>
      </dl>

      <div className="nr-ops-rejections">
        <h3>Rejections by reason</h3>
        <p className="nr-ops-definition">
          {DEFINITIONS.rejections}
          {countedLate && ` Counted since ${utcDateTime(countingSince.runs)}.`}
        </p>
        {rejections.length === 0 ? (
          <p className="nr-note">No submitted transaction was rejected on these days.</p>
        ) : (
          <ul className="nr-ops-reasons">
            {rejections.map(row => (
              <li key={row.reason} className="nr-ops-reason" style={shareStyle(row.count, mostRejected)}>
                <p className="nr-ops-reason__head">
                  <span>
                    {REJECTION_LABELS[row.reason]} <code className="nr-ops-code">{row.reason}</code>
                  </span>
                  <span className="nr-num">{formatCount(row.count)}</span>
                </p>
                <span className="nr-ops-track nr-ops-track--danger" aria-hidden="true">
                  <span className="nr-ops-track__fill" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
