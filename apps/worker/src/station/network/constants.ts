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

/**
 * A block includes a transaction only below the transaction's validity start height plus 120 batches of 60 blocks:
 * `Transaction::is_valid_at` in core-rs-albatross primitives/transaction/src/lib.rs, with `transaction_validity_window`
 * and `blocks_per_batch` from MAINNET_POLICY and TESTNET_POLICY in primitives/src/policy.rs. Wallets set the start
 * height to the chain height when they sign.
 */
export const TRANSACTION_VALIDITY_WINDOW_BLOCKS = 7_200
/** BLOCK_SEPARATION_TIME in primitives/src/policy.rs. Both networks averaged 0.99 s per block over 86,400 blocks in September 2026. */
export const BLOCK_SEPARATION_MS = 1_000
/** An attempted pass whose hash has not arrived this long after the attempt is looked for on chain; the app usually reports it first. */
export const UNSENT_PASS_LOOKUP_AFTER_MS = 2 * MINUTE_MS
/**
 * How long after the attempt a pass with no transfer on chain counts as never sent: the validity window of a transfer
 * signed at the attempt, plus an hour for an approval signed later than the attempt and for slower blocks.
 */
export const UNSENT_PASS_EXPIRY_MS = TRANSACTION_VALIDITY_WINDOW_BLOCKS * BLOCK_SEPARATION_MS + HOUR_MS
/** The alarm looks each attempted pass up at most this often, and at most this many passes per run. */
export const UNSENT_PASS_RECHECK_MS = 5 * MINUTE_MS
export const MAX_UNSENT_PASS_LOOKUPS = 5
/** A holder's own check of a pass reaches the chain at most this often. */
export const HANDOFF_CHECK_COOLDOWN_MS = 15_000
/** Sender history is read this many transactions at a time, for at most this many pages per lookup. */
export const SENDER_HISTORY_PAGE_SIZE = 50
export const SENDER_HISTORY_MAX_PAGES = 4
/** How far block timestamps and the Worker clock may disagree. */
export const CHAIN_CLOCK_SKEW_MS = 10 * MINUTE_MS

export const SECTOR_HANDOFFS = 10
export const HANDOFF_MILESTONES: readonly number[] = [10, 25, 50, 100, 250]
export const NEAR_MISS_LEGEND = 6
export const MAX_BATON_ECHOES = 12
/** Echoes issued with one leg for its renderer. */
export const MAX_LEG_ECHOES = 4

export const NEW_COURIER_COMPLETED_RUNS = 3
export const VETERAN_QUALIFIED_HANDOFFS = 40
export const DAILY_TIER = 1
/** Baton tether saves: every leg and practice ride gets one, the official Daily attempt none. */
export const LEG_TETHER_SAVES = 1
export const OFFICIAL_DAILY_TETHER_SAVES = 0

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
