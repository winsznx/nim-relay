import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { GrantsOpsReport } from '@nim-relay/shared'
import { explorerUrl, formatCount, formatNim, shortHash } from '../relays/format'
import { useAction } from '../shell/use-action'
import { Button } from '../shell/ui/Button'
import { Pill, SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { utcDateTime } from '../ops/dates'
import { loadGrantsOps, pauseGrants } from './api'
import { grantKeys } from './data'
import './grants.css'

const OPS_GRANTS_REFRESH_MS = 30_000

/**
 * Treasury state for operators: the runtime pause, caps and spend, and grant transfers kept apart from relay handoffs.
 * Wallets and devices in the abuse log appear as short one-way hashes only.
 */
export function OpsGrants() {
  const client = useQueryClient()
  const action = useAction()
  const query = useQuery({ queryKey: grantKeys.ops, queryFn: loadGrantsOps, refetchInterval: OPS_GRANTS_REFRESH_MS, retry: false })
  const report = query.data
  if (!report) return query.isError ? <p className="nr-note">Relay Grants status didn’t load.</p> : null
  const toggle = () =>
    action.run(async () => {
      client.setQueryData(grantKeys.ops, await pauseGrants(!report.paused))
    })
  return (
    <section className="nr-section" aria-labelledby="ops-grants" data-tour="ops-grants">
      <SectionHeader
        id="ops-grants"
        title="Relay Grants treasury"
        action={
          <Button variant={report.paused ? 'primary' : 'danger'} size="sm" busy={action.pending} onClick={toggle}>
            {report.paused ? 'Resume grants' : 'Pause grants'}
          </Button>
        }
      />
      <p className="nr-ops-definition">
        <Status report={report} /> Pausing stops new claims and rebroadcasts at once; transfers already sent keep being verified.
      </p>
      <StatRow columns={3} label="Treasury">
        <Stat value={report.balanceLuna === null ? 'Unknown' : formatNim(report.balanceLuna)} label={report.balanceAt ? `Balance at ${utcDateTime(report.balanceAt)}` : 'Balance, read at the next claim'} gold={report.lowBalance} />
        <Stat value={`${formatNim(report.spent.todayLuna)} / ${formatNim(report.caps.dailyLuna)}`} label="Reserved today" />
        <Stat value={`${formatNim(report.spent.globalLuna)} / ${formatNim(report.caps.globalLuna)}`} label="Reserved in total" />
      </StatRow>
      <StatRow columns={4} label="Grant transfers">
        <Stat value={formatCount(report.counts.prepared)} label="Signed, not sent" />
        <Stat value={formatCount(report.counts.broadcast)} label="Confirming" />
        <Stat value={formatCount(report.counts.confirmed)} label="Confirmed" />
        <Stat value={formatCount(report.counts.failed)} label="Failed" />
      </StatRow>
      <StatRow columns={3} label="Kept apart">
        <Stat value={formatCount(report.separation.treasuryGrantTransactions)} label="Treasury grants to players" />
        <Stat value={formatCount(report.separation.controlledGrantTransactions)} label="Grants to controlled wallets" />
        <Stat value={formatCount(report.separation.qualifiedRelayHandoffs)} label="Qualified relay handoffs" />
        <Stat value={formatCount(report.separation.transactingWallets)} label="Transacting wallets" />
        <Stat value={formatCount(report.separation.linkedWallets)} label="Linked wallets" />
        <Stat value={formatCount(report.separation.controlledWallets)} label="Controlled wallets" />
      </StatRow>
      <p className="nr-note nr-num">
        Caps: {formatNim(report.caps.transactionLuna)} per transfer, {formatNim(report.caps.participantLuna)} per wallet and device, low balance under {formatNim(report.caps.lowBalanceLuna)}.
      </p>
      {report.recent.length > 0 && (
        <ul className="nr-list">
          {report.recent.slice(0, 12).map(grant => (
            <li key={grant.txHash} className="nr-row">
              <span className="nr-row__body">
                <span className="nr-row__title">
                  @{grant.handle} {grant.milestone} {grant.controlled && <Pill>controlled</Pill>}
                </span>
                <span className="nr-row__meta nr-num">
                  {formatNim(grant.luna)}, {grant.state}
                  {grant.failure ? ` (${grant.failure})` : ''}, {utcDateTime(grant.at)},{' '}
                  <a href={explorerUrl(report.network, grant.txHash)} target="_blank" rel="noreferrer">
                    {shortHash(grant.txHash)}
                  </a>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <SectionHeader title="Refused and suspicious claims" detail={report.abuse.length > 0 ? `Latest ${formatCount(report.abuse.length)}` : undefined} />
      {report.abuse.length === 0 ? (
        <p className="nr-note">No claim has been refused for abuse reasons.</p>
      ) : (
        <ul className="nr-list">
          {report.abuse.slice(0, 20).map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="nr-row">
              <span className="nr-row__body">
                <span className="nr-row__title">{entry.reason}</span>
                <span className="nr-row__meta nr-num">
                  {entry.milestone}, wallet {entry.walletRef}, device {entry.deviceRef ?? 'none'}, {utcDateTime(entry.at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Status({ report }: { report: GrantsOpsReport }) {
  if (!report.configured) return <>Grants are off{report.configProblem ? `: ${report.configProblem}.` : ' (TREASURY_ENABLED is not "true").'}</>
  if (report.paused) return <>Paused by @{report.pausedBy ?? 'an operator'} at {report.pausedAt ? utcDateTime(report.pausedAt) : 'an unknown time'}.</>
  return <>Grants are on from {report.treasuryAddress ?? 'the treasury wallet'}.</>
}
