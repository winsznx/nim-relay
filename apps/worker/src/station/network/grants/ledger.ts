import type { GrantAbuseEntry, GrantAbuseReason, GrantMilestoneId, RelayNetwork } from '@nim-relay/shared'
import { sha256Hex } from '../../signing'
import { keepLatestDates, utcDate } from '../calendar'
import { OPS_WINDOW_DAYS } from '../constants'

/**
 * Durable grant records. Each grant, wallet charge and device charge lives on a small key of its own; the ledger key
 * holds the network-wide totals. Every change to a charge commits in one storage transaction with the record it
 * belongs to, inside the room's critical section, so caps are checked against exactly what is stored.
 */

export const MAX_ABUSE_ENTRIES = 100
export const MAX_RECENT_GRANTS = 50
export const MAX_FAILED_ATTEMPTS = 5

export type GrantRecordState = 'prepared' | 'broadcast' | 'confirmed' | 'failed'

export type GrantFailure =
  /** Included, but the chain reports the transfer failed. */
  | 'EXECUTION_FAILED'
  /** The validity window passed and the treasury's history has no such transfer. */
  | 'NOT_INCLUDED'
  /** A transaction with this hash disagrees with the signed transfer. Never releases the reservation. */
  | 'CHAIN_MISMATCH'

export interface GrantRecord {
  /** `grant:<milestone>:<playerId>`, the idempotency key. */
  id: string
  milestone: GrantMilestoneId
  playerId: string
  handle: string
  /** An OPS_PLAYERS runner: kept out of player-facing grant counts. */
  controlled: boolean
  /** The treasury address that signed. Verification holds the chain to it even if the key is later rotated. */
  sender: string
  recipient: string
  deviceHash: string
  network: RelayNetwork
  luna: number
  feeLuna: number
  state: GrantRecordState
  txHash: string
  /** Fully signed transfer. Re-broadcast unchanged, so the hash never changes. Holds no key material. */
  serializedHex: string
  validityStartHeight: number
  /** 1 for the first claim, then one more for every retry after a failure. */
  attempt: number
  createdAt: number
  updatedAt: number
  lastBroadcastAt: number | null
  confirmations: number | null
  blockNumber: number | null
  failure: GrantFailure | null
  /** Whether the failure released the reservation. */
  released: boolean
  /** Starter grants: the baton the confirmation created. */
  batonId: string | null
  /** Hashes of earlier attempts that failed. */
  failedHashes: string[]
}

export interface ChargeRecord {
  /** Reserved or confirmed Luna, fees included. Released only by a failed grant. */
  chargedLuna: number
  /** Milestone -> the grant id charged to this wallet or device. */
  grants: Partial<Record<GrantMilestoneId, string>>
}

export interface GrantLedger {
  startedAt: number
  paused: { at: number; by: string } | null
  globalLuna: number
  /** UTC date -> Luna charged by grants created that day. */
  days: Record<string, number>
  /** Grant ids waiting for chain confirmation, oldest first. */
  open: string[]
  counts: { created: number; confirmed: number; failed: number; controlledCreated: number; controlledConfirmed: number }
  confirmedLuna: number
  controlledConfirmedLuna: number
  treasury: { balanceLuna: number; at: number } | null
  claimsDay: string
  /** Claim attempts on `claimsDay` per player. */
  claimsToday: Record<string, number>
  abuse: GrantAbuseEntry[]
  /** Newest first. */
  recent: string[]
}

export function grantsKey(networkKey: string): string {
  return `${networkKey}:grants`
}

export const grantRecordKey = (base: string, id: string) => `${base}:record:${id}`
export const walletChargeKey = (base: string, wallet: string) => `${base}:wallet:${wallet}`
export const deviceChargeKey = (base: string, deviceHash: string) => `${base}:device:${deviceHash}`

export function grantId(milestone: GrantMilestoneId, playerId: string): string {
  return `grant:${milestone}:${playerId}`
}

export function freshLedger(now: number): GrantLedger {
  return { startedAt: now, paused: null, globalLuna: 0, days: {}, open: [], counts: { created: 0, confirmed: 0, failed: 0, controlledCreated: 0, controlledConfirmed: 0 }, confirmedLuna: 0, controlledConfirmedLuna: 0, treasury: null, claimsDay: utcDate(now), claimsToday: {}, abuse: [], recent: [] }
}

