import { utcDate, utcMidnight } from './calendar'
import { DAY_MS } from './constants'

/** Consecutive UTC days with a qualified crew handoff, ending today or, while today is still open, yesterday. */
export function crewStreak(days: Record<string, number>, now: number): number {
  const midnight = utcMidnight(now)
  let cursor = days[utcDate(now)] ? midnight : midnight - DAY_MS
  let streak = 0
  while (days[utcDate(cursor)]) {
    streak++
    cursor -= DAY_MS
  }
  return streak
}

export function bestCrewStreak(days: Record<string, number>): number {
  let best = 0
  let current = 0
  let previous = 0
  for (const date of Object.keys(days).sort()) {
    const time = Date.parse(date)
    current = time - previous === DAY_MS ? current + 1 : 1
    best = Math.max(best, current)
    previous = time
  }
  return best
}
