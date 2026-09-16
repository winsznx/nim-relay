/** "16 Aug" for a UTC calendar date written YYYY-MM-DD. */
export function utcDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "16 Aug, 14:05 UTC". Operator facts are recorded against UTC days, so their times are shown in UTC too. */
export function utcDateTime(time: number): string {
  const date = new Date(time)
  return `${utcDay(date.toISOString().slice(0, 10))}, ${date.toISOString().slice(11, 16)} UTC`
}
