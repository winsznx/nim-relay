import type { CanonicalGhost, HandoffIntent, RaceMode, RelayEcho, RelayLegTier, StationWorld } from './station'

export type RelayNetwork = 'TestAlbatross' | 'MainAlbatross'
export type BatonMode = Exclude<RaceMode, 'daily'>

export interface NetworkRunner { id: string; handle: string; name: string; wallet: string; country: string | null; countrySource: 'network_observed' | null }
/** Public runner identity without wallet or location. */
export interface RunnerRef { id: string; handle: string; name: string }

/** Verified race facts of the canonical run behind a handoff. Null for handoffs recorded before these facts were kept. */
export interface HandoffRace {
  engineVersion: '4' | '5'
  world: StationWorld
  timeMs: number
  score: number
  completed: boolean
  ghostRunId: string | null
  ghostTimeMs: number | null
  /** Whether the run outscored the ghost it raced; null when it raced no ghost. */
  beatGhost: boolean | null
}
export interface BatonHandoff {
  id: string
  batonId: string
  leg: number
  from: NetworkRunner
  to: NetworkRunner
  value: number
  txHash: string
  network: RelayNetwork
  at: number
  runId: string
  resultHash: string
  qualified: boolean
  confirmations: number
  blockNumber: number
  /** Route sector the canonical run was raced on; null for handoffs recorded before sectors. */
  sector: number | null
  race: HandoffRace | null
  /** The handoff moved a stranded baton. */
  rescue: boolean
}

/**
 * Every leg of a sector races the same seed, world and tier, so each runner meets the previous runner's
 * verified ghost. A new sector starts every 10 qualified handoffs; Quick matches keep one sector.
 */
export interface BatonRoute { seed: string; world: StationWorld; tier: RelayLegTier; sector: number; sectorStartedLeg: number }
/** Verified history the baton's look is derived from. `countries` counts consented network-observed countries. */
export interface BatonAppearance { handoffCount: number; ageMs: number; countries: number; ghostWins: number; milestones: number[] }
export interface BatonStop { countryCode: string | null }

export interface NetworkBaton {
  id: string
  code: string
  /** Increments per network per mode: Global Relay #1, Quick Relay #1, ... */
  serial: number
  title: string
  /** The runner-chosen title, or e.g. "Global Relay #001" when none was given. */
  displayName: string
  mode: BatonMode
  network: RelayNetwork
  value: number
  origin: NetworkRunner
  holder: NetworkRunner
  createdAt: number
  updatedAt: number
  completedAt: number | null
  status: 'active' | 'completed' | 'stranded'
  handoffCount: number
  world: StationWorld
  route: BatonRoute
  previousRunId: string | null
  crewId: string | null
  rivalId: string | null
  /** Runner the next pass is reserved for. */
  recipientId: string | null
  recipientReservedAt: number | null
  /** Null until the reserved runner accepts. Quick and Global reservations release 24h after reservation without it. */
  recipientAcceptedAt: number | null
  expiresAt: number
  lineage: { countries: string[]; runners: number; ghostWins: number }
  quick: { players: string[]; bestOf: 3 | 5; scores: Record<string, number>; rounds: number; winnerId: string | null; rematchOf: string | null } | null
  appearance: BatonAppearance
  /** Creation to completion, or to now while the baton is still in play. */
  aliveMs: number
  transactingWallets: number
  /** Ordered country stops for globe routes: origin, then each recipient. Included in snapshots and baton pages. */
  stops?: BatonStop[]
}

export type HandoffReasonCode =
  | 'NOT_INCLUDED'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'SENDER_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'DATA_MALFORMED'
  | 'DATA_RELAY_MISMATCH'
  | 'DATA_LEG_MISMATCH'
  | 'DATA_COMMITMENT_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'EXECUTION_FAILED'
  | 'DUPLICATE_TRANSACTION'
  | 'CUSTODY_CHANGED'
  | 'INTENT_EXPIRED'
  | 'RPC_UNAVAILABLE'

export interface NetworkHandoffIntent extends HandoffIntent {
  batonId: string
  createdAt: number
  expiresAt: number
  attemptedAt: number | null
  state: 'prepared' | 'attempting' | 'submitted' | 'verified' | 'cancelled' | 'expired'
  /** Reason of the latest pending or rejected verification. */
  failure: HandoffReasonCode | null
}
/**
 * pending: retry later (NOT_INCLUDED, INSUFFICIENT_CONFIRMATIONS, RPC_UNAVAILABLE).
 * rejected: the submitted transaction can never verify this intent. The intent stays locked to its recipient,
 * value and data and accepts the hash of the correct transfer; recover it from wallet activity, never resend blindly.
 */
export interface NetworkConfirmation { status: 'pending' | 'rejected' | 'verified'; reason?: HandoffReasonCode; intent?: NetworkHandoffIntent; baton?: NetworkBaton }

