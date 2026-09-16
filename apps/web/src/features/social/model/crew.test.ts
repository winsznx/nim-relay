import { describe, expect, it } from 'vitest'
import { CREW_COLORS, crewBatonInPlay, crewColor, crewContributions, streakCells, streakState } from './crew'
import { baton, crew, runner } from './testing'

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta === 0) return 0
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (sector * 60 + 360) % 360
}

describe('crew identity color', () => {
  it('gives a crew the same color on every call', () => {
    // #given the same crew id twice
    // #then the color is stable
    expect(crewColor('crew-7f3a')).toBe(crewColor('crew-7f3a'))
  })

  it('spreads different crews across the palette', () => {
    // #given many crew ids
    const colors = new Set(Array.from({ length: 64 }, (_, index) => crewColor(`crew-${index}`)))
    // #then most of the palette is used
    expect(colors.size).toBeGreaterThanOrEqual(CREW_COLORS.length - 1)
  })

  it('never uses red, cyan or the baton’s gold', () => {
    for (const color of CREW_COLORS) {
      const angle = hue(color)
      // #then red (danger), cyan (live and verified) and gold (value) stay distinct
      expect(angle >= 340 || angle <= 20, `${color} reads as red`).toBe(false)
      expect(angle >= 165 && angle <= 205, `${color} reads as cyan`).toBe(false)
      expect(angle >= 25 && angle <= 55, `${color} reads as gold`).toBe(false)
    }
  })
})

describe('crew streak state', () => {
  it('is secured once a verified pass counts today', () => {
    expect(streakState({ streak: 5, todayHandoffs: 1 })).toBe('secured')
  })

  it('is at risk when a running streak has no pass today', () => {
    expect(streakState({ streak: 5, todayHandoffs: 0 })).toBe('at-risk')
  })

  it('is open when no streak is running', () => {
    expect(streakState({ streak: 0, todayHandoffs: 0 })).toBe('open')
  })
})

describe('streak chain', () => {
  it('fills the days before today and leaves today open while at risk', () => {
    // #given a 3-day streak through yesterday
    // #when the week is drawn
    const cells = streakCells({ streak: 3, todayHandoffs: 0 })
    // #then three kept days lead into an open today
    expect(cells).toEqual(['empty', 'empty', 'empty', 'kept', 'kept', 'kept', 'today-open'])
  })

  it('counts today inside a secured streak', () => {
    // #given a 2-day streak that includes today
    expect(streakCells({ streak: 2, todayHandoffs: 3 })).toEqual(['empty', 'empty', 'empty', 'empty', 'empty', 'kept', 'today-kept'])
  })

  it('caps long streaks at the visible week', () => {
    expect(streakCells({ streak: 40, todayHandoffs: 0 })).toEqual(['kept', 'kept', 'kept', 'kept', 'kept', 'kept', 'today-open'])
  })
})

describe('crew baton and contributions', () => {
  const ada = runner('ada')
  const ben = runner('ben')

  it('picks the most recently moved crew baton that is still in play', () => {
    // #given an old active baton, a newer finished one and a baton of another crew
    const batons = [
      baton({ id: 'old', holder: ada, updatedAt: 10 }),
      baton({ id: 'done', holder: ben, updatedAt: 30, status: 'completed' }),
      baton({ id: 'other', holder: ben, updatedAt: 40 }),
      baton({ id: 'new', holder: ben, updatedAt: 20, status: 'stranded' }),
    ]
    // #when
    const inPlay = crewBatonInPlay(crew({ id: 'c', members: [ada, ben], batonIds: ['old', 'done', 'new'] }), batons)
    // #then the newest one a member can still act on
    expect(inPlay?.id).toBe('new')
  })

  it('measures each member against the top contributor, busiest first', () => {
    // #given passes sent by members
    const shares = crewContributions(crew({ id: 'c', members: [ada, ben], contributions: { ada: 2, ben: 4 } }))
    // #then
    expect(shares).toEqual([
      { memberId: 'ben', passes: 4, share: 1 },
      { memberId: 'ada', passes: 2, share: 0.5 },
    ])
  })

  it('keeps empty bars when nobody has passed yet', () => {
    expect(crewContributions(crew({ id: 'c', members: [ada] }))).toEqual([{ memberId: 'ada', passes: 0, share: 0 }])
  })
})
