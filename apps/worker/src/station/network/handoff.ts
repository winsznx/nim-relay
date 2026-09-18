import { deriveCommitment, encodeTxData, NimiqRpcClient, paymentAddress, TransactionNotFoundError, verifyHandoffTransaction, type NimiqTransaction } from '@nim-relay/relay-protocol'
import { isFailedLeg, type AtlasLeg, type HandoffReasonCode, type HandoffRejectionReason, type NetworkConfirmation, type NetworkHandoffIntent, type RelayNote } from '@nim-relay/shared'
import { z } from 'zod'
import type { Env } from '../../env'
import { ApiError, type Profile } from '../model'
import { mac } from '../signing'
import { chooseNextRoute } from './atlas'
import { presentBaton } from './batons'
import { INTENT_PREPARED_TTL_MS, MIN_CONFIRMATIONS, RECONCILE_RETRY_MS, RESERVATION_ACCEPT_MS } from './constants'
import { applyVerifiedHandoff } from './custody'
import { assertHolder, findBaton, handoffsOf, loadRun, notify, openIntentFor } from './lookups'
import { moderateNote, relayNoteInput, sameNote } from './notes'
import { countHashSubmission, countRejection, noteRpcUnavailable } from './ops-ledger'
import { isPendingReason, verifierReason } from './reasons'
import { findCourier, sameWallet } from './runners'
import type { BatonRecord, NetworkContext, NetworkState } from './types'

const intentBody = z.object({ id: z.string().uuid() })
const prepareBody = z.object({
  runId: z.string(),
  recipient: z.string(),
  throw: z.object({ angle: z.number().int().min(15).max(75), power: z.number().int().min(30).max(100) }).default({ angle: 45, power: 75 }),
  note: relayNoteInput.nullable().optional(),
  routeId: z.string().max(120).optional(),
})
const confirmBody = z.object({ id: z.string().uuid(), txHash: z.string().regex(/^[a-f0-9]{64}$/i) })

/** Everything a handoff commitment binds. */
export interface HandoffTerms {
  id: string
  batonId: string
  leg: number
  runId: string
  from: string
  to: string
  throw: { angle: number; power: number }
  note: RelayNote | null
  /** Atlas route of the next leg. Null only for intents prepared before the Atlas, whose commitments never bound one. */
  route: AtlasLeg | null
}

/** Durably writes network and product state; confirmation binds the transaction hash through it before any lookup. */
export type Persist = () => Promise<void>

export type TransactionLookup = { found: true; transaction: NimiqTransaction } | { found: false; reason: 'NOT_INCLUDED' | 'RPC_UNAVAILABLE' }
/** Where confirmation reads the chain: live RPC for requests, lookups made ahead of the critical section for reconciliation. */
export type TransactionSource = (txHash: string) => Promise<TransactionLookup>

/**
 * Locks the pass of the holder's qualified leg to one recipient, note and next Atlas route. The moderated note and the
 * route are bound into the commitment but never into transaction data. Preparing again returns the open intent only for
 * the same run, recipient and note, and the same route when one is sent.
 */
