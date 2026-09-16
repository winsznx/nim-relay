export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** One NIM. */
export const BATON_VALUE_LUNA = 100_000
/** A holder who neither passes nor races within this window leaves the baton stranded. */
export const BATON_HOLD_MS = DAY_MS
export const INTENT_PREPARED_TTL_MS = 5 * MINUTE_MS
/** Quick and Global reservations release when the reserved runner has not accepted in this window. */
export const RESERVATION_ACCEPT_MS = DAY_MS
export const INVITE_TTL_MS = DAY_MS
export const RACE_ISSUE_TTL_MS = 10 * MINUTE_MS
/** A run's live progress reports are accepted at most this often; extras are ignored. */
export const LIVE_REPORT_INTERVAL_MS = 1_500
/** Live progress changes reach open clients as `network_updated` at most this often. */
export const LIVE_BROADCAST_INTERVAL_MS = 3_000
export const RIVALRY_MS = 7 * DAY_MS

export const MIN_CONFIRMATIONS = 2
export const RECONCILE_RETRY_MS = 15_000
export const RECONCILE_INTERVAL_MS = 30_000

export const SECTOR_HANDOFFS = 10
export const HANDOFF_MILESTONES: readonly number[] = [10, 25, 50, 100, 250]
export const NEAR_MISS_LEGEND = 6
export const MAX_BATON_ECHOES = 12

export const NEW_COURIER_COMPLETED_RUNS = 3
export const VETERAN_QUALIFIED_HANDOFFS = 40
export const DAILY_TIER = 1

export const MAX_ACTIVE_ORIGIN_BATONS = 10
export const MAX_ACTIVE_INVITES = 20
export const MAX_NOTIFICATIONS = 100
export const MAX_CREW_MEMBERS = 5
export const DAILY_LEADERBOARD_SIZE = 100
export const MAX_NOTABLE_RUNS = 20
export const MAX_PROFILE_BATONS = 50
export const MAX_RECENT_RUNNERS = 10

export const GHOST_BREAKER_WINS = 10
export const GHOST_WALL_SURVIVALS = 5
export const CREW_KEEPER_STREAK_DAYS = 7
export const DAILY_TOP_SHARE_MIN_ENTRIES = 10

export const SHARES_PER_ACTOR_PER_DAY = 20
export const ANONYMOUS_SHARES_PER_DAY = 200

/** UTC days in the operator report, today included. The ledger keeps exactly these days. */
export const OPS_WINDOW_DAYS = 30
/** Hourly buckets behind the rolling 24-hour alerts: the current hour and the 23 before it. */
export const OPS_WINDOW_HOURS = 24
export const MAX_FLAGGED_RUNS = 50

export const OPS_REJECTION_RATE_LIMIT = 0.2
export const OPS_RPC_ALERT_MS = HOUR_MS
export const OPS_STUCK_HANDOFF_MS = 30 * MINUTE_MS
export const OPS_ARCHIVE_LAG_MS = 10 * MINUTE_MS
export const OPS_QUIET_NETWORK_MS = DAY_MS
