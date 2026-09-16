import { describe, expect, it } from 'vitest'
import { FRESH_BATON, MAX_MARKERS, MAX_SCARS, batonAppearance, type BatonAppearanceInput } from './baton-appearance'

const DAY = 86_400_000
const fresh: BatonAppearanceInput = { handoffCount: 0, ageMs: 0, countries: 1, ghostWins: 0, milestones: [] }

describe('batonAppearance', () => {
  it('keeps a fresh baton as a clean gold core', () => {
    // #given a baton with no journey yet
    // #when its appearance is derived
    const appearance = batonAppearance(fresh)
    // #then it is the clean fresh baton
    expect(appearance).toEqual(FRESH_BATON)
  })

  it('grows the first ring at 25 handoffs', () => {
    // #given batons just below and at the first ring tier
    // #then only the one at 25 handoffs has a ring and a comet trail
    expect(batonAppearance({ ...fresh, handoffCount: 24 }).rings).toBe(0)
    expect(batonAppearance({ ...fresh, handoffCount: 25 }).rings).toBe(1)
    expect(batonAppearance({ ...fresh, handoffCount: 25 }).trail).toBe('comet')
  })

  it('shows several rings and an evolved trail at 100 handoffs', () => {
    // #given a veteran baton
    // #when its appearance is derived
    const veteran = batonAppearance({ ...fresh, handoffCount: 100 })
    // #then it wears several rings and an evolved trail
    expect(veteran.rings).toBeGreaterThanOrEqual(3)
    expect(veteran.trail).toBe('ribbon')
    expect(batonAppearance({ ...fresh, handoffCount: 5000 }).trail).toBe('aurora')
  })

  it('reserves auras for long-lived batons', () => {
    // #given batons of increasing age
    // #then the aura only appears at two weeks and deepens with months
    expect(batonAppearance({ ...fresh, ageMs: 13 * DAY }).aura).toBe('none')
    expect(batonAppearance({ ...fresh, ageMs: 14 * DAY }).aura).toBe('warm')
    expect(batonAppearance({ ...fresh, ageMs: 60 * DAY }).aura).toBe('radiant')
    expect(batonAppearance({ ...fresh, ageMs: 400 * DAY }).aura).toBe('legendary')
  })

  it('scars a baton once per rescue, up to a limit', () => {
    // #given journeys with rescue milestones
    // #then each rescue leaves a scar, capped
    expect(batonAppearance({ ...fresh, milestones: ['first-crossing', 'rescue'] }).scars).toBe(1)
    expect(batonAppearance({ ...fresh, milestones: Array.from({ length: 9 }, () => 'rescue') }).scars).toBe(MAX_SCARS)
  })

  it('adds a marker per country beyond the first', () => {
    // #given journeys across more countries
    // #then markers count countries after the origin, capped
    expect(batonAppearance({ ...fresh, countries: 1 }).markers).toBe(0)
    expect(batonAppearance({ ...fresh, countries: 4 }).markers).toBe(3)
    expect(batonAppearance({ ...fresh, countries: 80 }).markers).toBe(MAX_MARKERS)
  })

  it('breathes harder as runners beat ghosts, capped at full strength', () => {
    // #given batons with few and many ghost wins
    const calm = batonAppearance(fresh).pulse
    const fierce = batonAppearance({ ...fresh, ghostWins: 40 }).pulse
    // #then the pulse grows and never exceeds full strength
    expect(fierce).toBeGreaterThan(calm)
    expect(batonAppearance({ ...fresh, ghostWins: 1e9 }).pulse).toBe(1)
  })

  it('treats malformed numbers as a fresh journey', () => {
    // #given non-finite and negative journey numbers
    // #when the appearance is derived
    const odd = batonAppearance({ handoffCount: Number.NaN, ageMs: -5, countries: Number.POSITIVE_INFINITY, ghostWins: -3, milestones: [] })
    // #then it falls back to a fresh baton
    expect(odd).toEqual(FRESH_BATON)
  })
})
