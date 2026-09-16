import type { NetworkDaily } from '@nim-relay/shared'

export type DailyEntry = NetworkDaily['leaderboard'][number]

const DAY_MS = 86_400_000
/** The server publishes at most this many official entries per Daily (apps/worker DAILY_LEADERBOARD_SIZE). */
export const DAILY_BOARD_LIMIT = 100

export interface DailyStanding {
  entry: DailyEntry
  /** 1-based position on the board, which the server orders by score, then time. */
  rank: number
  /** Official entries on the board. */
  total: number
  /** "Top X%" among today's official entries, or null when the board may be cut off and the total is unknown. */
  topPercent: number | null
}

export function dailyStanding(daily: NetworkDaily, playerId: string | null): DailyStanding | null {
  if (!playerId) return null
  const index = daily.leaderboard.findIndex(entry => entry.player.id === playerId)
  const entry = daily.leaderboard[index]
  if (!entry) return null
  const rank = index + 1
  const total = daily.leaderboard.length
  const complete = total < DAILY_BOARD_LIMIT
  return { entry, rank, total, topPercent: complete ? Math.max(1, Math.ceil((rank / total) * 100)) : null }
}

export type OfficialStatus =
  | { state: 'not-started' }
  /** The official attempt was issued but no result is on the board. */
  | { state: 'started' }
  /** The attempt was used and the board is full, so the result may sit below the published entries. */
  | { state: 'unranked' }
  | { state: 'finished'; standing: DailyStanding }

/** The signed-in runner's official Daily status. `officialRunId` is only ever set for that runner. */
export function officialStatus(daily: NetworkDaily, playerId: string): OfficialStatus {
  const standing = dailyStanding(daily, playerId)
  if (standing) return { state: 'finished', standing }
  if (daily.officialRunId === null) return { state: 'not-started' }
  return daily.leaderboard.length >= DAILY_BOARD_LIMIT ? { state: 'unranked' } : { state: 'started' }
}

/** The nearest entry ranked above the runner that also finished faster: the ghost worth chasing next. */
export function ghostAbove(daily: NetworkDaily, playerId: string): DailyEntry | null {
  const standing = dailyStanding(daily, playerId)
  if (!standing) return null
  for (let index = standing.rank - 2; index >= 0; index--) {
    const entry = daily.leaderboard[index]
    if (entry && entry.player.id !== playerId && entry.timeMs < standing.entry.timeMs) return entry
  }
  return null
}

/** When today's course is replaced: midnight UTC after the Daily's date. */
export function dailyResetsAt(daily: Pick<NetworkDaily, 'date'>): number {
  return Date.parse(`${daily.date}T00:00:00Z`) + DAY_MS
}
