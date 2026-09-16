import type { HandoffReasonCode } from '@nim-relay/shared'
import { NimiqPayError } from '../../lib/nimiq'

/**
 * Every refusal the relay server or Nimiq Pay can return, in the words a player
 * needs to decide what to do next. Codes come from apps/worker (ApiError and
 * route-level `{ error }` responses).
 */
const API_COPY: Record<string, string> = {
  already_in_a_crew: 'You’re already in a crew. A runner can belong to one crew at a time.',
  bad_challenge: 'This sign-in request was incomplete. Sign in again.',
  bad_mac: 'This leg’s ticket didn’t match the server’s copy. Start the leg again.',
  bad_request: 'The relay couldn’t accept those details. Check what you entered and try again.',
  bad_session: 'Your session ended. Sign in again to continue.',
  bad_signature: 'The signature from Nimiq Pay didn’t match this account. Sign in again.',
  baton_not_ready: 'Finish a qualifying leg before passing this baton.',
  challenge_not_found: 'That challenge is no longer available.',
  check_wallet_before_rerouting: 'This pass may already be in Nimiq Pay. Check your wallet activity before choosing another runner.',
  choose_a_crew_member: 'A crew baton can only go to someone in your crew.',
  choose_a_verified_ghost: 'Pick a verified ride to race against.',
  choose_another_courier: 'Choose a different runner. The baton can’t go back to your own wallet.',
  choose_your_opponent: 'Choose who you’re playing against.',
  cosmetic_locked: 'Earn more XP to unlock this item.',
  courier_not_found: 'No runner uses that handle yet. Check the spelling or send them an invite link.',
  crew_is_full: 'That crew already has five runners.',
  crew_not_found: 'No crew uses that code. Check it with your crew.',
  custody_changed: 'This baton changed hands before your pass was confirmed.',
  different_transaction: 'That transaction belongs to a different pass. Use the reference from this pass.',
  expired: 'This ride’s time window closed. Start the leg again.',
  finish_a_verified_run_first: 'Finish a verified ride first.',
  finish_an_active_journey_first: 'You already have 10 active journeys. Pass or finish one before starting another.',
  finish_match_first: 'Finish this match before starting a rematch.',
  finish_your_relay_leg_first: 'Finish this relay leg before passing the baton.',
  handoff_already_prepared: 'A pass is already locked for this baton. Finish or check that pass first.',
  handoff_expired: 'This pass expired before it was sent. Start a new pass.',
  handoff_not_attempted: 'Approve this pass in Nimiq Pay before checking its confirmation.',
  handoff_not_found: 'That pass isn’t on your account.',
  handoff_not_sendable: 'This pass can no longer be sent. Open the journey to see where the baton is.',
  invalid_trace: 'This ride couldn’t be verified, so it wasn’t saved. Ride the leg again.',
  invite_already_claimed: 'Another runner already accepted this invite.',
  invite_expired: 'This invite has expired. Ask the holder for a new link.',
  invite_is_for_another_courier: 'This invite is meant for a different runner.',
  invite_no_longer_current: 'The baton moved on after this invite was sent.',
  invite_not_found: 'This invite link doesn’t exist. Check that you copied the whole link.',
  join_a_crew_first: 'Join a crew before starting a crew baton.',
  journey_completed: 'This journey is complete.',
  journey_not_found: 'No relay uses that code. Check the link you followed.',
  match_not_found: 'That match isn’t on your account.',
  no_player: 'Your runner profile wasn’t found. Sign in again.',
  no_session: 'Sign in with Nimiq Pay to continue.',
  nonce_expired: 'The sign-in request timed out. Sign in again.',
  not_found: 'The relay server doesn’t offer this yet.',
  not_official_daily: 'That ride wasn’t your official Daily attempt.',
  not_reserved_for_you: 'This baton isn’t reserved for you anymore. Ask the holder to pass it to you again.',
  official_daily_already_started: 'You’ve used today’s official Daily attempt. Practice is still open.',
  only_current_holder_can_pass: 'Only the current holder can carry this leg.',
  origin_mismatch: 'Open NIM Relay from its official link to do this.',
  pass_to_match_opponent: 'In a match, the baton goes to your opponent.',
  recipient_reserved: 'This baton is reserved for the runner who accepted the invite.',
  recipient_unavailable: 'That runner can’t take this baton right now. Choose another runner.',
  relay_leg_changed: 'This baton already moved to another leg.',
  request_failed: 'The relay server sent an unreadable answer. Try again.',
  request_too_large: 'That request was too large to send.',
  route_is_fixed: 'Daily and Global routes are fixed. Everyone rides the same line.',
  run_expired: 'This leg’s ticket expired. Start the leg again to save a ride.',
  run_not_found: 'That ride isn’t on your account. Start the leg again.',
  runner_not_found: 'No runner uses that handle. Check the spelling, or send them an invite link.',
  selected_ghost_is_practice_only: 'Historic ghosts are for practice rides.',
  session_expired: 'Your session ended. Sign in again to continue.',
  sign_in_to_join: 'Sign in with Nimiq Pay to take part.',
  stale_rules: 'The game rules were updated. Reload to ride with the latest version.',
  station_unavailable: 'The relay server is busy. Your wallet and journeys are unchanged. Try again in a moment.',
  too_many_active_invites: 'You have 20 open invites. Wait for one to be used or to expire.',
  transaction_already_used: 'That transaction already counts for another handoff.',
  unknown_nonce: 'The sign-in request expired. Sign in again.',
  verified_replay_not_found: 'That verified ride isn’t available to watch.',
}

