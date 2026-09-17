import type { OpsAlert } from '@nim-relay/shared'
import type { Profile } from '../model'
import { BATON_HOLD_MS, DAY_MS, HOUR_MS, MINUTE_MS, OPS_ARCHIVE_LAG_MS, OPS_QUIET_NETWORK_MS, OPS_REJECTION_RATE_LIMIT, OPS_RPC_ALERT_MS, OPS_STUCK_HANDOFF_MS } from './constants'
import { verificationsInLastDay } from './ops-ledger'
import type { NetworkState, OpsLedger } from './types'

/** The records alerts are measured from. */
export interface AlertSources {
  state: NetworkState
  ops: OpsLedger
  players: Readonly<Record<string, Pick<Profile, 'wallet'>>>
  archiveConfigured: boolean
}

/** What the alerts look at, measured once per report. */
export interface AlertFacts {
  now: number
  /** Hash submissions and rejections in the rolling 24 hours. */
  verifications: { submitted: number; rejected: number }
  lastRpcUnavailableAt: number | null
  /** Intents still attempting or submitted more than OPS_STUCK_HANDOFF_MS after they last reached Nimiq Pay. */
  stuckHandoffs: { attempting: number; submitted: number; oldestAttemptedAt: number | null }
  strandedBatons: number
  /** `waitingSince`: the later of the first unarchived change and the last successful archive. */
  archive: { configured: boolean; dirty: boolean; version: number; waitingSince: number | null }
  /** Rolling OPS_QUIET_NETWORK_MS. */
  recent: { qualifiedHandoffs: number; activeWallets: number }
}

export function alertFacts({ state, ops, players, archiveConfigured }: AlertSources, now: number): AlertFacts {
  const stuckHandoffs: AlertFacts['stuckHandoffs'] = { attempting: 0, submitted: 0, oldestAttemptedAt: null }
  for (const intent of Object.values(state.intents)) {
    if (intent.state !== 'attempting' && intent.state !== 'submitted') continue
    if (intent.attemptedAt === null || now - intent.attemptedAt <= OPS_STUCK_HANDOFF_MS) continue
    stuckHandoffs[intent.state]++
    stuckHandoffs.oldestAttemptedAt = Math.min(intent.attemptedAt, stuckHandoffs.oldestAttemptedAt ?? Infinity)
  }
  const recentSince = now - OPS_QUIET_NETWORK_MS
  const activeWallets = new Set(
    Object.entries(state.members).flatMap(([playerId, member]) => {
      const wallet = players[playerId]?.wallet
      return wallet && member.lastSeen > recentSince ? [wallet] : []
    }),
  )
  return {
    now,
    verifications: verificationsInLastDay(ops, now),
    lastRpcUnavailableAt: ops.lastRpcUnavailableAt,
    stuckHandoffs,
    strandedBatons: Object.values(state.batons).filter(baton => baton.status === 'stranded').length,
    archive: {
      configured: archiveConfigured,
      dirty: state.dirty,
      version: state.version,
      waitingSince: ops.unarchivedSince === null ? null : Math.max(ops.unarchivedSince, ops.lastArchivedAt ?? 0),
    },
    recent: { qualifiedHandoffs: state.handoffs.filter(handoff => handoff.qualified && handoff.at > recentSince).length, activeWallets: activeWallets.size },
  }
}

/** Every alert whose condition holds, critical first. */
export function opsAlerts(facts: AlertFacts): OpsAlert[] {
  return [rejectionAlert(facts), rpcAlert(facts), archiveAlert(facts), stuckHandoffAlert(facts), strandedBatonAlert(facts), quietNetworkAlert(facts)]
    .filter((alert): alert is OpsAlert => alert !== null)
    .sort((a, b) => severityRank(a) - severityRank(b))
}

