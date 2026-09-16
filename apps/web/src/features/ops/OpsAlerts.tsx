import type { OpsAlert } from '@nim-relay/shared'
import { SectionHeader } from '../shell/ui/primitives'

const CHECKS = 'verification rejections, Nimiq RPC availability, the Supabase archive, stuck handoffs, stranded batons and quiet days'

function SeverityGlyph({ severity }: { severity: OpsAlert['severity'] }) {
  return (
    <svg className="nr-ops-alert__glyph" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {severity === 'critical' ? <path d="M10 1.5 17.4 5.75v8.5L10 18.5l-7.4-4.25v-8.5L10 1.5Z" fill="currentColor" /> : <path d="M10 2.2 18.4 17H1.6L10 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />}
      <path d="M10 6.8v4.6" stroke={severity === 'critical' ? 'var(--nr-night-950)' : 'currentColor'} strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="10" cy="14.1" r="1.1" fill={severity === 'critical' ? 'var(--nr-night-950)' : 'currentColor'} />
    </svg>
  )
}

/**
 * Alerts come first and state the exact condition the Worker measured. Severity reads from the glyph's shape as well
 * as its color: a filled hexagon is critical, an outlined triangle is a warning.
 */
export function OpsAlerts({ alerts }: { alerts: readonly OpsAlert[] }) {
  const critical = alerts.filter(alert => alert.severity === 'critical').length
  const detail = alerts.length === 0 ? undefined : critical > 0 ? `${critical} critical, ${alerts.length - critical} to review` : `${alerts.length} to review`
  return (
    <section className="nr-ops-alerts" aria-labelledby="ops-alerts">
      <SectionHeader id="ops-alerts" title="Alerts" detail={detail} />
      {alerts.length === 0 ? (
        <p className="nr-ops-clear">
          <span className="nr-ops-clear__dot" aria-hidden="true" />
          No alert condition holds. Checked {CHECKS}.
        </p>
      ) : (
        <ul className="nr-ops-alert-list">
          {alerts.map(alert => (
            <li key={alert.id} className={`nr-ops-alert nr-ops-alert--${alert.severity}`}>
              <SeverityGlyph severity={alert.severity} />
              <h3>
                <span className="nr-visually-hidden">{alert.severity === 'critical' ? 'Critical: ' : 'Warning: '}</span>
                {alert.title}
              </h3>
              <p>{alert.condition}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
