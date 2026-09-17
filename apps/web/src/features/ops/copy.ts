import type { HandoffRejectionReason, OpsFlagReason, ShareSurface } from '@nim-relay/shared'

/** What each operator metric counts, in one line an operator can check against the Worker's records. */
export const DEFINITIONS = {
  linkedWallets: 'Wallets that signed in and joined the relay network. A wallet is not proof of a unique person.',
  transactingWallets: 'Distinct wallets that sent or received a qualified handoff.',
  returningWallets: 'Linked wallets active on more than one UTC day.',
  qualifiedHandoffs: 'Transfers verified on chain and backed by a completed race the server replayed.',
  batons: 'Batons by status now. Stranded means the holder let the 24-hour hold pass with no transfer underway.',
  crews: 'Crews created on this Worker.',
  rivals: 'Rivalries started, each racing two team batons.',
  invites: 'Links created by holders, links opened (once per link per UTC day) and invites a runner accepted.',
  shares: 'Share actions the app reported, capped per runner or device per UTC day. Delivery is not verified.',
  chronicleViews: 'Public Chronicle loads, not unique visitors.',
  foregroundSeconds: 'Bounded, server-observed foreground heartbeats from signed-in runners.',
  evidence: 'Testnet handoffs are test evidence and never count as mainnet usage.',

  newWallets: 'Linked wallets whose first runner joined the network that UTC day.',
  activeWallets: 'Linked wallets with a signed-in network visit that UTC day.',
  dailyHandoffs: 'Qualified handoffs verified that UTC day.',
  dailyAttempts: 'Official Daily entries recorded for that UTC day.',
  runs: 'Signed relay-network race submissions, practice included: verified, rejected for an invalid trace or MAC mismatch, or refused because the ticket expired or the leg moved on.',
  dailyShares: 'Shares counted that UTC day.',

  prepared: 'Handoff intents prepared on these days.',
  attempted: 'Intents the app sent to Nimiq Pay for approval.',
  submitted: 'Intents that received a transaction hash at least once.',
  verified: 'Intents whose transfer verified on chain.',
  outcomes: 'Where the other intents stand now. Expired includes passes never sent in time and passes whose baton changed hands first.',
  medianAttemptToVerified: 'Median time from sending to Nimiq Pay to verification, over the verified intents above.',
  rejections: 'Transaction hashes that can never verify their intent, by reason, recorded on these days.',

  flaggedRuns: 'Submissions rejected for an invalid input trace or a ticket (MAC) mismatch. Resubmissions of the same run are folded together.',
  nimFlow: 'Value moved by qualified handoffs, summed in Luna per network.',

  onboarding: 'Tour events the app reported, capped per runner or device per UTC day. Replays never count as starts. Step views are a share of tours started; going back views a step again.',
} as const

/** Names for the guided tours the app ships; any other tour shows its id. */
export const TOUR_LABELS: Partial<Record<string, string>> = {
  core: 'Product tour',
  gameplay: 'Gameplay tutorial',
}

export const REJECTION_LABELS: Record<HandoffRejectionReason, string> = {
  SENDER_MISMATCH: 'Sent from another wallet',
  RECIPIENT_MISMATCH: 'Paid a different wallet',
  VALUE_MISMATCH: 'Wrong amount',
  DATA_MALFORMED: 'Relay data unreadable',
  DATA_RELAY_MISMATCH: 'Data names another relay',
  DATA_LEG_MISMATCH: 'Data names another leg',
  DATA_COMMITMENT_MISMATCH: 'Data commits to another pass',
  NETWORK_MISMATCH: 'Sent on the other Nimiq network',
  EXECUTION_FAILED: 'Failed on chain',
  DUPLICATE_TRANSACTION: 'Already used by another handoff',
  CUSTODY_CHANGED: 'Baton changed hands first',
  INTENT_EXPIRED: 'Pass had expired or was cancelled',
}

export const FLAG_LABELS: Record<OpsFlagReason, string> = {
  INVALID_TRACE: 'Invalid trace',
  MAC_MISMATCH: 'MAC mismatch',
}

export const SURFACE_LABELS: Record<ShareSurface, string> = {
  result: 'Results',
  handoff: 'Handoffs',
  chronicle: 'Chronicles',
  daily: 'Daily',
  crew: 'Crew',
}