export async function prepareHandoff(context: NetworkContext, profile: Profile, body: unknown): Promise<NetworkHandoffIntent> {
  const input = prepareBody.parse(body)
  const note = moderateNote(input.note)
  const run = await loadRun(context.storage, input.runId)
  const ownQualifiedLeg = run && run.issued.playerId === profile.id && !run.issued.practice && run.result.completed && !isFailedLeg(run.result)
  const batonId = ownQualifiedLeg ? run.issued.batonId : undefined
  if (!run || !batonId) throw new ApiError('finish_your_relay_leg_first', 409)
  const baton = findBaton(context.state, batonId)
  assertHolder(baton, profile)
  if (run.issued.relayLeg !== baton.handoffCount) throw new ApiError('relay_leg_changed', 409)
  const recipient = chooseRecipient(context, baton, profile, input.recipient)

  const open = openIntentFor(context.state, baton.id)
  if (open) {
    const sameRoute = input.routeId === undefined || open.route?.routeId === input.routeId
    if (open.runId !== input.runId || open.recipientId !== recipient.id || !sameNote(open.note, note) || !sameRoute) throw new ApiError('handoff_already_prepared', 409)
    return open
  }

  const id = crypto.randomUUID()
  const leg = baton.handoffCount + 1
  const route = chooseNextRoute(baton, leg, input.routeId)
  const commitment = await handoffCommitment(context.env.RUN_CHALLENGE_SECRET, { id, batonId: baton.id, leg, runId: input.runId, from: profile.id, to: recipient.id, throw: input.throw, note, route })
  const now = Date.now()
  const intent: NetworkHandoffIntent = {
    id,
    batonId: baton.id,
    runId: input.runId,
    recipientId: recipient.id,
    recipientName: recipient.name,
    sender: paymentAddress(profile.wallet),
    recipient: paymentAddress(recipient.wallet),
    value: baton.value,
    data: encodeTxData({ relayCode: baton.code, legNumber: leg, commitment }),
    network: baton.network,
    leg,
    status: 'pending',
    state: 'prepared',
    txHash: null,
    throw: input.throw,
    createdAt: now,
    expiresAt: now + INTENT_PREPARED_TTL_MS,
    attemptedAt: null,
    failure: null,
    note,
    route,
  }
  context.state.intents[id] = intent
  await context.storage.setAlarm(now + RECONCILE_RETRY_MS)
  return intent
}

/**
 * The 128-bit commitment carried in transfer data: a MAC over every term of the intent, so the chain transfer commits
 * to the recipient, run, note and next route without revealing any of them. Intents prepared before the Atlas have no
 * route and keep the commitment they were prepared with.
 */
export async function handoffCommitment(secret: string, terms: HandoffTerms): Promise<string> {
  const { id, batonId, leg, runId, from, to, throw: launch, note, route } = terms
  return deriveCommitment(await mac(secret, { id, batonId, leg, runId, from, to, throw: launch, note, ...(route ? { route } : {}) }))
}

function chooseRecipient(context: NetworkContext, baton: BatonRecord, sender: Profile, idOrHandle: string): Profile {
  const recipient = findCourier(context.product, idOrHandle)
  if (!recipient) throw new ApiError('recipient_unavailable', 404)
  if (sameWallet(recipient, sender)) throw new ApiError('choose_another_courier')
  if (baton.quick && !quickRecipientAllowed(baton, recipient.id)) throw new ApiError('pass_to_match_opponent')
  if (baton.crewId && !context.product.crews.find(crew => crew.id === baton.crewId)?.members.includes(recipient.id)) throw new ApiError('choose_a_crew_member')
  if (baton.recipientId && baton.recipientId !== recipient.id) throw new ApiError('recipient_unavailable', 409)
  return recipient
}

/** Match players only, except that an opening pass may seat a new opponent once the first one's reservation lapsed. */
function quickRecipientAllowed(baton: BatonRecord, recipientId: string): boolean {
  if (baton.quick?.players.includes(recipientId)) return true
  return baton.handoffCount === 0 && (baton.recipientId === null || baton.recipientId === recipientId)
}

/**
 * Every attempt opens Nimiq Pay again, so it moves `attemptedAt`: a transfer approved now stays includable for its
 * whole validity window, and an attempted pass only expires once that window has passed.
 */
export async function attemptHandoff(context: NetworkContext, profile: Profile, body: unknown): Promise<NetworkHandoffIntent> {
  const intent = ownIntentFor(context.state, body, profile.wallet)
  const now = Date.now()
  if (intent.state !== 'prepared' && intent.state !== 'attempting') throw new ApiError('handoff_not_sendable', 409)
  if (intent.state === 'prepared' && intent.expiresAt < now) throw new ApiError('handoff_expired', 410)
  if (intent.state === 'prepared') {
    intent.state = 'attempting'
  } else if (intent.state !== 'attempting') {
    throw new ApiError('handoff_not_sendable', 409)
  }
  intent.attemptedAt = now
  await context.storage.setAlarm(now + RECONCILE_RETRY_MS)
  return intent
}

/** Only before the wallet opened: afterwards a transfer may exist and must be recovered, not rerouted. */
export function cancelHandoff(context: NetworkContext, profile: Profile, body: unknown): NetworkHandoffIntent {
  const intent = ownIntentFor(context.state, body, profile.wallet)
  if (intent.state !== 'prepared') throw new ApiError('check_wallet_before_rerouting', 409)
  intent.state = 'cancelled'
  return intent
}

