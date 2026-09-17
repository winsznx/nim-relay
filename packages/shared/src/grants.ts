import type { RelayNetwork } from './network'

/**
 * Relay Grants: small, capped NIM payouts from a promotional treasury wallet for reaching early milestones. The server
 * decides everything a grant pays: recipient, amount and eligibility. A client only names the milestone.
 */

export const GRANT_MILESTONE_IDS = ['starter', 'first_handoff', 'atlas_explorer', 'return_handoff', 'social'] as const
export type GrantMilestoneId = (typeof GRANT_MILESTONE_IDS)[number]

export interface GrantClaimInput {
  grantId: GrantMilestoneId
}

/**
 * locked: the requirement is not met yet, or something else blocks the claim (see `blocked`).
 * available: claimable now. pending: sent or being sent. confirmed: on chain with enough confirmations.
 * failed: the transfer never landed; the reservation was released and the claim may be retried.
 */
export type GrantState = 'locked' | 'available' | 'pending' | 'confirmed' | 'failed'

/** Why a claim cannot go ahead. Also the error code a refused claim answers with. */
export type GrantRefusal =
  | 'grants_disabled'
  | 'grants_paused'
  | 'requirement_not_met'
  | 'wallet_already_funded'
  | 'wallet_balance_unknown'
  | 'no_device_signal'
  | 'wallet_already_claimed'
  | 'device_already_claimed'
  | 'participant_cap_reached'
  | 'daily_cap_reached'
  | 'global_cap_reached'
  | 'treasury_exhausted'
  | 'treasury_unavailable'
  | 'too_many_grant_claims'

/** pending grants only: `signed` before the node accepted it, `confirming` once broadcast. */
export type GrantPhase = 'signed' | 'confirming'

export interface GrantMilestoneView {
  id: GrantMilestoneId
  title: string
  /** One line: what unlocks it. */
  requirement: string
  luna: number
  state: GrantState
  blocked: GrantRefusal | null
  phase: GrantPhase | null
  txHash: string | null
  confirmations: number | null
  /** The starter baton a confirmed starter grant created. */
  batonCode: string | null
  updatedAt: number | null
}

export interface GrantsView {
  network: RelayNetwork
  enabled: boolean
  paused: boolean
  /** Whether this session carries a device signal; claims need one. */
  deviceSignal: boolean
  /** Confirmed and pending grants, charged against the cap. */
  claimedLuna: number
  confirmedLuna: number
  capLuna: number
  treasuryAddress: string | null
  milestones: GrantMilestoneView[]
}

export interface GrantClaimResult {
  milestone: GrantMilestoneView
  grants: GrantsView
}

/** Public treasury status. Holds no addresses of players and no device data. */
export interface GrantsSummary {
  network: RelayNetwork
  enabled: boolean
  paused: boolean
  /** Grants to players, controlled and operator wallets excluded. */
  grants: number
  confirmed: number
  grantedLuna: number
  /** Today's remaining headroom, coarsely. */
  headroom: 'open' | 'low' | 'exhausted'
  lowBalance: boolean
}

export type GrantAbuseReason = Extract<GrantRefusal, 'no_device_signal' | 'wallet_already_claimed' | 'device_already_claimed' | 'participant_cap_reached' | 'too_many_grant_claims'> | 'chain_mismatch'

/** Refused or suspicious claims, with wallet and device shown only as short one-way hashes. */
export interface GrantAbuseEntry {
  at: number
  reason: GrantAbuseReason
  milestone: GrantMilestoneId
  walletRef: string
  deviceRef: string | null
}

export interface GrantOpsRecord {
  milestone: GrantMilestoneId
  handle: string
  controlled: boolean
  state: 'prepared' | 'broadcast' | 'confirmed' | 'failed'
  luna: number
  txHash: string
  failure: string | null
  at: number
}

export interface GrantsOpsReport {
  network: RelayNetwork
  /** TREASURY_ENABLED and a usable key and caps. */
  configured: boolean
  configProblem: string | null
  enabled: boolean
  paused: boolean
  pausedAt: number | null
  pausedBy: string | null
  treasuryAddress: string | null
  balanceLuna: number | null
  balanceAt: number | null
  lowBalance: boolean
  caps: { transactionLuna: number; participantLuna: number; dailyLuna: number; globalLuna: number; lowBalanceLuna: number }
  amounts: Record<GrantMilestoneId, number>
  spent: { todayLuna: number; globalLuna: number }
  counts: { prepared: number; broadcast: number; confirmed: number; failed: number }
  /** Kept apart on purpose: treasury transfers are never relay handoffs. */
  separation: {
    treasuryGrantTransactions: number
    controlledGrantTransactions: number
    qualifiedRelayHandoffs: number
    transactingWallets: number
    linkedWallets: number
    controlledWallets: number
  }
  recent: GrantOpsRecord[]
  abuse: GrantAbuseEntry[]
}

export interface GrantsPauseInput {
  paused: boolean
}
