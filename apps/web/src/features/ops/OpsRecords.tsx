import type { OpsFlaggedRun, OpsReport, RaceMode } from '@nim-relay/shared'
import { formatCount, formatLuna, formatNim, networkLabel } from '../relays/format'
import { linkProps, pathFor } from '../shell/router'
import { Pill, SectionHeader } from '../shell/ui/primitives'
import { DEFINITIONS, FLAG_LABELS } from './copy'
import { utcDateTime } from './dates'

const MODE_LABELS: Record<RaceMode, string> = {
  global: 'Global leg',
  quick: 'Quick leg',
  crew: 'Crew leg',
  rival: 'Rival leg',
  daily: 'Daily',
}

function runDetail(run: OpsFlaggedRun): string {
  const race = run.practice ? `${MODE_LABELS[run.mode]} practice` : MODE_LABELS[run.mode]
  const submissions = run.attempts > 1 ? `, submitted ${formatCount(run.attempts)} times` : ''
  return `${race}, ${utcDateTime(run.at)}${submissions}`
}

/** The latest rejected submissions, by runner handle. Nothing here links to a wallet. */
export function OpsFlaggedRuns({ report }: { report: OpsReport }) {
  const runs = report.flaggedRuns
  return (
    <section className="nr-section" aria-labelledby="ops-flagged">
      <SectionHeader id="ops-flagged" title="Flagged runs" detail={runs.length > 0 ? `Latest ${formatCount(runs.length)}, newest first` : undefined} />
      <p className="nr-ops-definition">{DEFINITIONS.flaggedRuns}</p>
      {runs.length === 0 ? (
        <p className="nr-note">No run has been flagged since counting started {utcDateTime(report.countingSince.runs)}.</p>
      ) : (
        <ul className="nr-list">
          {runs.map((run, index) => (
            <li key={`${index}-${run.at}-${run.reason}`} className="nr-row nr-ops-flag">
              <span className="nr-row__body">
                <a className="nr-row__title" {...linkProps(pathFor('runner', { handle: run.handle }))}>
                  @{run.handle}
                </a>
                <span className="nr-row__meta nr-num">{runDetail(run)}</span>
              </span>
              <Pill tone="danger">{FLAG_LABELS[run.reason]}</Pill>
            </li>
          ))}
        </ul>
      )}
      <p className="nr-note">The app sends its input trace but not its own result, so a replay can’t be compared with a claimed result and divergent results aren’t flagged.</p>
    </section>
  )
}

/** Value moved by qualified handoffs, per Nimiq network. */
export function OpsNimFlow({ report }: { report: OpsReport }) {
  return (
    <section className="nr-section" aria-labelledby="ops-nim">
      <SectionHeader id="ops-nim" title="NIM moved" />
      {report.nimFlow.length === 0 ? (
        <p className="nr-note">No qualified handoff has moved NIM on {networkLabel(report.network)} yet.</p>
      ) : (
        <dl className="nr-ops-nim">
          {report.nimFlow.map(flow => (
            <div key={flow.network} className="nr-ops-nim__network">
              <dt>{networkLabel(flow.network)}</dt>
              <dd className="nr-ops-nim__value nr-num">{formatNim(flow.luna)}</dd>
              <dd className="nr-ops-nim__detail nr-num">
                {formatLuna(flow.luna)} across {formatCount(flow.handoffs)} qualified {flow.handoffs === 1 ? 'handoff' : 'handoffs'}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="nr-ops-definition">{DEFINITIONS.nimFlow}</p>
    </section>
  )
}
