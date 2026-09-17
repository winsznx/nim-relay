import type { TxVerificationFailure } from '@nim-relay/relay-protocol'
import type { HandoffPendingReason, HandoffReasonCode, HandoffRejectionReason } from '@nim-relay/shared'

const VERIFIER_REASONS: Record<TxVerificationFailure, HandoffPendingReason | HandoffRejectionReason> = {
  SENDER_MISMATCH: 'SENDER_MISMATCH',
  RECIPIENT_MISMATCH: 'RECIPIENT_MISMATCH',
  // Prepared intents never name the sender as recipient, so a self-transfer cannot pay the intended runner.
  SELF_TRANSFER: 'RECIPIENT_MISMATCH',
  VALUE_MISMATCH: 'VALUE_MISMATCH',
  DATA_MALFORMED: 'DATA_MALFORMED',
  DATA_RELAY_MISMATCH: 'DATA_RELAY_MISMATCH',
  DATA_LEG_MISMATCH: 'DATA_LEG_MISMATCH',
  DATA_COMMITMENT_MISMATCH: 'DATA_COMMITMENT_MISMATCH',
  NETWORK_MISMATCH: 'NETWORK_MISMATCH',
  NOT_INCLUDED: 'NOT_INCLUDED',
  INSUFFICIENT_CONFIRMATIONS: 'INSUFFICIENT_CONFIRMATIONS',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
}

const REASON_CODES: readonly HandoffReasonCode[] = [
  'NOT_INCLUDED',
  'INSUFFICIENT_CONFIRMATIONS',
  'SENDER_MISMATCH',
  'RECIPIENT_MISMATCH',
  'VALUE_MISMATCH',
  'DATA_MALFORMED',
  'DATA_RELAY_MISMATCH',
  'DATA_LEG_MISMATCH',
  'DATA_COMMITMENT_MISMATCH',
  'NETWORK_MISMATCH',
  'EXECUTION_FAILED',
  'DUPLICATE_TRANSACTION',
  'CUSTODY_CHANGED',
  'INTENT_EXPIRED',
  'RPC_UNAVAILABLE',
  'NOT_SENT',
]

export function verifierReason(failure: TxVerificationFailure): HandoffPendingReason | HandoffRejectionReason {
  return VERIFIER_REASONS[failure]
}

/** Transient outcomes: the same transaction may still verify later. */
export function isPendingReason(reason: HandoffReasonCode): reason is HandoffPendingReason {
  return reason === 'NOT_INCLUDED' || reason === 'INSUFFICIENT_CONFIRMATIONS' || reason === 'RPC_UNAVAILABLE'
}

export const REJECTION_REASONS: readonly HandoffRejectionReason[] = REASON_CODES.filter((code): code is HandoffRejectionReason => code !== 'NOT_SENT' && !isPendingReason(code))

/** Earlier releases stored free-form failure text; anything unrecognised was an unavailable lookup. */
export function storedReason(failure: string | null): HandoffReasonCode | null {
  if (failure === null) return null
  if (failure === 'SELF_TRANSFER') return 'RECIPIENT_MISMATCH'
  return REASON_CODES.find(code => code === failure) ?? 'RPC_UNAVAILABLE'
}
