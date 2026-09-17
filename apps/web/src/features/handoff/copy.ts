import { messageForCode } from '../shell/errors'
import type { ChooseNotice, HandoffStage, NoteRefusal, RouteNotice, VerificationFailure } from './machine'

export type CeremonySceneState = 'approach' | 'armed' | 'frozen' | 'launch'

/** How the 3D scene should hold the baton for each ceremony stage. */
export function sceneStateFor(stage: HandoffStage['stage']): CeremonySceneState {
  switch (stage) {
    case 'route':
    case 'choose':
    case 'note':
      return 'approach'
    case 'aiming':
    case 'armed':
    case 'paused':
    case 'insufficient':
    case 'not-verified':
    case 'failed':
      return 'armed'
    case 'preparing':
    case 'wallet':
    case 'checking':
    case 'recovery':
    case 'in-flight':
      return 'frozen'
    case 'confirmed':
      return 'launch'
  }
}

export function routeNoticeCopy(notice: RouteNotice): string {
  switch (notice) {
    case 'route-unavailable':
      return 'That route isn’t open from this station anymore. Choose another.'
  }
}

export function chooseNoticeCopy(notice: ChooseNotice): string {
  switch (notice) {
    case 'recipient-unavailable':
      return 'That runner can’t take this baton right now. Choose another runner.'
    case 'match-opponent-only':
      return 'In a match, the baton goes back to your opponent.'
    case 'crew-member-only':
      return 'A crew baton stays inside your crew.'
    case 'recipient-reserved':
      return 'This baton is reserved for the runner who accepted the invite.'
  }
}

export function noteRefusalCopy(refusal: NoteRefusal): string {
  return messageForCode(refusal)
}

export function verificationCopy(reason: VerificationFailure): string {
  switch (reason) {
    case 'SENDER_MISMATCH':
      return 'The transfer came from a different wallet than the current holder.'
    case 'RECIPIENT_MISMATCH':
      return 'The transfer went to a different wallet than the runner you chose.'
    case 'VALUE_MISMATCH':
      return 'The transfer amount doesn’t match this relay.'
    case 'DATA_MALFORMED':
    case 'DATA_RELAY_MISMATCH':
    case 'DATA_LEG_MISMATCH':
    case 'DATA_COMMITMENT_MISMATCH':
      return 'The transfer doesn’t carry this handoff’s relay signature.'
    case 'NETWORK_MISMATCH':
      return 'The transfer was sent on a different Nimiq network.'
    case 'EXECUTION_FAILED':
      return 'The Nimiq network did not execute this transfer.'
    case 'DUPLICATE_TRANSACTION':
      return 'That transaction already counts for another handoff.'
    case 'CUSTODY_CHANGED':
      return 'This baton moved on before your pass was confirmed.'
    case 'INTENT_EXPIRED':
      return 'This pass expired before it was sent. Throw again to start a new one.'
    case 'NOT_SENT':
      return 'This pass expired because no transfer for it reached the network in time. Throw again to start a new one.'
    case 'UNKNOWN':
      return 'The relay could not match this transfer to your pass.'
  }
}

export function failureCopy(code: string): string {
  switch (code) {
    case 'finish_your_relay_leg_first':
      return 'Finish this relay leg before passing the baton.'
    case 'only_current_holder_can_pass':
      return 'Only the current holder can pass this baton.'
    case 'relay_leg_changed':
      return 'This baton already moved to another leg.'
    case 'handoff_already_prepared':
      return 'A different pass is already locked for this baton. Open the journey to finish it.'
    case 'journey_completed':
      return 'This journey is complete.'
    case 'sign_in_to_join':
      return 'Your session ended. Sign in again to pass the baton.'
    case 'handoff_not_sendable':
      return 'This pass can no longer be sent. Check the journey for its status.'
    case 'check_wallet_before_rerouting':
      return 'This pass may already be in your wallet. Check your wallet activity before choosing another runner.'
    default:
      return 'The relay could not lock this pass. Your baton is still with you.'
  }
}

export function formatNim(luna: number): string {
  const nim = luna / 100000
  return Number.isInteger(nim) ? `${nim} NIM` : `${nim.toFixed(2)} NIM`
}
