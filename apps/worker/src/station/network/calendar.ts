import { DAY_MS, HOUR_MS } from './constants'

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

export function utcHourIndex(ms: number): number {
  return Math.floor(ms / HOUR_MS)
}

/** The `days` UTC dates ending with today, oldest first. */
export function utcDatesEnding(now: number, days: number): string[] {
  const today = utcMidnight(now)
  return Array.from({ length: days }, (_, index) => utcDate(today - (days - 1 - index) * DAY_MS))
}

/** Removes entries keyed by a UTC date before the `days` UTC days ending today. */
export function keepLatestDates(record: Record<string, unknown>, now: number, days: number): void {
  const first = utcDate(utcMidnight(now) - (days - 1) * DAY_MS)
  for (const date of Object.keys(record)) {
    if (date < first) delete record[date]
  }
}
