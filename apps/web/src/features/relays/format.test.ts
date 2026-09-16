import { describe, expect, it } from 'vitest'
import { formatBoardTime, formatClock } from './format'

describe('leaderboard time', () => {
  it('writes minutes, seconds and hundredths as mm:ss.cc', () => {
    expect(formatBoardTime(58_120)).toBe('00:58.12')
    expect(formatBoardTime(61_005)).toBe('01:01.00')
  })

  it('truncates instead of rounding, so a slower ride never displays faster', () => {
    expect(formatBoardTime(58_129)).toBe('00:58.12')
  })
})

describe('countdown clock', () => {
  it('shows hours, minutes and seconds below a day', () => {
    expect(formatClock(5 * 3_600_000 + 12 * 60_000 + 33_000)).toBe('05:12:33')
  })

  it('rounds a partial second up so it never shows zero early', () => {
    expect(formatClock(400)).toBe('00:00:01')
  })

  it('puts whole days in front from one day on', () => {
    expect(formatClock(3 * 86_400_000 + 4 * 3_600_000 + 9_000)).toBe('3d 04:00:09')
  })

  it('stops at zero', () => {
    expect(formatClock(-5_000)).toBe('00:00:00')
  })
})
