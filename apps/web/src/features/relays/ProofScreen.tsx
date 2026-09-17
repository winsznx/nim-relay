import { useEffect } from 'react'
import type { AtlasStarterGrant, BatonDetail, NetworkMetrics, NetworkSnapshot, RelayNetwork } from '@nim-relay/shared'
import { playerMessage } from '../shell/errors'
import { linkProps, pathFor, useLocation } from '../shell/router'
import { copyText } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Icon } from '../shell/ui/Icon'
import { EmptyState, Loading, Pill, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import * as api from './api'
import { useNetwork, useNow, useRelay } from './data'
import { explorerUrl, formatCount, formatDateTime, formatDuration, formatLuna, formatNim, networkLabel } from './format'
import { watchPath } from './paths'
import { toRelayView } from './model'
import './relays.css'

/** What each public metric counts, stated so a reviewer can check it against the record. */
const METRIC_DEFINITIONS: readonly (readonly [keyof NetworkMetrics, string, string])[] = [
  ['qualifiedHandoffs', 'Qualified handoffs', 'Transfers verified independently on chain and backed by a completed race the server replayed.'],
  ['transactingWallets', 'Transacting wallets', 'Distinct wallets that sent or received a qualified handoff.'],
  ['linkedWallets', 'Linked wallets', 'Wallets that signed in and joined the relay network. A wallet is not proof of a unique person.'],
  ['mainnetHandoffs', 'Mainnet handoffs', 'Qualified handoffs on Nimiq mainnet.'],
  ['testnetHandoffs', 'Testnet handoffs', 'Qualified handoffs on Nimiq testnet. Test evidence, never counted as mainnet usage.'],
  ['invites', 'Invites created', 'Invite links created by current holders.'],
  ['inviteOpens', 'Invites opened', 'Invite links opened by someone.'],
  ['inviteConversions', 'Invites accepted', 'Invites a runner accepted to reserve the next leg.'],
  ['returningWallets', 'Returning wallets', 'Wallets active on more than one UTC day.'],
  ['quickMatches', 'Quick matches', 'Best-of matches started between two runners.'],
  ['rematches', 'Rematches', 'Quick matches started again after finishing.'],
  ['crewActiveDays', 'Crew active days', 'Days on which a crew completed at least one qualified handoff.'],
  ['dailyAttempts', 'Official Daily attempts', 'One official ride per wallet per day, replayed by the server.'],
  ['chronicleViews', 'Chronicle views', 'Times a relay Chronicle was opened.'],
  ['shares', 'Shares', 'Journeys, Chronicles and results shared from the app.'],
  ['sessionSeconds', 'Foreground time', 'Seconds of bounded, server-observed heartbeats from signed-in runners.'],
]

function metricValue(metrics: NetworkMetrics, key: keyof NetworkMetrics): number | null {
  const value: unknown = metrics[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function NetworkProof({ snapshot }: { snapshot: NetworkSnapshot }) {
  const metrics = snapshot.metrics
  const testnet = snapshot.network === 'TestAlbatross'
  return (
    <>
      <div className="nr-proof-network">
        <Pill tone={testnet ? 'neutral' : 'verified'}>{networkLabel(snapshot.network)}</Pill>
        <p className="nr-lede">{testnet ? 'Everything on this page is test evidence from Nimiq testnet. None of it counts as mainnet usage.' : 'Activity on Nimiq mainnet. Test activity is reported separately and never mixed in.'}</p>
      </div>

      <section className="nr-section" aria-labelledby="proof-metrics">
        <SectionHeader id="proof-metrics" title="Metrics" detail="Counted by the relay server from its verified record." />
        <dl className="nr-metrics">
          {METRIC_DEFINITIONS.map(([key, label, definition]) => {
            const value = metricValue(metrics, key)
            if (value === null) return null
            return (
              <div key={key} className="nr-metrics__item">
                <dt>{label}</dt>
                <dd className="nr-metrics__value nr-num">{key === 'sessionSeconds' ? formatDuration(value * 1000) : formatCount(value)}</dd>
                <dd className="nr-metrics__definition">{definition}</dd>
              </div>
            )
          })}
        </dl>
      </section>

      <section className="nr-section nr-panel" aria-labelledby="proof-controlled">
        <h3 id="proof-controlled">Controlled and test evidence</h3>
        <p>
          {formatCount(metrics.controlledEvidence.handoffs)} handoffs between {formatCount(metrics.controlledEvidence.wallets)} wallets were made on the test network. They prove the mechanics work and are excluded from usage above.
        </p>
      </section>

      <section className="nr-section" aria-labelledby="proof-rules">
        <SectionHeader id="proof-rules" title="Measurement rules" />
        <ul className="nr-rules">
          {metrics.definitions.map(rule => (
            <li key={rule}>{rule}</li>
          ))}
          <li>NIM is fungible. A baton is an ordered lineage of verified transfers of the same value, not a uniquely identifiable coin.</li>
        </ul>
      </section>

      <section className="nr-section" aria-labelledby="proof-relays">
        <SectionHeader id="proof-relays" title="Relay records" detail={snapshot.batons.length ? 'Open a relay to inspect each transaction.' : undefined} />
        {snapshot.batons.length === 0 ? (
          <p className="nr-note">No relay has started on this network, so there are no transactions to inspect yet.</p>
        ) : (
          <ul className="nr-list">
            {snapshot.batons.map(baton => (
              <li key={baton.id}>
                <a className="nr-row" {...linkProps(pathFor('proofRelay', { code: baton.code }))}>
                  <span className="nr-row__body">
                    <span className="nr-row__title">{toRelayView(baton, { runners: [], rivals: [], now: baton.updatedAt }).identity}</span>
                    <span className="nr-row__meta nr-hash">{baton.code}</span>
                  </span>
                  <span className="nr-row__aside nr-num">{formatCount(baton.handoffCount)} handoffs</span>
                  <Icon name="chevron" size={18} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function Copyable({ value, label }: { value: string; label: string }) {
  const action = useAction()
  return (
    <span className="nr-copyable">
      <code className="nr-hash">{value}</code>
      <button type="button" className="nr-icon-button nr-icon-button--small" aria-label={`Copy ${label}`} onClick={() => action.run(() => copyText(value, `${label} copied.`))}>
        <Icon name="copy" size={16} />
      </button>
    </span>
  )
}

function RelayProof({ detail }: { detail: BatonDetail }) {
  const now = useNow()
  const relay = toRelayView(detail.baton, { runners: [], rivals: [], detail, now })
  const scores = new Map(detail.notableRuns.map(run => [run.runId, run.score]))
  const location = useLocation()
  const target = location.hash.startsWith('#tx-') ? location.hash.slice(1) : null
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' })
  }, [target])
  return (
    <>
      <dl className="nr-facts">
        <div>
          <dt>Network</dt>
          <dd>{networkLabel(relay.network)}</dd>
        </div>
        <div>
          <dt>Relay code</dt>
          <dd className="nr-hash">{relay.code}</dd>
        </div>
        <div>
          <dt>Baton value</dt>
          <dd className="nr-num">
            {formatNim(relay.valueLuna)} ({formatLuna(relay.valueLuna)})
          </dd>
        </div>
        <div>
          <dt>Current holder</dt>
          <dd>
            {relay.holder.name}
            <Copyable value={relay.holder.wallet} label="Holder address" />
          </dd>
        </div>
      </dl>
      {relay.network === 'TestAlbatross' && <p className="nr-note">Test evidence on Nimiq testnet. Not counted as mainnet usage.</p>}

      <section className="nr-section" aria-labelledby="proof-lineage">
        <SectionHeader id="proof-lineage" title="Transaction lineage" detail={`${formatCount(detail.handoffs.length)} verified ${detail.handoffs.length === 1 ? 'transfer' : 'transfers'}, oldest first`} />
        {detail.handoffs.length === 0 && <p className="nr-note">No handoff has been verified for this relay yet.</p>}
        {detail.baton.starterGrant && <StarterGrantProof grant={detail.baton.starterGrant} network={relay.network} />}
        <ol className="nr-ledger">
          {detail.handoffs.map(handoff => (
            <li key={handoff.id} id={`tx-${handoff.txHash}`} className="nr-ledger__entry">
              <p className="nr-ledger__leg">
                Leg {handoff.leg}
                {handoff.qualified && <Pill tone="verified">Verified</Pill>}
              </p>
              <dl className="nr-ledger__fields">
                <div>
                  <dt>Transaction</dt>
                  <dd>
                    <Copyable value={handoff.txHash} label="Transaction hash" />
                    <a className="nr-external" href={explorerUrl(handoff.network, handoff.txHash)} target="_blank" rel="noreferrer">
                      View on nimiq.watch <Icon name="external" size={14} />
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>From {handoff.from.name}</dt>
                  <dd>
                    <Copyable value={handoff.from.wallet} label="Sender address" />
                  </dd>
                </div>
                <div>
                  <dt>To {handoff.to.name}</dt>
                  <dd>
                    <Copyable value={handoff.to.wallet} label="Recipient address" />
                  </dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd className="nr-num">
                    {formatNim(handoff.value)} ({formatLuna(handoff.value)})
                  </dd>
                </div>
                <div>
                  <dt>Relay data</dt>
                  <dd>
                    <code className="nr-hash">
                      NR1.{relay.code}.{handoff.leg.toString(36)}.
                    </code>
                    <span className="nr-field-note">The transaction data starts with this relay and leg. Its final part commits to the prepared pass; the explorer shows it in full.</span>
                  </dd>
                </div>
                <div>
                  <dt>Block</dt>
                  <dd className="nr-num">
                    {formatCount(handoff.blockNumber)}, {formatCount(handoff.confirmations)} confirmations when verified
                  </dd>
                </div>
                <div>
                  <dt>Verified</dt>
                  <dd>{formatDateTime(handoff.at)}</dd>
                </div>
                <div>
                  <dt>Replay result</dt>
                  <dd>
                    <Copyable value={handoff.resultHash} label="Result hash" />
                    {scores.has(handoff.runId) && <span className="nr-field-note nr-num">Canonical score {formatCount(scores.get(handoff.runId) ?? 0)}</span>}
                    <a className="nr-external" {...linkProps(watchPath(handoff.runId, relay.code))}>
                      Watch canonical replay
                    </a>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </section>
      <div className="nr-actions">
        <LinkButton variant="secondary" to={pathFor('relay', { code: relay.code })}>
          Open journey
        </LinkButton>
        <LinkButton variant="quiet" to={pathFor('proof')}>
          Network metrics
        </LinkButton>
      </div>
    </>
  )
}

/** A treasury starter grant opened this baton. It is shown apart from the lineage because it is not a handoff. */
function StarterGrantProof({ grant, network }: { grant: AtlasStarterGrant; network: RelayNetwork }) {
  return (
    <div className="nr-ledger__entry" data-kind={grant.kind}>
      <p className="nr-ledger__leg">
        Starter grant <Pill tone="gold">treasury_starter_grant</Pill>
      </p>
      <p className="nr-field-note">
        NIM Relay’s grant treasury gave {grant.toRunner.name} this baton at Genesis Station, {formatDateTime(grant.at)}. It is not a player-to-player handoff and no relay metric counts it.
      </p>
      {grant.txHash && (
        <dl className="nr-ledger__fields">
          <div>
            <dt>Grant transaction</dt>
            <dd>
              <Copyable value={grant.txHash} label="Grant transaction hash" />
              <a className="nr-external" href={explorerUrl(network, grant.txHash)} target="_blank" rel="noreferrer">
                View on nimiq.watch <Icon name="external" size={14} />
              </a>
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}

export function ProofScreen({ code, entryKey }: { code: string | null; entryKey: string }) {
  const network = useNetwork()
  const { detail, query } = useRelay(code)
  if (!code) {
    return (
      <Screen title="Proof of the relay" entryKey={entryKey}>
        {network.snapshot ? (
          <NetworkProof snapshot={network.snapshot} />
        ) : network.loading ? (
          <Loading label="Loading verified records" />
        ) : (
          <EmptyState title="Records didn’t load" body="The relay server isn’t answering. Try again in a moment.">
            <Button variant="secondary" onClick={network.retry}>
              Try again
            </Button>
          </EmptyState>
        )}
      </Screen>
    )
  }
  const missing = query.error instanceof api.NetworkApiError && query.error.code === 'journey_not_found'
  return (
    <Screen title="Relay proof" kicker={detail ? toRelayView(detail.baton, { runners: [], rivals: [], now: detail.baton.updatedAt }).identity : undefined} entryKey={entryKey} peek="tall" parent={pathFor('proof')}>
      {detail ? (
        <RelayProof detail={detail} />
      ) : query.isPending ? (
        <Loading label="Loading verified transactions" />
      ) : missing ? (
        <EmptyState title="No relay uses this code" body={`There are no transactions for “${code}”. Check the link, or browse every relay record.`}>
          <LinkButton variant="secondary" to={pathFor('proof')}>
            All relay records
          </LinkButton>
        </EmptyState>
      ) : (
        <EmptyState title="Records didn’t load" body={playerMessage(query.error) ?? 'Try again in a moment.'}>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </EmptyState>
      )}
    </Screen>
  )
}