type Reader = Pick<DurableObjectStorage, 'get'> | Pick<DurableObjectTransaction, 'get'>

export async function readLedger(storage: Reader, base: string, now: number): Promise<GrantLedger> {
  return (await storage.get<GrantLedger>(base)) ?? freshLedger(now)
}

export async function readCharge(storage: Reader, key: string): Promise<ChargeRecord> {
  return (await storage.get<ChargeRecord>(key)) ?? { chargedLuna: 0, grants: {} }
}

export async function readRecords(storage: Reader, base: string, ids: readonly string[]): Promise<GrantRecord[]> {
  const records: GrantRecord[] = []
  for (const id of ids) {
    const record = await storage.get<GrantRecord>(grantRecordKey(base, id))
    if (record) records.push(record)
  }
  return records
}

export function isOpenGrant(record: GrantRecord): boolean {
  return record.state === 'prepared' || record.state === 'broadcast'
}

/** Whether a grant still counts against caps and blocks another claim of its milestone. */
export function holdsReservation(record: GrantRecord): boolean {
  return record.state !== 'failed' || !record.released
}

export function chargedToday(ledger: GrantLedger, now: number): number {
  return ledger.days[utcDate(now)] ?? 0
}

export function charge(ledger: GrantLedger, wallet: ChargeRecord, device: ChargeRecord, record: GrantRecord, now: number): void {
  const total = record.luna + record.feeLuna
  ledger.globalLuna += total
  const today = utcDate(now)
  ledger.days[today] = (ledger.days[today] ?? 0) + total
  keepLatestDates(ledger.days, now, OPS_WINDOW_DAYS)
  if (!ledger.open.includes(record.id)) ledger.open.push(record.id)
  ledger.counts.created++
  if (record.controlled) ledger.counts.controlledCreated++
  ledger.recent = [record.id, ...ledger.recent.filter(id => id !== record.id)].slice(0, MAX_RECENT_GRANTS)
  wallet.chargedLuna += total
  wallet.grants[record.milestone] = record.id
  device.chargedLuna += total
  device.grants[record.milestone] = record.id
}

/** Gives a failed grant's reservation back to every cap it was charged against. */
export function release(ledger: GrantLedger, wallet: ChargeRecord, device: ChargeRecord, record: GrantRecord): void {
  const total = record.luna + record.feeLuna
  ledger.globalLuna = Math.max(0, ledger.globalLuna - total)
  const day = utcDate(record.createdAt)
  if (ledger.days[day] !== undefined) ledger.days[day] = Math.max(0, ledger.days[day] - total)
  wallet.chargedLuna = Math.max(0, wallet.chargedLuna - total)
  device.chargedLuna = Math.max(0, device.chargedLuna - total)
  if (wallet.grants[record.milestone] === record.id) delete wallet.grants[record.milestone]
  if (device.grants[record.milestone] === record.id) delete device.grants[record.milestone]
  record.released = true
}

/** Counts a claim attempt for its player on the current UTC day. Returns false once the player is over `limit`. */
export function countClaimAttempt(ledger: GrantLedger, playerId: string, limit: number, now: number): boolean {
  const today = utcDate(now)
  if (ledger.claimsDay !== today) {
    ledger.claimsDay = today
    ledger.claimsToday = {}
  }
  const attempts = (ledger.claimsToday[playerId] ?? 0) + 1
  ledger.claimsToday[playerId] = attempts
  return attempts <= limit
}

export async function logAbuse(ledger: GrantLedger, entry: { reason: GrantAbuseReason; milestone: GrantMilestoneId; wallet: string; deviceHash: string | null }, now: number): Promise<void> {
  const walletRef = (await sha256Hex(`grant-wallet:${entry.wallet}`)).slice(0, 12)
  const deviceRef = entry.deviceHash ? (await sha256Hex(`grant-device:${entry.deviceHash}`)).slice(0, 12) : null
  ledger.abuse = [{ at: now, reason: entry.reason, milestone: entry.milestone, walletRef, deviceRef }, ...ledger.abuse].slice(0, MAX_ABUSE_ENTRIES)
}