function rejectionAlert({ verifications: { submitted, rejected } }: AlertFacts): OpsAlert | null {
  if (rejected === 0 || rejected <= submitted * OPS_REJECTION_RATE_LIMIT) return null
  const share = submitted === 0 ? 'with no new hash submitted' : `against ${plural(submitted, 'transaction hash', 'transaction hashes')} submitted (${percent(rejected / submitted)})`
  return {
    id: 'verification_rejections',
    severity: 'critical',
    title: `Verification rejections above ${percent(OPS_REJECTION_RATE_LIMIT)}`,
    condition: `${plural(rejected, 'rejection')} in the last 24 h ${share}. Alert above ${percent(OPS_REJECTION_RATE_LIMIT)}.`,
  }
}

function rpcAlert({ now, lastRpcUnavailableAt }: AlertFacts): OpsAlert | null {
  if (lastRpcUnavailableAt === null || now - lastRpcUnavailableAt > OPS_RPC_ALERT_MS) return null
  return {
    id: 'rpc_unavailable',
    severity: 'critical',
    title: 'Handoff checks returned RPC_UNAVAILABLE',
    condition: `The latest RPC_UNAVAILABLE was ${span(now - lastRpcUnavailableAt)} ago, at ${clock(lastRpcUnavailableAt)}. Alert for ${span(OPS_RPC_ALERT_MS)} after any.`,
  }
}

function archiveAlert({ now, archive }: AlertFacts): OpsAlert | null {
  if (!archive.configured) {
    return { id: 'archive_not_configured', severity: 'warning', title: 'Supabase archive is off', condition: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is empty on this Worker, so network state is never archived.' }
  }
  if (!archive.dirty || archive.waitingSince === null || now - archive.waitingSince <= OPS_ARCHIVE_LAG_MS) return null
  return {
    id: 'archive_lagging',
    severity: 'critical',
    title: 'Supabase archive lagging',
    condition: `Network state version ${archive.version} has changes the archive has not caught up with for ${span(now - archive.waitingSince)}, with no successful archive since. Alert after ${span(OPS_ARCHIVE_LAG_MS)}.`,
  }
}

function stuckHandoffAlert({ now, stuckHandoffs: { attempting, submitted, oldestAttemptedAt } }: AlertFacts): OpsAlert | null {
  if (oldestAttemptedAt === null) return null
  return {
    id: 'stuck_handoffs',
    severity: 'warning',
    title: `Handoffs open over ${span(OPS_STUCK_HANDOFF_MS)}`,
    condition: `${plural(attempting + submitted, 'handoff')} still open more than ${span(OPS_STUCK_HANDOFF_MS)} after reaching Nimiq Pay: ${attempting} attempting, ${submitted} submitted. The oldest reached Nimiq Pay ${span(now - oldestAttemptedAt)} ago.`,
  }
}

function strandedBatonAlert({ strandedBatons }: AlertFacts): OpsAlert | null {
  if (strandedBatons === 0) return null
  return { id: 'stranded_batons', severity: 'warning', title: 'Stranded batons', condition: `${plural(strandedBatons, 'baton')} stranded: the holder let the ${span(BATON_HOLD_MS)} hold pass with no transfer underway.` }
}

function quietNetworkAlert({ recent }: AlertFacts): OpsAlert | null {
  if (recent.qualifiedHandoffs > 0 || recent.activeWallets === 0) return null
  return {
    id: 'no_handoffs',
    severity: 'warning',
    title: `No qualified handoffs in ${span(OPS_QUIET_NETWORK_MS)}`,
    condition: `0 qualified handoffs in the last ${span(OPS_QUIET_NETWORK_MS)} while ${plural(recent.activeWallets, 'linked wallet')} ${recent.activeWallets === 1 ? 'was' : 'were'} active.`,
  }
}

function severityRank(alert: OpsAlert): number {
  return alert.severity === 'critical' ? 0 : 1
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Compact span such as "12 min", "2 h 5 min" or "3 d 4 h". */
function span(ms: number): string {
  if (ms < MINUTE_MS) return 'under 1 min'
  const minutes = Math.floor(ms / MINUTE_MS)
  if (ms < HOUR_MS) return `${minutes} min`
  const hours = Math.floor(ms / HOUR_MS)
  if (ms < 2 * DAY_MS) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`
}

function clock(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`
}
