import { NimiqRpcClient, paymentAddress, type ChainHead, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { NetworkHandoffIntent } from '@nim-relay/shared'
import type { Env } from '../../env'
import { CHAIN_CLOCK_SKEW_MS, SENDER_HISTORY_MAX_PAGES, SENDER_HISTORY_PAGE_SIZE, UNSENT_PASS_EXPIRY_MS } from './constants'
import { bindTransaction, confirmHandoff, lookupTransaction, type Persist, type TransactionLookup } from './handoff'
import { notify } from './lookups'
import type { NetworkContext, NetworkState } from './types'

/**
 * Recovery of passes that reached Nimiq Pay while no transaction hash ever reached the relay: the holder declined, or
 * the app closed during approval. The sender's chain history decides. A transfer matching the pass is bound and
 * verified like a reported one. A pass with none expires once no block can include one anymore, which frees the
 * baton. Nothing here ever sends a transfer.
 */

/** Network path of a holder's own check, relative to /network. */
export const HANDOFF_CHECK_PATH = '/handoff/check'

/** What a chain lookup needs from an attempted pass, copied out of state before the lookup runs. */
export type AttemptedPass = Pick<NetworkHandoffIntent, 'id' | 'createdAt' | 'sender' | 'recipient' | 'value' | 'data' | 'network'> & { attemptedAt: number }

export type AttemptOutcome =
  /** The newest transfer matching the pass, with its lookup by hash for verification. */
  | { kind: 'sent'; txHash: string; lookup: TransactionLookup }
  /** No matching transfer, read from a node whose chain is past the last block that could include one. */
  | { kind: 'not-sent' }
  /** A transfer could still arrive, a lookup failed, or the history could not be read back to the pass. */
  | { kind: 'unknown' }

/** What the chain showed for one attempt, gathered outside the critical section. */
export interface AttemptEvidence {
  intentId: string
  /** The attempt the chain was read for. A later attempt makes the evidence stale. */
  attemptedAt: number
  outcome: AttemptOutcome
}

interface SenderHistory {
  /** Hash of the newest unused transfer matching the pass. */
  txHash: string | null
  /** Whether the history was read back to before the pass was prepared, or to its first transaction. */
  complete: boolean
}

/** The pass to look for on chain, when the intent reached Nimiq Pay and has no transaction hash bound. */
export function attemptedPass(intent: NetworkHandoffIntent): AttemptedPass | null {
  if (intent.state !== 'attempting' || intent.txHash !== null || intent.attemptedAt === null) return null
  const { id, createdAt, attemptedAt, sender, recipient, value, data, network } = intent
  return { id, createdAt, attemptedAt, sender, recipient, value, data, network }
}

/**
 * Looks for the pass's transfer in the sender's history. Runs outside the critical section and never throws: a failed
 * lookup is an unknown outcome, and an unknown outcome never ends a pass.
 */
export async function lookUpAttemptedPass(env: Env, pass: AttemptedPass, usedTx: Readonly<Record<string, string>>, now: number): Promise<AttemptEvidence> {
  const evidence = (outcome: AttemptOutcome): AttemptEvidence => ({ intentId: pass.id, attemptedAt: pass.attemptedAt, outcome })
  const client = new NimiqRpcClient({ rpcUrl: env.NIMIQ_RPC_URL })
  try {
    // Read before the history, so a history without the transfer covers every block up to this head.
    const head = now - pass.attemptedAt > UNSENT_PASS_EXPIRY_MS ? await client.getLatestBlock() : null
    const history = await searchSenderHistory(client, pass, usedTx)
    if (history.txHash) return evidence({ kind: 'sent', txHash: history.txHash, lookup: await lookupTransaction(env, history.txHash) })
    return evidence(head && provesNotSent(pass, head, history) ? { kind: 'not-sent' } : { kind: 'unknown' })
  } catch (error) {
    console.error('Attempted pass lookup failed', pass.id, error instanceof Error ? error.message : 'unknown')
    return evidence({ kind: 'unknown' })
  }
}

/**
 * Applies evidence to the pass it was gathered for, inside the critical section. A pass that moved on meanwhile, with
 * a newer attempt, a reported hash or a settled state, stays as it is. Returns whether the pass changed.
 */
export async function applyAttemptEvidence(context: NetworkContext, evidence: AttemptEvidence, persist: Persist): Promise<boolean> {
  const intent = context.state.intents[evidence.intentId]
  if (!intent || attemptedPass(intent)?.attemptedAt !== evidence.attemptedAt) return false
  const { outcome } = evidence
  switch (outcome.kind) {
    case 'unknown':
      return false
    case 'not-sent':
      expireUnsentPass(context.state, intent)
      return true
    case 'sent':
      bindTransaction(context, intent, outcome.txHash)
      await confirmHandoff(context, intent, persist, async () => outcome.lookup)
      return true
  }
}

/**
 * Paces chain lookups per attempted pass. It lives in memory only: after the object restarts, a pass may be looked up
 * once sooner than paced, which costs a request and changes nothing else.
 */
export class AttemptLookupPacer {
  private readonly lookedUpAt = new Map<string, number>()

  /** Up to `limit` passes not looked up within `interval`, never looked up first, then least recently; marked as looked up `now`. */
  take(passes: readonly AttemptedPass[], now: number, interval: number, limit: number): AttemptedPass[] {
    const lastLookup = (pass: AttemptedPass) => this.lookedUpAt.get(pass.id)
    const due = passes
      .filter(pass => {
        const at = lastLookup(pass)
        return at === undefined || now - at >= interval
      })
      .sort((a, b) => (lastLookup(a) ?? Number.MIN_SAFE_INTEGER) - (lastLookup(b) ?? Number.MIN_SAFE_INTEGER))
      .slice(0, limit)
    for (const pass of due) this.lookedUpAt.set(pass.id, now)
    return due
  }

  /** Forgets every pass not in `passes`. */
  retain(passes: readonly AttemptedPass[]): void {
    const open = new Set(passes.map(pass => pass.id))
    for (const id of this.lookedUpAt.keys()) if (!open.has(id)) this.lookedUpAt.delete(id)
  }
}

async function searchSenderHistory(client: NimiqRpcClient, pass: AttemptedPass, usedTx: Readonly<Record<string, string>>): Promise<SenderHistory> {
  let startAt: string | null = null
  for (let page = 0; page < SENDER_HISTORY_MAX_PAGES; page++) {
    const entries = await client.getTransactionsByAddress(pass.sender, SENDER_HISTORY_PAGE_SIZE, startAt)
    const match = entries.find(({ hash, transaction }) => transaction !== null && usedTx[hash] === undefined && isTransferFor(pass, transaction))
    if (match) return { txHash: match.hash, complete: true }
    const oldest = entries.at(-1)
    // A transfer for the pass carries the commitment it was prepared with, so no transaction before that can match.
    if (!oldest || entries.length < SENDER_HISTORY_PAGE_SIZE || oldest.timestamp < pass.createdAt - CHAIN_CLOCK_SKEW_MS) return { txHash: null, complete: true }
    startAt = oldest.hash
  }
  return { txHash: null, complete: false }
}

/** The exact transfer the pass locked: sender, recipient, value and relay data, executed on the pass's network. */
function isTransferFor(pass: AttemptedPass, transaction: NimiqTransaction): boolean {
  return (
    paymentAddress(transaction.sender) === paymentAddress(pass.sender) &&
    paymentAddress(transaction.recipient) === paymentAddress(pass.recipient) &&
    BigInt(transaction.value) === BigInt(pass.value) &&
    transaction.data === pass.data &&
    transaction.network === pass.network &&
    transaction.executionResult === true
  )
}

/**
 * No transfer for the pass can reach the chain anymore when the node's head, on the pass's network, is past the
 * deadline of one signed at the attempt, and the history read after that head reaches back to the pass without one.
 */
function provesNotSent(pass: AttemptedPass, head: ChainHead, history: SenderHistory): boolean {
  return history.complete && head.network === pass.network && head.timestamp - pass.attemptedAt > UNSENT_PASS_EXPIRY_MS
}

/** The pass ends and frees the baton, which never left its holder. */
function expireUnsentPass(state: NetworkState, intent: NetworkHandoffIntent): void {
  intent.state = 'expired'
  intent.failure = 'NOT_SENT'
  const baton = state.batons[intent.batonId]
  if (!baton || baton.holder.wallet !== intent.sender) return
  notify(state, baton.holder.id, { type: 'pass_not_sent', title: `Your pass to ${intent.recipientName} was not sent`, body: 'The baton is still with you.', batonId: baton.id })
}