const UNKNOWN_REFUSAL = 'The relay server turned this request down. Check the journey for its current state, then try again.'

export function messageForCode(code: string): string {
  return API_COPY[code] ?? UNKNOWN_REFUSAL
}

/** The server's machine code for an API refusal, if the error carries one. */
export function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  // lib/auth-api throws plain Errors whose message is the server code.
  if (error instanceof Error && /^[a-z]+(?:_[a-z]+)*$/.test(error.message)) return error.message
  return null
}

const CONFIRMATION_COPY: Record<HandoffReasonCode, string> = {
  NOT_INCLUDED: 'Your pass is on its way. The Nimiq network hasn’t included it in a block yet.',
  INSUFFICIENT_CONFIRMATIONS: 'Your pass is in a block. It counts once the network confirms it again.',
  RPC_UNAVAILABLE: 'The relay can’t reach a Nimiq node right now. Your pass is safe. Check again shortly.',
  SENDER_MISMATCH: 'That transaction came from a different wallet than the current holder’s.',
  RECIPIENT_MISMATCH: 'That transaction went to a different wallet than the chosen runner’s.',
  VALUE_MISMATCH: 'That transaction’s amount doesn’t match this relay.',
  DATA_MALFORMED: 'That transaction doesn’t carry this pass’s relay signature.',
  DATA_RELAY_MISMATCH: 'That transaction belongs to a different relay.',
  DATA_LEG_MISMATCH: 'That transaction belongs to a different leg of this relay.',
  DATA_COMMITMENT_MISMATCH: 'That transaction doesn’t carry this pass’s relay signature.',
  NETWORK_MISMATCH: 'That transaction was sent on a different Nimiq network.',
  EXECUTION_FAILED: 'The Nimiq network did not execute that transaction.',
  DUPLICATE_TRANSACTION: 'That transaction already counts for another handoff.',
  CUSTODY_CHANGED: 'This baton changed hands before your pass was confirmed.',
  INTENT_EXPIRED: 'This pass expired before it was sent. Start a new pass.',
}

/** Copy for the verifier's reason when a submitted pass is still pending or was rejected. */
export function confirmationMessage(reason: HandoffReasonCode | undefined, status: 'pending' | 'rejected'): string {
  if (reason && reason in CONFIRMATION_COPY) return CONFIRMATION_COPY[reason]
  return status === 'pending' ? 'Waiting for the Nimiq network to confirm your pass. Check again shortly.' : 'The relay couldn’t match that transaction to your pass. Check the reference in your wallet activity.'
}

function walletMessage(error: NimiqPayError): string {
  const detail = `${error.type} ${error.message}`
  if (/insufficient|balance|funds/i.test(detail)) return 'Your wallet doesn’t have enough NIM for this pass and its network fee.'
  if (error.approvalDeclined) return 'You declined in Nimiq Pay. Nothing was sent.'
  if (/timeout|timed out/i.test(detail)) return 'Nimiq Pay didn’t answer in time. Check your wallet activity before trying again.'
  if (/network|broadcast|connect/i.test(detail)) return 'Nimiq Pay couldn’t reach the Nimiq network. Check your wallet activity before trying again.'
  return 'Nimiq Pay stopped this request. Check your wallet activity, then try again.'
}

/**
 * Player-facing copy for any thrown value. Returns null when the player cancelled
 * something themselves (for example the share sheet) and nothing should be shown.
 */
export function playerMessage(error: unknown): string | null {
  if (error instanceof DOMException && error.name === 'AbortError') return null
  if (error instanceof NimiqPayError) return walletMessage(error)
  const code = errorCode(error)
  if (code) return messageForCode(code)
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return 'You’re offline or the relay server can’t be reached. Check your connection and try again.'
  }
  if (error instanceof Error) {
    if (/provider was not injected|inside a Nimiq app/i.test(error.message)) return 'Open NIM Relay inside Nimiq Pay to use your wallet.'
    if (/No Nimiq account/i.test(error.message)) return 'Add an account in Nimiq Pay, then try again.'
    if (/^request failed \(\d+\)$/.test(error.message)) return messageForCode('request_failed')
    // Local failures (storage, share export) are already written as player guidance.
    return error.message
  }
  return UNKNOWN_REFUSAL
}
