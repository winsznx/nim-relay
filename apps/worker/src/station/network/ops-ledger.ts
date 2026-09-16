import type { HandoffRejectionReason, IssuedRace, OpsFlagReason, RelayNetwork } from '@nim-relay/shared'
import { keepLatestDates, utcDate, utcHourIndex } from './calendar'
import { MAX_FLAGGED_RUNS, OPS_WINDOW_DAYS, OPS_WINDOW_HOURS } from './constants'
import { networkStateKey } from './state'
import type { OpsDayCounters, OpsHourCounters, OpsLedger } from './types'

/** What became of a signed relay-network race submission. */
export type RunOutcome = 'verified' | 'rejected' | 'refused'
/** A submission refused before replay: flagged when its ticket or trace was bad, merely refused when it expired. */
export type SubmissionRefusal = OpsFlagReason | 'EXPIRED'

export interface RefusedSubmission {
  issued: IssuedRace
  handle: string
  reason: SubmissionRefusal
}

export function opsLedgerKey(networkKey: string): string {
  return `${networkKey}:ops`
}

export function freshOpsLedger(now: number): OpsLedger {
  return { startedAt: now, days: {}, hours: {}, lastRpcUnavailableAt: null, unarchivedSince: null, lastArchivedAt: null, flaggedRuns: [] }
}

export async function readOpsLedger(storage: DurableObjectStorage, key: string, now: number): Promise<OpsLedger> {
  return (await storage.get<OpsLedger>(key)) ?? freshOpsLedger(now)
}

/** Accepts a transaction so the ledger can commit together with the network state. */
export async function writeOpsLedger(storage: DurableObjectStorage | DurableObjectTransaction, key: string, ledger: OpsLedger): Promise<void> {
  await storage.put(key, ledger)
}

export function countRun(ledger: OpsLedger, outcome: RunOutcome, now: number): void {
  const day = dayCounters(ledger, now)
  if (outcome === 'verified') day.runsVerified++
  else if (outcome === 'rejected') day.runsRejected++
  else day.runsRefused++
}

/** A transaction hash sent to verify an intent it was not already bound to. Re-checking a bound hash is not counted. */
export function countHashSubmission(ledger: OpsLedger, now: number): void {
  dayCounters(ledger, now).hashesSubmitted++
  hourCounters(ledger, now).hashesSubmitted++
}

/** A submitted hash that can never verify its intent. Each submission is rejected at most once. */
export function countRejection(ledger: OpsLedger, reason: HandoffRejectionReason, now: number): void {
  const day = dayCounters(ledger, now)
  day.rejections[reason] = (day.rejections[reason] ?? 0) + 1
  hourCounters(ledger, now).rejections++
}

export function noteRpcUnavailable(ledger: OpsLedger, now: number): void {
  ledger.lastRpcUnavailableAt = now
}

/** The network state changed. The archive lag runs from the first change the archive has not caught up with. */
export function noteUnarchivedChange(ledger: OpsLedger, now: number): void {
  ledger.unarchivedSince ??= now
}

/** A Supabase archive succeeded. `caughtUp` when nothing changed after the archived snapshot was read. */
export function noteArchived(ledger: OpsLedger, now: number, caughtUp: boolean): void {
  ledger.lastArchivedAt = now
  if (caughtUp) ledger.unarchivedSince = null
}

/** Newest first and capped. Resubmitting the same run for the same reason updates its entry instead of adding one. */
export function flagRun(ledger: OpsLedger, submission: RefusedSubmission & { reason: OpsFlagReason }, now: number): void {
  const { issued, handle, reason } = submission
  const earlier = ledger.flaggedRuns.find(run => run.runId === issued.runId && run.reason === reason)
  const others = ledger.flaggedRuns.filter(run => run !== earlier)
  const flagged = { runId: issued.runId, handle, reason, mode: issued.mode, practice: issued.practice ?? false, at: now, attempts: (earlier?.attempts ?? 0) + 1 }
  ledger.flaggedRuns = [flagged, ...others].slice(0, MAX_FLAGGED_RUNS)
}

/**
 * Counts a relay-network submission refused before replay, on the ledger's own key. The network state is neither
 * loaded nor rewritten, so a stream of bad submissions costs one small write each.
 */
export async function recordRefusedSubmission(storage: DurableObjectStorage, network: RelayNetwork, submission: RefusedSubmission, now: number): Promise<void> {
  const key = opsLedgerKey(networkStateKey(network))
  const ledger = await readOpsLedger(storage, key, now)
  const { reason } = submission
  if (reason === 'EXPIRED') {
    countRun(ledger, 'refused', now)
  } else {
    countRun(ledger, 'rejected', now)
    flagRun(ledger, { ...submission, reason }, now)
  }
  await writeOpsLedger(storage, key, ledger)
}

/** Hash submissions and rejections in the current UTC hour and the 23 hours before it. */
export function verificationsInLastDay(ledger: OpsLedger, now: number): { submitted: number; rejected: number } {
  const current = utcHourIndex(now)
  const totals = { submitted: 0, rejected: 0 }
  for (const [hour, counters] of Object.entries(ledger.hours)) {
    if (Number(hour) > current || isBeforeHourWindow(Number(hour), now)) continue
    totals.submitted += counters.hashesSubmitted
    totals.rejected += counters.rejections
  }
  return totals
}

function isBeforeHourWindow(hour: number, now: number): boolean {
  return hour <= utcHourIndex(now) - OPS_WINDOW_HOURS
}

function dayCounters(ledger: OpsLedger, now: number): OpsDayCounters {
  keepLatestDates(ledger.days, now, OPS_WINDOW_DAYS)
  const date = utcDate(now)
  const day = ledger.days[date] ?? { runsVerified: 0, runsRejected: 0, runsRefused: 0, hashesSubmitted: 0, rejections: {} }
  ledger.days[date] = day
  return day
}

function hourCounters(ledger: OpsLedger, now: number): OpsHourCounters {
  for (const hour of Object.keys(ledger.hours)) {
    if (isBeforeHourWindow(Number(hour), now)) delete ledger.hours[hour]
  }
  const hour = String(utcHourIndex(now))
  const counters = ledger.hours[hour] ?? { hashesSubmitted: 0, rejections: 0 }
  ledger.hours[hour] = counters
  return counters
}