export interface NetworkNotification { id: string; type: 'incoming_baton' | 'your_turn' | 'ghost_beaten' | 'rematch' | 'crew_streak_risk' | 'rival_update' | 'daily_active' | 'recipient_timeout'; title: string; body: string; batonId: string | null; runId: string | null; createdAt: number; readAt: number | null }
export interface NetworkCrew { id: string; code: string | null; name: string; members: NetworkRunner[]; batonIds: string[]; streak: number; bestStreak: number; todayHandoffs: number; contributions: Record<string, number>; deadline: number }
export interface NetworkRival { id: string; title: string; batonIds: [string, string]; target: number; scores: [number, number]; winnerId: string | null; createdAt: number; endsAt: number }
export interface NetworkInvite { id: string; token: string; batonId: string; from: NetworkRunner; recipientId: string | null; createdAt: number; expiresAt: number; claimedBy: string | null; url: string }
export interface NetworkDaily { date: string; world: StationWorld; seed: string; officialRunId: string | null; leaderboard: { player: NetworkRunner; runId: string; score: number; timeMs: number }[] }

export interface NetworkMetrics {
  linkedWallets: number
  transactingWallets: number
  qualifiedHandoffs: number
  mainnetHandoffs: number
  testnetHandoffs: number
  invites: number
  inviteConversions: number
  inviteOpens: number
  returningWallets: number
  quickMatches: number
  rematches: number
  /** Same value as `rematches`. */
  quickRematches: number
  crewActiveDays: number
  dailyAttempts: number
  chronicleViews: number
  shares: number
  sessionSeconds: number
  /** Same value as `sessionSeconds`. */
  foregroundSeconds: number
  controlledEvidence: { handoffs: number; wallets: number }
  definitions: string[]
}
export interface NetworkSnapshot { network: RelayNetwork; batons: NetworkBaton[]; crews: NetworkCrew[]; rivals: NetworkRival[]; daily: NetworkDaily; metrics: NetworkMetrics; playerId: string | null; runners: NetworkRunner[]; inbox: NetworkNotification[]; invites: NetworkInvite[]; pendingHandoff: NetworkHandoffIntent | null; countryConsent: boolean }
export interface BatonDetail {
  baton: NetworkBaton
  handoffs: BatonHandoff[]
  /** The verified ghost the holder races next: null on the first leg of a sector. */
  ghost: CanonicalGhost | null
  pendingHandoff: NetworkHandoffIntent | null
  notableRuns: { runId: string; name: string; score: number; resultHash: string }[]
  /** Latest echo per kind per sector, newest first, at most 12. */
  echoes: RelayEcho[]
}

export type AchievementId =
  | 'first-pass'
  | 'handoffs-10'
  | 'handoffs-50'
  | 'handoffs-100'
  | 'ghost-breaker'
  | 'ghost-wall'
  | 'crew-keeper'
  | 'world-runner'
  | 'global-milestone'
  | 'daily-top-10'
  | 'rival-champion'
export interface RunnerAchievement { id: AchievementId; title: string; unlockedAt: number }
/** Keepsake produced by an achievement unlock, pointing at the verified moment that earned it. */
export interface RelayArtifact { id: string; kind: AchievementId; title: string; subtitle: string; batonId: string | null; leg: number | null; at: number }

export interface RunnerProfile {
  handle: string
  name: string
  level: number
  seasonRank: string
  /** Only when the runner consents to sharing a network-observed country. */
  country: string | null
  qualifiedHandoffs: number
  /** Distinct baton legs finished with a verified run. */
  legs: number
  ghostWins: number
  ghostLosses: number
  quick: { wins: number; losses: number }
  crew: { name: string; streak: number } | null
  daily: { bestTimeMs: number | null; entries: number }
  historicBatons: { id: string; code: string; displayName: string; handoffCount: number; role: 'origin' | 'holder' | 'runner' }[]
  achievements: RunnerAchievement[]
  artifacts: RelayArtifact[]
  cosmetics: { suit: string; helmet: string; board: string; trail: string }
  recentRunners: { name: string; handle: string }[]
}

export type ChronicleMomentKind = 'fastest-leg' | 'closest-ghost-race' | 'longest-surviving-ghost' | 'first-new-country' | 'rescue' | 'milestone' | 'final-runner'
/**
 * value by kind: fastest-leg ms; closest-ghost-race ms between run and ghost; longest-surviving-ghost later legs
 * survived; first-new-country country code; milestone handoff number; rescue and final-runner null.
 */
