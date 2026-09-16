import { describe, expect, it } from 'vitest'
import { DAILY_BOARD_LIMIT, dailyResetsAt, dailyStanding, ghostAbove, officialStatus } from './daily'
import { daily, runner } from './testing'

const entry = (id: string, score: number, timeMs: number) => ({ player: runner(id), runId: `run-${id}`, score, timeMs })

describe('daily standing', () => {
  const board = daily([entry('mei', 900, 57_400), entry('arjun', 850, 58_000), entry('me', 800, 58_120), entry('lena', 700, 61_000)])

  it('ranks the runner by board position with the top percent of real entries', () => {
    // #when the runner's standing is read
    const standing = dailyStanding(board, 'me')
    // #then third of four is the top 75%
    expect(standing).toMatchObject({ rank: 3, total: 4, topPercent: 75 })
  })

  it('has no standing for a runner without an entry or signed out', () => {
    expect(dailyStanding(board, 'sam')).toBeNull()
    expect(dailyStanding(board, null)).toBeNull()
  })

  it('withholds the percentile when the published board may be cut off', () => {
    // #given a board filled to the server's limit
    const full = daily(Array.from({ length: DAILY_BOARD_LIMIT }, (_, index) => entry(`r${index}`, 1000 - index, 50_000 + index)))
    // #then the total of all entries is unknown
    expect(dailyStanding(full, 'r4')?.topPercent).toBeNull()
  })
})

describe('official status', () => {
  it('is not started before the official attempt is issued', () => {
    expect(officialStatus(daily([]), 'me')).toEqual({ state: 'not-started' })
  })

  it('is started when the attempt was issued but no result is on the board', () => {
    expect(officialStatus(daily([entry('mei', 900, 57_400)], 'run-me'), 'me')).toEqual({ state: 'started' })
  })

  it('is finished with the standing once the result is ranked', () => {
    expect(officialStatus(daily([entry('me', 900, 57_400)], 'run-me'), 'me')).toMatchObject({ state: 'finished', standing: { rank: 1 } })
  })
})

describe('ghost above you', () => {
  it('is the nearest entry ranked above that also finished faster', () => {
    // #given a higher score that rode slower directly above the runner
    const board = daily([entry('mei', 950, 57_400), entry('arjun', 900, 59_000), entry('me', 800, 58_120)])
    // #when the ghost to chase is picked
    // #then the slower entry above is skipped for the faster one
    expect(ghostAbove(board, 'me')?.player.id).toBe('mei')
  })

  it('is absent for the fastest runner and for runners without an entry', () => {
    const board = daily([entry('me', 950, 57_000), entry('mei', 900, 57_400)])
    expect(ghostAbove(board, 'me')).toBeNull()
    expect(ghostAbove(board, 'sam')).toBeNull()
  })
})

describe('daily reset', () => {
  it('is midnight UTC after the Daily’s date', () => {
    expect(new Date(dailyResetsAt({ date: '2026-09-16' })).toISOString()).toBe('2026-09-17T00:00:00.000Z')
  })
})
