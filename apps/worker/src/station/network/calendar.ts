import { DAY_MS } from './constants'

/** UTC calendar date, YYYY-MM-DD. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function utcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

export function utcDayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS)
}