export interface ChronicleMoment { kind: ChronicleMomentKind; title: string; runner: RunnerRef; leg: number; value: number | string | null }
export interface ChronicleStop { leg: number; runner: RunnerRef; countryCode: string | null; at: number }
export interface ChronicleTransaction { leg: number; txHash: string; from: string; to: string; blockNumber: number; confirmations: number; at: number; runId: string; resultHash: string }
export interface BatonChronicle {
  baton: {
    id: string
    code: string
    serial: number
    title: string
    displayName: string
    mode: BatonMode
    network: RelayNetwork
    status: NetworkBaton['status']
    value: number
    createdAt: number
    completedAt: number | null
    origin: RunnerRef
    holder: RunnerRef
    route: BatonRoute
    appearance: BatonAppearance
  }
  stops: ChronicleStop[]
  aliveMs: number
  qualifiedHandoffs: number
  transactingWallets: number
  countries: number
  moments: ChronicleMoment[]
  runners: RunnerRef[]
  transactions: ChronicleTransaction[]
  replays: { leg: number; runId: string }[]
}

export type ShareSurface = 'chronicle' | 'result' | 'daily' | 'crew' | 'handoff'
/** POST /network/track. `visitor` is an opaque per-device key for signed-out shares; never an IP address. */
export interface TrackEventInput { kind: 'share'; surface: ShareSurface; visitor?: string }
export interface TrackEventResult { counted: boolean }

/** Reasons a submitted transaction can never verify its intent. The others only mean "check again later". */
export type HandoffRejectionReason = Exclude<HandoffReasonCode, 'NOT_INCLUDED' | 'INSUFFICIENT_CONFIRMATIONS' | 'RPC_UNAVAILABLE'>
/** Why a signed relay-network race submission was rejected and flagged for operators. */
export type OpsFlagReason = 'INVALID_TRACE' | 'MAC_MISMATCH'

export interface OpsTotals {
  linkedWallets: number
  transactingWallets: number
  qualifiedHandoffs: number
  batons: { active: number; stranded: number; completed: number }
  crews: number
  rivals: number
  invites: { created: number; opened: number; converted: number }
  /** `unattributed` shares were counted before per-surface tallies started. */
  shares: { total: number; bySurface: Record<ShareSurface, number>; unattributed: number }
  chronicleViews: number
  returningWallets: number
  foregroundSeconds: number
  evidence: { mainnetHandoffs: number; testnetHandoffs: number; controlledHandoffs: number; controlledWallets: number }
}

/** One UTC day of activity. Null means that counter was not recorded yet on that day. */
export interface OpsDay {
  date: string
  newWallets: number
  activeWallets: number
  qualifiedHandoffs: number
  dailyAttempts: number
  /** Verified, rejected and refused together. */
  runsSubmitted: number | null
  runsVerified: number | null
  /** Invalid input trace or MAC mismatch. */
  runsRejected: number | null
  /** Valid ticket that expired, or whose leg no longer fit, before the run was recorded. */
  runsRefused: number | null
  shares: number | null
}

/**
 * Handoff intents prepared on the report's UTC days, counted by the furthest stage each reached and its state now.
 * `rejections` are verification outcomes recorded on those days, one per submitted transaction hash.
 */
export interface OpsFunnel {
  prepared: number
  attempted: number
  submitted: number
  verified: number
  cancelled: number
  expired: number
  open: number
  rejections: Record<HandoffRejectionReason, number>
  medianAttemptToVerifiedMs: number | null
}

/** A rejected submission, with repeated submissions of the same run folded into `attempts`. `at` is the latest. */
export interface OpsFlaggedRun { handle: string; reason: OpsFlagReason; mode: RaceMode; practice: boolean; at: number; attempts: number }
export interface OpsNimFlow { network: RelayNetwork; handoffs: number; luna: number; nim: number }

export type OpsAlertId = 'verification_rejections' | 'rpc_unavailable' | 'archive_lagging' | 'stuck_handoffs' | 'stranded_batons' | 'no_handoffs' | 'archive_not_configured'
/** `critical` alerts need action now; `warning` alerts need a look. `condition` states exactly what was measured. */
export interface OpsAlert { id: OpsAlertId; severity: 'critical' | 'warning'; title: string; condition: string }

/** GET /network/ops, operators only. Handles, never wallets, sessions or device data. */
export interface OpsReport {
  network: RelayNetwork
  generatedAt: number
  /** UTC days in `days` and in the funnel window, today included. */
  windowDays: number
  /** When run and rejection counters, and per-day share tallies, started. Earlier days were never recorded. */
  countingSince: { runs: number; shares: number }
  /** Critical first. */
  alerts: OpsAlert[]
  totals: OpsTotals
  /** Oldest first, ending today (UTC). */
  days: OpsDay[]
  funnel: OpsFunnel
  /** Newest first, at most 50. */
  flaggedRuns: OpsFlaggedRun[]
  nimFlow: OpsNimFlow[]
}
