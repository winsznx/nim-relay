/**
 * PRD section 9.6 - independent backend verification of a baton-handoff
 * transaction. After a holder signs and broadcasts a NIM transfer through
 * native Nimiq Pay, the Worker looks the transaction up by hash via plain
 * JSON-RPC (see `nimiq-rpc.ts`, DECISIONS.md D-001) and confirms every field
 * matches the durable HandoffIntent it issued *before* the wallet prompt
 * opened. A handoff only becomes canonical after this check passes - the
 * Worker never trusts a client-reported "I sent it".
 *
 * This module is the pure decision function: given the looked-up transaction
 * and the expected intent parameters, decide accept/reject with a specific
 * reason. It performs no I/O.
 */

import { decodeTxData } from './tx-data'
import type { NimiqTransaction, NimiqNetwork } from './nimiq-rpc'

export type TxVerificationFailure =
  | 'SENDER_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'SELF_TRANSFER'
  | 'VALUE_MISMATCH'
  | 'DATA_MALFORMED'
  | 'DATA_RELAY_MISMATCH'
  | 'DATA_LEG_MISMATCH'
  | 'DATA_COMMITMENT_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'NOT_INCLUDED'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'EXECUTION_FAILED'

export interface ExpectedHandoffTransaction {
  senderWallet: string
  recipientWallet: string
  /** Baton amount in Luna. */
  valueLuna: bigint
  relayCode: string
  legNumber: number
  /** 128-bit base64url commitment from the issued intent (see tx-data.ts). */
  commitment: string
  network: NimiqNetwork
  minConfirmations: number
}

export type TxVerificationResult =
  | { ok: true; confirmations: number; blockNumber: number }
  | { ok: false; reason: TxVerificationFailure; detail: string }

/** Nimiq user-friendly addresses carry spaces and are case-insensitive; the
 * RPC and the wallet can disagree on formatting for the same address. */
function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

const NETWORK_RPC_ALIASES: Record<NimiqNetwork, readonly string[]> = {
  MainAlbatross: ['mainalbatross', 'main-albatross', 'main'],
  TestAlbatross: ['testalbatross', 'test-albatross', 'test'],
}

function networkMatches(expected: NimiqNetwork, reported: string | null): boolean {
  if (reported === null) return false
  return NETWORK_RPC_ALIASES[expected].includes(reported.trim().toLowerCase())
}

function fail(reason: TxVerificationFailure, detail: string): TxVerificationResult {
  return { ok: false, reason, detail }
}

export function verifyHandoffTransaction(
  tx: NimiqTransaction,
  expected: ExpectedHandoffTransaction,
): TxVerificationResult {
  const sender = normalizeAddress(tx.sender)
  const recipient = normalizeAddress(tx.recipient)
  const expectedSender = normalizeAddress(expected.senderWallet)
  const expectedRecipient = normalizeAddress(expected.recipientWallet)

  if (sender !== expectedSender) {
    return fail('SENDER_MISMATCH', `sender ${sender} != expected ${expectedSender}`)
  }
  if (recipient !== expectedRecipient) {
    return fail('RECIPIENT_MISMATCH', `recipient ${recipient} != expected ${expectedRecipient}`)
  }
  if (sender === recipient) {
    return fail('SELF_TRANSFER', 'sender and recipient are the same address (PRD 9.3.4 forbids self-pass)')
  }

  let value: bigint
  try {
    value = BigInt(tx.value)
  } catch {
    return fail('VALUE_MISMATCH', `unparseable value ${JSON.stringify(tx.value)}`)
  }
  if (value !== expected.valueLuna) {
    return fail('VALUE_MISMATCH', `value ${value} != expected ${expected.valueLuna}`)
  }

  const decoded = tx.data === null ? null : decodeTxData(tx.data)
  if (decoded === null) {
    return fail('DATA_MALFORMED', `tx data ${JSON.stringify(tx.data)} is not a valid NR1 commitment`)
  }
  if (decoded.relayCode !== expected.relayCode) {
    return fail('DATA_RELAY_MISMATCH', `relay code ${decoded.relayCode} != expected ${expected.relayCode}`)
  }
  if (decoded.legNumber !== expected.legNumber) {
    return fail('DATA_LEG_MISMATCH', `leg ${decoded.legNumber} != expected ${expected.legNumber}`)
  }
  if (decoded.commitment !== expected.commitment) {
    return fail(
      'DATA_COMMITMENT_MISMATCH',
      `commitment ${decoded.commitment} != expected ${expected.commitment}`,
    )
  }

  if (!networkMatches(expected.network, tx.network)) {
    return fail('NETWORK_MISMATCH', `network ${JSON.stringify(tx.network)} is not ${expected.network}`)
  }

  if (tx.blockNumber === null) {
    return fail('NOT_INCLUDED', 'transaction is not yet in a block')
  }
  if (tx.executionResult === false) {
    return fail('EXECUTION_FAILED', 'transaction was included but reverted')
  }
  const confirmations = tx.confirmations ?? 0
  if (confirmations < expected.minConfirmations) {
    return fail(
      'INSUFFICIENT_CONFIRMATIONS',
      `${confirmations} confirmations < required ${expected.minConfirmations}`,
    )
  }

  return { ok: true, confirmations, blockNumber: tx.blockNumber }
}
