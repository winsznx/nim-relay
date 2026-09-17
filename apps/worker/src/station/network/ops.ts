import { lunaToNim, type OpsFlaggedRun, type OpsNimFlow, type OpsReport, type OpsTotals, type RelayNetwork } from '@nim-relay/shared'
import { OPS_WINDOW_DAYS } from './constants'
import { networkMetrics } from './metrics'
import { opsDays, opsFunnel } from './ops-activity'
import { alertFacts, opsAlerts } from './ops-alerts'
import { onboardingReport } from './tour-ledger'
import type { NetworkContext, TourLedger } from './types'

/** Whether `OPS_PLAYERS` lists the player by id, or by handle with or without "@" in any case. Unset lists nobody. */
export function isOperator(opsPlayers: string | undefined, player: { id: string; handle: string }): boolean {
  const handle = player.handle.toLowerCase()
  return (opsPlayers ?? '')
    .split(',')
    .map(entry => entry.trim())
    .some(entry => entry !== '' && (entry === player.id || entry.replace(/^@/, '').toLowerCase() === handle))
}

/**
 * The operator report for this Worker's network. Built from recorded facts only and read-only: nothing here
 * writes network state, traffic or either ledger. Runners appear by handle, never by wallet or id.
 */
export function opsReport(context: NetworkContext, tours: TourLedger, now: number): OpsReport {
  const { env, state, ops, product } = context
  const archiveConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  return {
    network: env.NIMIQ_NETWORK,
    generatedAt: now,
    windowDays: OPS_WINDOW_DAYS,
    countingSince: { runs: ops.startedAt, shares: context.traffic.shareTalliesSince },
    alerts: opsAlerts(alertFacts({ state, ops, players: product.players, archiveConfigured }, now)),
    totals: opsTotals(context),
    days: opsDays(context, now),
    funnel: opsFunnel(context, now),
    flaggedRuns: ops.flaggedRuns.map((run): OpsFlaggedRun => ({ handle: run.handle, reason: run.reason, mode: run.mode, practice: run.practice, at: run.at, attempts: run.attempts })),
    nimFlow: nimFlow(context),
    onboarding: onboardingReport(tours, now),
  }
}

/** Public metrics keep their own semantics; the report only regroups them and adds baton and social counts. */
function opsTotals(context: NetworkContext): OpsTotals {
  const { state, product, traffic } = context
  const metrics = networkMetrics(context)
  const batons = { active: 0, stranded: 0, completed: 0 }
  for (const baton of Object.values(state.batons)) batons[baton.status]++
  const surfaces = traffic.sharesBySurface
  const bySurface = { chronicle: surfaces.chronicle ?? 0, result: surfaces.result ?? 0, daily: surfaces.daily ?? 0, crew: surfaces.crew ?? 0, handoff: surfaces.handoff ?? 0 }
  const attributed = Object.values(bySurface).reduce((sum, count) => sum + count, 0)
  return {
    linkedWallets: metrics.linkedWallets,
    transactingWallets: metrics.transactingWallets,
    qualifiedHandoffs: metrics.qualifiedHandoffs,
    batons,
    crews: product.crews.length,
    rivals: state.rivals.length,
    invites: { created: metrics.invites, opened: metrics.inviteOpens, converted: metrics.inviteConversions },
    shares: { total: metrics.shares, bySurface, unattributed: Math.max(0, metrics.shares - attributed) },
    chronicleViews: metrics.chronicleViews,
    returningWallets: metrics.returningWallets,
    foregroundSeconds: metrics.foregroundSeconds,
    evidence: {
      mainnetHandoffs: metrics.mainnetHandoffs,
      testnetHandoffs: metrics.testnetHandoffs,
      controlledHandoffs: metrics.controlledEvidence.handoffs,
      controlledWallets: metrics.controlledEvidence.wallets,
    },
  }
}

/** Value moved by qualified handoffs, per the network each transfer was verified on. Summed in integer Luna. */
function nimFlow(context: NetworkContext): OpsNimFlow[] {
  const flows = new Map<RelayNetwork, { handoffs: number; luna: bigint }>()
  for (const handoff of context.state.handoffs) {
    if (!handoff.qualified) continue
    const flow = flows.get(handoff.network) ?? { handoffs: 0, luna: 0n }
    flows.set(handoff.network, { handoffs: flow.handoffs + 1, luna: flow.luna + BigInt(handoff.value) })
  }
  return [...flows].map(([network, flow]) => ({ network, handoffs: flow.handoffs, luna: Number(flow.luna), nim: lunaToNim(flow.luna) }))
}
