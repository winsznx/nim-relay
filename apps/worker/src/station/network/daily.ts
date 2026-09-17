import { relayLeg } from '@nim-relay/game-engine'
import type { NetworkDaily, RelayLegTier, StationWorld } from '@nim-relay/shared'
import { ApiError, type Profile, type Run } from '../model'
import { unlockAchievement } from './achievements'
import { utcDate, utcDayIndex } from './calendar'
import { DAILY_LEADERBOARD_SIZE, DAILY_TIER, DAILY_TOP_SHARE_MIN_ENTRIES } from './constants'
import { loadRun } from './lookups'
import { networkRunner } from './runners'
import type { DailyEntry, NetworkContext, NetworkState } from './types'

export interface DailyCourse {
  date: string
  world: StationWorld
  seed: string
  tier: RelayLegTier
}

const DAILY_SEED = /^daily-(\d{4}-\d{2}-\d{2})-v[4-6]$/

/** One v6 course for everyone per UTC day, on the standard tier. Its config is issued per ride with no inherited FLOW. */
export function dailyCourse(now: number): DailyCourse {
  const date = utcDate(now)
  const world = relayLeg.WORLDS[utcDayIndex(now) % relayLeg.WORLDS.length]!
  return { date, world, seed: `daily-${date}-v6`, tier: DAILY_TIER }
}

export function dailyKey(date: string, playerId: string): string {
  return `${date}:${playerId}`
}

export function dailySnapshot(context: NetworkContext, profile: Profile | null, now: number): NetworkDaily {
  const course = dailyCourse(now)
  const ranked = Object.entries(context.state.daily[course.date] ?? {})
    .filter(([, entry]) => entry.seed === course.seed)
    .sort(([, a], [, b]) => b.score - a.score || a.timeMs - b.timeMs)
    .slice(0, DAILY_LEADERBOARD_SIZE)
  const leaderboard = ranked.flatMap(([playerId, entry]) => {
    const player = context.product.players[playerId]
    return player ? [{ player: networkRunner(context.state, player), runId: entry.runId, score: entry.score, timeMs: entry.timeMs }] : []
  })
  const officialRunId = profile ? (context.state.dailyIssues[dailyKey(course.date, profile.id)] ?? null) : null
  return { date: course.date, world: course.world, seed: course.seed, officialRunId, leaderboard }
}

/**
 * Skill-matched Daily ghost among other runners' completed official entries: the entry ranked just above the
 * runner's personal best (the slowest time still faster than it), the nearest slower entry when none is faster,
 * and the median entry for a runner without a result. Never the runner's own run.
 */
export function pickDailyGhostEntry(entries: Record<string, DailyEntry>, playerId: string, seed: string, personalBestMs: number | null): DailyEntry | null {
  const candidates = Object.entries(entries)
    .filter(([entrant, entry]) => entrant !== playerId && entry.seed === seed && entry.completed)
    .map(([, entry]) => entry)
    .sort((a, b) => a.timeMs - b.timeMs || a.runId.localeCompare(b.runId))
  if (candidates.length === 0) return null
  if (personalBestMs === null) return candidates[Math.floor((candidates.length - 1) / 2)]!
  const faster = candidates.filter(entry => entry.timeMs < personalBestMs)
  return faster.at(-1) ?? candidates[0]!
}

/** The run behind the skill-matched Daily ghost, if any entry fits. */
export async function selectDailyGhostRun(context: NetworkContext, playerId: string, course: DailyCourse): Promise<Run | undefined> {
  const best = context.state.dailyBests[dailyKey(course.date, playerId)]
  const personalBestMs = best?.seed === course.seed ? best.timeMs : null
  const entry = pickDailyGhostEntry(context.state.daily[course.date] ?? {}, playerId, course.seed, personalBestMs)
  return loadRun(context.storage, entry?.runId ?? null)
}

/** Practice counts toward the personal best, so the Daily ghost adapts before the official attempt. */
export function recordDailyBest(state: NetworkState, run: Run): void {
  const { seed } = run.issued.config
  const date = DAILY_SEED.exec(seed)?.[1]
  if (!date || !run.result.completed) return
  const key = dailyKey(date, run.issued.playerId)
  const best = state.dailyBests[key]
  if (best?.seed === seed && best.timeMs <= run.result.timeMs) return
  state.dailyBests[key] = { seed, timeMs: run.result.timeMs }
}

export function recordOfficialDaily(state: NetworkState, run: Run, profile: Profile): void {
  const { seed } = run.issued.config
  const date = DAILY_SEED.exec(seed)?.[1]
  if (!date || state.dailyIssues[dailyKey(date, profile.id)] !== run.issued.runId) throw new ApiError('not_official_daily')
  const entries = state.daily[date] ?? {}
  state.daily[date] = entries
  entries[profile.id] = { runId: run.issued.runId, score: run.result.score, timeMs: run.result.timeMs, seed, completed: run.result.completed }
}

/** Settles DAILY TOP 10% for every UTC day that has ended, once. */
export function settleDailies(state: NetworkState, now: number): void {
  const today = utcDate(now)
  const settledThrough = state.dailySettledThrough
  const ended = Object.keys(state.daily)
    .filter(date => date < today && (settledThrough === null || date > settledThrough))
    .sort()
  for (const date of ended) awardDailyTopShare(state, date, now)
  const latest = ended.at(-1)
  if (latest) state.dailySettledThrough = latest
  for (const key of Object.keys(state.dailyBests)) {
    if (!key.startsWith(`${today}:`)) delete state.dailyBests[key]
  }
}

/** Top 10% of a course with at least 10 official entries; incomplete runs never qualify. */
function awardDailyTopShare(state: NetworkState, date: string, now: number): void {
  const courses = new Map<string, [string, DailyEntry][]>()
  for (const [playerId, entry] of Object.entries(state.daily[date] ?? {})) {
    courses.set(entry.seed, [...(courses.get(entry.seed) ?? []), [playerId, entry]])
  }
  for (const entries of courses.values()) {
    if (entries.length < DAILY_TOP_SHARE_MIN_ENTRIES) continue
    const ranked = [...entries].sort(([, a], [, b]) => b.score - a.score || a.timeMs - b.timeMs)
    const qualifying = ranked.slice(0, Math.floor(entries.length / 10))
    qualifying.forEach(([playerId, entry], index) => {
      if (!entry.completed) return
      unlockAchievement(state, playerId, 'daily-top-10', { subtitle: `Daily ${date} · #${index + 1} of ${entries.length}`, batonId: null, leg: null, at: now })
    })
  }
}
