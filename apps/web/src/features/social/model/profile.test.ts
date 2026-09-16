import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, achievementBadges, levelProgress } from './profile'

describe('level progress', () => {
  it('measures XP inside the current level against the server rule', () => {
    // #given 1,250 XP, which the server reports as level 3
    // #then 250 of 500 XP toward level 4
    expect(levelProgress(1_250, 3)).toEqual({ level: 3, into: 250, span: 500, toNext: 250 })
  })

  it('starts a level at zero progress', () => {
    expect(levelProgress(1_000, 3)).toMatchObject({ into: 0, toNext: 500 })
  })

  it('shows no bar when the reported level disagrees with the XP', () => {
    expect(levelProgress(1_250, 7)).toBeNull()
  })
})

describe('achievement badges', () => {
  it('lists earned badges first, oldest first, then every locked one with its condition', () => {
    // #given two unlocks out of order
    const badges = achievementBadges([
      { id: 'ghost-breaker', title: 'GHOST BREAKER', unlockedAt: 20 },
      { id: 'first-pass', title: 'FIRST PASS', unlockedAt: 10 },
    ])
    // #then
    expect(badges.slice(0, 2).map(badge => [badge.id, badge.unlockedAt])).toEqual([
      ['first-pass', 10],
      ['ghost-breaker', 20],
    ])
    expect(badges).toHaveLength(ACHIEVEMENTS.length)
    expect(badges.slice(2).every(badge => badge.unlockedAt === null && badge.condition.length > 0)).toBe(true)
  })

  it('covers every achievement once', () => {
    expect(new Set(ACHIEVEMENTS.map(item => item.id)).size).toBe(11)
  })
})
