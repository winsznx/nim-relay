import { NimiqRpcClient, paymentAddress, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { Env } from '../../../env'
import { CHAIN_CLOCK_SKEW_MS, MIN_CONFIRMATIONS, SENDER_HISTORY_MAX_PAGES, SENDER_HISTORY_PAGE_SIZE, TRANSACTION_VALIDITY_WINDOW_BLOCKS } from '../constants'
import { lookupTransaction } from '../handoff'
import type { GrantFailure, GrantRecord } from './ledger'

/**
 * Treasury chain reads and broadcasts. All of it runs outside the room's critical section and never throws: a failed
 * read is `unknown`, and nothing decides a grant's outcome from an unknown.
 */

/** Blocks past the validity window before a missing transfer counts as never included, for slow or lagging nodes. */
export const VALIDITY_MARGIN_BLOCKS = 120
/** An open grant's signed bytes go to the node again at most this often. */
export const REBROADCAST_INTERVAL_MS = 30_000

export interface ClaimChainFacts {
  treasuryLuna: number
  height: number
  /** Only read for starter claims. */
  walletLuna: number | null
}

export async function readClaimFacts(env: Env, treasuryAddress: string, wallet: string | null): Promise<ClaimChainFacts | null> {
  const client = rpc(env)
  try {
    const treasury = await client.getAccountBalance(treasuryAddress)
    const height = await client.getBlockNumber()
    const walletLuna = wallet ? Number((await client.getAccountBalance(wallet)).luna) : null
    return { treasuryLuna: Number(treasury.luna), height: Math.max(height, treasury.blockNumber), walletLuna }
  } catch (error) {
    console.error('Grant chain read failed', error instanceof Error ? error.name : 'unknown')
    return null
  }
}

export async function readWalletBalance(env: Env, wallet: string): Promise<number | null> {
  try {
    return Number((await rpc(env).getAccountBalance(wallet)).luna)
  } catch {
    return null
  }
}

/** Returns whether the node accepted the bytes. A node that already has the transfer may refuse it; the lookup decides. */
export async function broadcast(env: Env, record: Pick<GrantRecord, 'serializedHex' | 'txHash' | 'id'>): Promise<boolean> {
  try {
    const hash = await rpc(env).sendRawTransaction(record.serializedHex)
    if (hash !== record.txHash) console.error('Grant broadcast hash differs from the signed hash', record.id)
    return hash === record.txHash
  } catch (error) {
    console.error('Grant broadcast deferred', record.id, error instanceof Error ? error.name : 'unknown')
    return false
  }
}

export type GrantOutcome =
  | { kind: 'confirmed'; confirmations: number; blockNumber: number }
  | { kind: 'included'; confirmations: number; blockNumber: number | null }
  | { kind: 'failed'; failure: GrantFailure }
  | { kind: 'unknown' }

/** What the chain shows for one open grant, gathered outside the critical section. */
export interface GrantEvidence {
  id: string
  txHash: string
  outcome: GrantOutcome
  /** Set when the bytes were sent to the node again during this lookup. */
  rebroadcastAt: number | null
}

export async function lookUpGrant(env: Env, record: GrantRecord, treasuryAddress: string, mayBroadcast: boolean, now: number): Promise<GrantEvidence> {
  const evidence = (outcome: GrantOutcome, rebroadcastAt: number | null = null): GrantEvidence => ({ id: record.id, txHash: record.txHash, outcome, rebroadcastAt })
  const lookup = await lookupTransaction(env, record.txHash)
  if (lookup.found) return evidence(judgeTransaction(record, treasuryAddress, lookup.transaction))
  if (lookup.reason === 'RPC_UNAVAILABLE') return evidence({ kind: 'unknown' })
  const client = rpc(env)
  try {
    const head = await client.getBlockNumber()
    if (head > record.validityStartHeight + TRANSACTION_VALIDITY_WINDOW_BLOCKS + VALIDITY_MARGIN_BLOCKS) {
      return evidence((await treasuryHistoryLacks(client, treasuryAddress, record)) ? { kind: 'failed', failure: 'NOT_INCLUDED' } : { kind: 'unknown' })
    }
  } catch (error) {
    console.error('Grant head lookup failed', record.id, error instanceof Error ? error.name : 'unknown')
    return evidence({ kind: 'unknown' })
  }
  const due = record.lastBroadcastAt === null || now - record.lastBroadcastAt >= REBROADCAST_INTERVAL_MS
  if (mayBroadcast && due && (await broadcast(env, record))) return evidence({ kind: 'unknown' }, now)
  return evidence({ kind: 'unknown' })
}

/** The transfer found under the grant's hash, held against every term it was signed with. */
export function judgeTransaction(record: GrantRecord, treasuryAddress: string, transaction: NimiqTransaction): GrantOutcome {
  const matches =
    transaction.hash === record.txHash &&
    paymentAddress(transaction.sender) === paymentAddress(treasuryAddress) &&
    paymentAddress(transaction.recipient) === paymentAddress(record.recipient) &&
    BigInt(transaction.value) === BigInt(record.luna) &&
    sameNetwork(transaction.network, record.network)
  if (!matches) return { kind: 'failed', failure: 'CHAIN_MISMATCH' }
  if (transaction.blockNumber === null) return { kind: 'included', confirmations: 0, blockNumber: null }
  if (transaction.executionResult === false) return { kind: 'failed', failure: 'EXECUTION_FAILED' }
  const confirmations = transaction.confirmations ?? 0
  if (transaction.executionResult === true && confirmations >= MIN_CONFIRMATIONS) return { kind: 'confirmed', confirmations, blockNumber: transaction.blockNumber }
  return { kind: 'included', confirmations, blockNumber: transaction.blockNumber }
}

function sameNetwork(reported: string | null, expected: string): boolean {
  if (reported === null) return false
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '').replace(/albatross$/, '')
  return normalize(reported) === normalize(expected)
}

/** Whether the treasury's history, read back past the grant's creation, lacks its hash. False when it could not be read that far. */
async function treasuryHistoryLacks(client: NimiqRpcClient, treasuryAddress: string, record: GrantRecord): Promise<boolean> {
  let startAt: string | null = null
  for (let page = 0; page < SENDER_HISTORY_MAX_PAGES; page++) {
    const entries = await client.getTransactionsByAddress(treasuryAddress, SENDER_HISTORY_PAGE_SIZE, startAt)
    if (entries.some(entry => entry.hash === record.txHash)) return false
    const oldest = entries.at(-1)
    if (!oldest || entries.length < SENDER_HISTORY_PAGE_SIZE || oldest.timestamp < record.createdAt - CHAIN_CLOCK_SKEW_MS) return true
    startAt = oldest.hash
  }
  return false
}

function rpc(env: Env): NimiqRpcClient {
  return new NimiqRpcClient({ rpcUrl: env.NIMIQ_RPC_URL })
}
