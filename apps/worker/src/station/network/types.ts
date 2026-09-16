import type { AchievementId, BatonHandoff, BatonMode, NetworkBaton, NetworkHandoffIntent, NetworkInvite, NetworkNotification, NetworkRival, RelayArtifact, RelayEcho } from '@nim-relay/shared'
import type { Env } from '../../env'
import type { State } from '../model'

export interface Member {
  consent: boolean
  country: string | null
  firstSeen: number
  lastSeen: number
  days: string[]
  foreground: number
  lastHeartbeat: number
  /** Completed non-practice verified network runs; sets the tier of the legs this runner opens. */
  completedRuns: number
  /** Distinct baton legs finished with a verified run. */
  legs: number
  /** Highest relay leg counted per baton, so retrying a leg counts it once. */
  legMarks: Record<string, number>
}

export interface DailyEntry {
  runId: string
  score: number
  timeMs: number
  seed: string
  completed: boolean
}

/** Fastest completed verified run on a date's course, practice included. */
export interface DailyBest {
  seed: string
  timeMs: number
}

/** Stored baton. Values derived from the clock or from handoffs are added when presenting it. */
export type BatonRecord = Omit<NetworkBaton, 'appearance' | 'aliveMs' | 'transactingWallets' | 'stops'>

export interface RunnerAwards {
  unlocked: Partial<Record<AchievementId, number>>
  artifacts: RelayArtifact[]
}

export interface NetworkState {
  /** Monotonic write counter for clients and the archive, not a schema version. */
  version: number
  batons: Record<string, BatonRecord>
  handoffs: BatonHandoff[]
  intents: Record<string, NetworkHandoffIntent>
  notifications: Record<string, NetworkNotification[]>
  /** Keyed by SHA-256 of the invite token; the token itself is never stored. */
  invites: Record<string, NetworkInvite>
  rivals: NetworkRival[]
  members: Record<string, Member>
  /** date -> playerId -> official entry. */
  daily: Record<string, Record<string, DailyEntry>>
  /** `${date}:${playerId}` -> official run id. */
  dailyIssues: Record<string, string>
  /** `${date}:${playerId}` -> personal best on that date's course. */
  dailyBests: Record<string, DailyBest>
  /** Last UTC date whose Daily achievements were settled. */
  dailySettledThrough: string | null
  /** crewId -> date -> qualified crew handoffs. */
  crewDays: Record<string, Record<string, number>>
  serials: Partial<Record<BatonMode, number>>
  /** batonId -> echoes, latest per kind per sector. */
  echoes: Record<string, RelayEcho[]>
  /** playerId -> achievements and artifacts. */
  awards: Record<string, RunnerAwards>
  rematches: number
  /** Changes not yet archived to Supabase. */
  dirty: boolean
}

/** Public-traffic counters, stored apart from the network state so anonymous reads never rewrite it. */
export interface TrafficState {
  day: string
  chronicleViews: number
  inviteOpens: number
  shares: number
  /** Invite token hashes already counted on `day`. */
  openedInvites: string[]
  /** Shares counted on `day` per actor key, plus the `anonymous` total. */
  sharesToday: Record<string, number>
}

export interface NetworkContext {
  readonly storage: DurableObjectStorage
  readonly env: Env
  readonly product: State
  readonly state: NetworkState
  readonly traffic: TrafficState
}