export async function submitHandoffTransaction(context: NetworkContext, profile: Profile, body: unknown, persist: Persist): Promise<NetworkConfirmation> {
  const input = confirmBody.parse(body)
  const txHash = input.txHash.toLowerCase()
  const intent = ownIntent(context.state, input.id, profile.wallet)
  if (intent.txHash && intent.txHash !== txHash) throw new ApiError('different_transaction', 409)
  // Confirming the hash already bound is a re-check; operators count only newly sent hashes.
  const newHash = intent.txHash === null
  if (intent.state === 'expired' || intent.state === 'cancelled') {
    if (newHash) countRejectedSubmission(context, 'INTENT_EXPIRED')
    return { status: 'rejected', reason: intent.failure ?? 'INTENT_EXPIRED', intent }
  }
  if (intent.state === 'prepared') throw new ApiError('handoff_not_attempted', 409)
  bindTransaction(context, intent, txHash)
  await persist()
  return confirmHandoff(context, intent, persist, hash => lookupTransaction(context.env, hash))
}

/** Binds the transaction a pass was sent with; operators count each newly bound hash as submitted. */
export function bindTransaction(context: NetworkContext, intent: NetworkHandoffIntent, txHash: string): void {
  if (intent.txHash === null) countHashSubmission(context.ops, Date.now())
  intent.txHash = txHash
  if (intent.state !== 'verified') intent.state = 'submitted'
}

/**
 * Independently verifies the bound transaction against the immutable intent. Rejected transactions release the
 * binding so the hash of the correct transfer can still verify; the intent itself never changes recipient, value or data.
 */
export async function confirmHandoff(context: NetworkContext, intent: NetworkHandoffIntent, persist: Persist, transactions: TransactionSource): Promise<NetworkConfirmation> {
  const baton = findBaton(context.state, intent.batonId)
  if (intent.state === 'verified') return verified(context, intent, baton)
  if (intent.state === 'expired' || intent.state === 'cancelled') return { status: 'rejected', reason: intent.failure ?? 'INTENT_EXPIRED', intent }
  if (!intent.txHash) return { status: 'pending', reason: 'NOT_INCLUDED', intent }
  const txHash = intent.txHash

  const usedBy = context.product.usedTx[txHash]
  if (usedBy && usedBy !== intent.id) return reject(context, intent, 'DUPLICATE_TRANSACTION')
  if (baton.handoffCount + 1 !== intent.leg || baton.holder.wallet !== intent.sender) {
    intent.state = 'expired'
    intent.failure = 'CUSTODY_CHANGED'
    countRejection(context.ops, 'CUSTODY_CHANGED', Date.now())
    return { status: 'rejected', reason: 'CUSTODY_CHANGED', intent }
  }

  const lookup = await transactions(txHash)
  if (!lookup.found) return waitForNetwork(context, intent, lookup.reason)
  // Nimiq Pay pays from an internal address, never the one the holder signed in with. The commitment in the data was
  // issued only to the holder's session and binds this exact pass, so any payer that sends it to the chosen runner counts.
  const proof = verifyHandoffTransaction(lookup.transaction, {
    senderWallet: null,
    recipientWallet: intent.recipient,
    valueLuna: BigInt(intent.value),
    relayCode: baton.code,
    legNumber: intent.leg,
    commitment: intent.data.split('.')[3]!,
    network: baton.network,
    minConfirmations: MIN_CONFIRMATIONS,
  })
  if (!proof.ok) {
    const reason = verifierReason(proof.reason)
    return isPendingReason(reason) ? waitForNetwork(context, intent, reason) : reject(context, intent, reason)
  }

  const run = await loadRun(context.storage, intent.runId)
  if (!run?.result.completed) {
    console.error('Canonical relay run unavailable for verified transfer', intent.id)
    return waitForNetwork(context, intent, 'RPC_UNAVAILABLE')
  }
  await applyVerifiedHandoff(context, { intent, txHash, baton, run, confirmations: proof.confirmations, blockNumber: proof.blockNumber })
  await persist()
  return verified(context, intent, baton)
}

