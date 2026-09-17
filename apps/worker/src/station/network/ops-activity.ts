import type { HandoffRejectionReason, NetworkHandoffIntent, OpsDay, OpsFunnel } from '@nim-relay/shared'
import { utcDate, utcDatesEnding } from './calendar'
import { OPS_WINDOW_DAYS } from './constants'
import { REJECTION_REASONS } from './reasons'
import type { NetworkContext, OpsDayCounters } from './types'

type RunCounts = Pick<OpsDay, 'runsSubmitted' | 'runsVerified' | 'runsRejected' | 'runsRefused'>

const RUNS_NOT_RECORDED: RunCounts = { runsSubmitted: null, runsVerified: null, runsRejected: null, runsRefused: null }

/** The report's UTC days, oldest first. Counters that started later read null on the days before they started. */
export function opsDays(context: NetworkContext, now: number): OpsDay[] {
  const { state, traffic, ops } = context
  const dates = utcDatesEnding(now, OPS_WINDOW_DAYS)
  const newWallets = countByDate([...walletFirstSeen(context).values()])
  const activeWallets = activeWalletsByDate(context, new Set(dates))
  const handoffs = countByDate(state.handoffs.filter(handoff => handoff.qualified).map(handoff => handoff.at))
  const runsSince = utcDate(ops.startedAt)
  const sharesSince = utcDate(traffic.shareTalliesSince)
  return dates.map(date => ({
    date,
    newWallets: newWallets.get(date) ?? 0,
    activeWallets: activeWallets.get(date)?.size ?? 0,
    qualifiedHandoffs: handoffs.get(date) ?? 0,
    dailyAttempts: Object.keys(state.daily[date] ?? {}).length,
    ...(date >= runsSince ? runCounts(ops.days[date]) : RUNS_NOT_RECORDED),
    shares: date >= sharesSince ? (traffic.sharesByDay[date] ?? 0) : null,
  }))
}

function runCounts(day: OpsDayCounters | undefined): RunCounts {
  const verified = day?.runsVerified ?? 0
  const rejected = day?.runsRejected ?? 0
  const refused = day?.runsRefused ?? 0
  return { runsSubmitted: verified + rejected + refused, runsVerified: verified, runsRejected: rejected, runsRefused: refused }
}

/**
 * Intents prepared on the report's days, by the furthest stage each reached and their state now, with the
 * verification rejections recorded on those days.
 */
export function opsFunnel(context: NetworkContext, now: number): OpsFunnel {
  const { state } = context
  const firstDate = utcDatesEnding(now, OPS_WINDOW_DAYS)[0] ?? utcDate(now)
  const verifiedAt = new Map(state.handoffs.map(handoff => [handoff.id, handoff.at]))
  const funnel = { prepared: 0, attempted: 0, submitted: 0, verified: 0, cancelled: 0, expired: 0, open: 0 }
  const attemptToVerified: number[] = []
  for (const intent of Object.values(state.intents)) {
    if (utcDate(intent.createdAt) < firstDate) continue
    funnel.prepared++
    if (intent.attemptedAt !== null) funnel.attempted++
    if (hashReceived(intent)) funnel.submitted++
    switch (intent.state) {
      case 'verified': {
        funnel.verified++
        const verifiedTime = verifiedAt.get(intent.id)
        if (verifiedTime !== undefined && intent.attemptedAt !== null) attemptToVerified.push(verifiedTime - intent.attemptedAt)
        break
      }
      case 'cancelled':
        funnel.cancelled++
        break
      case 'expired':
        funnel.expired++
        break
      default:
        funnel.open++
    }
  }
  return { ...funnel, rejections: rejectionsFrom(context, firstDate), medianAttemptToVerifiedMs: median(attemptToVerified) }
}

/**
 * Whether a transaction hash was ever bound to the intent. Binding makes it submitted, and every verification
 * outcome after that leaves a verified state or a reason, even when a rejection released the hash again. NOT_SENT is
 * the one reason an intent gets without a hash, and it replaces any earlier reason.
 */
function hashReceived(intent: NetworkHandoffIntent): boolean {
  return intent.state === 'submitted' || intent.state === 'verified' || (intent.failure !== null && intent.failure !== 'NOT_SENT')
}

function rejectionsFrom(context: NetworkContext, firstDate: string): Record<HandoffRejectionReason, number> {
  const totals: Record<HandoffRejectionReason, number> = {
    SENDER_MISMATCH: 0,
    RECIPIENT_MISMATCH: 0,
    VALUE_MISMATCH: 0,
    DATA_MALFORMED: 0,
    DATA_RELAY_MISMATCH: 0,
    DATA_LEG_MISMATCH: 0,
    DATA_COMMITMENT_MISMATCH: 0,
    NETWORK_MISMATCH: 0,
    EXECUTION_FAILED: 0,
    DUPLICATE_TRANSACTION: 0,
    CUSTODY_CHANGED: 0,
    INTENT_EXPIRED: 0,
  }
  for (const [date, day] of Object.entries(context.ops.days)) {
    if (date < firstDate) continue
    for (const reason of REJECTION_REASONS) totals[reason] += day.rejections[reason] ?? 0
  }
  return totals
}

/** Each linked wallet at the first time one of its runners joined the network. */
function walletFirstSeen(context: NetworkContext): Map<string, number> {
  const firstSeen = new Map<string, number>()
  for (const [playerId, member] of Object.entries(context.state.members)) {
    const wallet = context.product.players[playerId]?.wallet
    if (wallet) firstSeen.set(wallet, Math.min(member.firstSeen, firstSeen.get(wallet) ?? Infinity))
  }
  return firstSeen
}

function activeWalletsByDate(context: NetworkContext, dates: ReadonlySet<string>): Map<string, Set<string>> {
  const active = new Map<string, Set<string>>()
  for (const [playerId, member] of Object.entries(context.state.members)) {
    const wallet = context.product.players[playerId]?.wallet
    if (!wallet) continue
    for (const date of member.days) {
      if (!dates.has(date)) continue
      const wallets = active.get(date) ?? new Set<string>()
      wallets.add(wallet)
      active.set(date, wallets)
    }
  }
  return active
}

function countByDate(times: readonly number[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const time of times) {
    const date = utcDate(time)
    counts.set(date, (counts.get(date) ?? 0) + 1)
  }
  return counts
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) return null
  if (sorted.length % 2 === 1) return upper
  return Math.round(((sorted[middle - 1] ?? upper) + upper) / 2)
}
