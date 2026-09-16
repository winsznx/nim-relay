import { useState } from 'react'
import type { BatonDetail } from '@nim-relay/shared'
import { linkProps, pathFor } from '../shell/router'
import { LegShare } from '../social/cards/LegShare'
import { SectionHeader } from '../shell/ui/primitives'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { countryName, formatCount, formatDateTime } from './format'
import { echoText, type RelayView } from './model'
import { practicePath, watchPath } from './paths'

const VISIBLE_STOPS = 10

/** Every stop in order: who started the baton, then each verified handoff with its replay, proof and, for its runners, share cards. */
export function JourneyRoute({ relay, detail, playerId }: { relay: RelayView; detail: BatonDetail; playerId: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const handoffs = detail.handoffs
  const hidden = expanded ? 0 : Math.max(0, handoffs.length - VISIBLE_STOPS)
  return (
    <section className="nr-section" aria-labelledby="journey-route">
      <SectionHeader id="journey-route" title="The route" detail={`${formatCount(handoffs.length + 1)} stops, oldest first`} />
      <ol className="nr-route">
        <li className="nr-route__stop">
          <RunnerAvatar name={relay.origin.name} wallet={relay.origin.wallet} country={relay.origin.country} size={36} />
          <div className="nr-route__body">
            <p className="nr-route__title">{relay.origin.name} started the relay</p>
            <p className="nr-route__meta">
              {countryName(relay.origin.country)}
              <span className="nr-route__time">{formatDateTime(relay.createdAt)}</span>
            </p>
          </div>
        </li>
        {hidden > 0 && (
          <li className="nr-route__more">
            <button type="button" className="nr-button nr-button--quiet" onClick={() => setExpanded(true)}>
              Show {formatCount(hidden)} earlier {hidden === 1 ? 'handoff' : 'handoffs'}
            </button>
          </li>
        )}
        {handoffs.slice(hidden).map(handoff => (
          <li key={handoff.id} className="nr-route__stop" id={`leg-${handoff.leg}`}>
            <RunnerAvatar name={handoff.to.name} wallet={handoff.to.wallet} country={handoff.to.country} holder={handoff.leg === relay.handoffCount && relay.status !== 'completed'} size={36} />
            <div className="nr-route__body">
              <p className="nr-route__leg">Leg {handoff.leg}</p>
              <p className="nr-route__title">
                {handoff.from.name} passed to {handoff.to.name}
              </p>
              <p className="nr-route__meta">
                {countryName(handoff.from.country)} → {countryName(handoff.to.country)}
                <span className="nr-route__time">{formatDateTime(handoff.at)}</span>
              </p>
              <p className="nr-route__links">
                <a {...linkProps(watchPath(handoff.runId, relay.code))}>Watch verified ride</a>
                <a {...linkProps(`${pathFor('proofRelay', { code: relay.code })}#tx-${handoff.txHash}`)}>Transaction proof</a>
              </p>
              <LegShare relay={relay} handoffs={handoffs} handoff={handoff} playerId={playerId} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Ghost records and echoes the relay's runners left behind. */
export function JourneyRecords({ relay, detail }: { relay: RelayView; detail: BatonDetail }) {
  const records = [...detail.notableRuns].sort((a, b) => b.score - a.score).slice(0, 3)
  const echoes = detail.echoes
  if (records.length === 0 && echoes.length === 0) return null
  return (
    <section className="nr-section" aria-labelledby="journey-records">
      <SectionHeader id="journey-records" title="Ghost records and moments" detail="Every score here was replayed and verified by the server." />
      <ul className="nr-list">
        {records.map((run, index) => (
          <li key={run.runId} className="nr-row">
            <span className="nr-rank nr-num" aria-hidden="true">
              {index + 1}
            </span>
            <span className="nr-row__body">
              <span className="nr-row__title">{run.name}</span>
              <span className="nr-row__meta nr-num">{formatCount(run.score)} points</span>
            </span>
            <a className="nr-button nr-button--sm nr-button--secondary" {...linkProps(practicePath(run.runId, relay.code))}>
              Race ghost
            </a>
          </li>
        ))}
        {echoes.map(echo => (
          <li key={echo.id} className="nr-row">
            <span className="nr-echo-mark" aria-hidden="true" />
            <span className="nr-row__body">
              <span className="nr-row__title">{echoText(echo)}</span>
              <span className="nr-row__meta">{formatDateTime(echo.at)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