function verified(context: NetworkContext, intent: NetworkHandoffIntent, baton: BatonRecord): NetworkConfirmation {
  return { status: 'verified', intent, baton: presentBaton(baton, handoffsOf(context.state, baton.id), Date.now()) }
}

async function waitForNetwork(context: NetworkContext, intent: NetworkHandoffIntent, reason: HandoffReasonCode): Promise<NetworkConfirmation> {
  intent.failure = reason
  if (reason === 'RPC_UNAVAILABLE') noteRpcUnavailable(context.ops, Date.now())
  await context.storage.setAlarm(Date.now() + RECONCILE_RETRY_MS)
  return { status: 'pending', reason, intent }
}

/** The bound hash can never verify this intent: free the binding and wait for the hash of the correct transfer. */
function reject(context: NetworkContext, intent: NetworkHandoffIntent, reason: HandoffRejectionReason): NetworkConfirmation {
  intent.failure = reason
  intent.txHash = null
  intent.state = 'attempting'
  countRejection(context.ops, reason, Date.now())
  return { status: 'rejected', reason, intent }
}

/** A hash sent for an intent that can no longer be sent: counted as submitted and rejected at once. */
function countRejectedSubmission(context: NetworkContext, reason: HandoffRejectionReason): void {
  const now = Date.now()
  countHashSubmission(context.ops, now)
  countRejection(context.ops, reason, now)
}

/** Chain lookup by hash. Never throws: an unknown hash is not yet included, any other failure is an unavailable RPC. */
export async function lookupTransaction(env: Env, txHash: string): Promise<TransactionLookup> {
  try {
    const transaction = await new NimiqRpcClient({ rpcUrl: env.NIMIQ_RPC_URL }).getTransactionByHash(txHash)
    if (transaction.hash.toLowerCase() !== txHash) return { found: false, reason: 'RPC_UNAVAILABLE' }
    return { found: true, transaction }
  } catch (error) {
    if (error instanceof TransactionNotFoundError) return { found: false, reason: 'NOT_INCLUDED' }
    console.error('Handoff transaction lookup failed', error instanceof Error ? error.message : 'unknown')
    return { found: false, reason: 'RPC_UNAVAILABLE' }
  }
}

/** A holder who lets the hold window pass with no transfer underway leaves the baton stranded until they return. */
export function strandIdleBaton(state: NetworkState, baton: BatonRecord, now: number): void {
  if (baton.status === 'active' && baton.expiresAt < now && !openIntentFor(state, baton.id)) baton.status = 'stranded'
}

/** Quick and Global reservations wait for the reserved runner to accept; other modes keep their reservation. */
export function awaitsAcceptance(baton: BatonRecord): boolean {
  if (baton.mode !== 'quick' && baton.mode !== 'global') return false
  return baton.status !== 'completed' && baton.recipientId !== null && baton.recipientAcceptedAt === null
}

/** Frees the holder to choose another runner once a reservation has gone unaccepted for RESERVATION_ACCEPT_MS. */
export function releaseLapsedReservation(context: NetworkContext, baton: BatonRecord, now: number): void {
  const { recipientId, recipientReservedAt } = baton
  if (!awaitsAcceptance(baton) || recipientId === null || recipientReservedAt === null) return
  if (now - recipientReservedAt < RESERVATION_ACCEPT_MS || openIntentFor(context.state, baton.id)) return
  baton.recipientId = null
  baton.recipientReservedAt = null
  const runnerName = context.product.players[recipientId]?.name ?? 'Your runner'
  notify(context.state, baton.holder.id, {
    type: 'recipient_timeout',
    title: 'Choose another runner',
    body: `${runnerName} did not accept ${baton.displayName} within 24 hours.`,
    batonId: baton.id,
  })
}

/** Only the sender may act on an intent; anyone else is told it does not exist. */
export function ownIntent(state: NetworkState, id: string, wallet: string): NetworkHandoffIntent {
  const intent = state.intents[id]
  if (!intent || intent.sender !== paymentAddress(wallet)) throw new ApiError('handoff_not_found', 404)
  return intent
}

/** The intent named by an `{ id }` request body, for its sender only. */
export function ownIntentFor(state: NetworkState, body: unknown, wallet: string): NetworkHandoffIntent {
  return ownIntent(state, intentBody.parse(body).id, wallet)
}
