/**
 * How a baton looks is earned by its journey. This is the single source of truth
 * for every surface that draws a baton (race, globe, station, UI emblems), so a
 * baton reads the same wherever a player meets it.
 */

export interface BatonAppearanceInput {
  /** Verified handoffs this baton has completed. */
  handoffCount: number
  /** Time since the baton was minted. */
  ageMs: number
  /** Distinct countries the baton has been carried through. */
  countries: number
  /** Legs where a runner beat the ghost they were chasing. */
  ghostWins: number
  /** Journey milestone ids, e.g. `rescue` when a stalled baton was recovered. */
  milestones: readonly string[]
}

export type BatonAura = 'none' | 'warm' | 'radiant' | 'legendary'
export type BatonTrail = 'spark' | 'comet' | 'ribbon' | 'aurora'

export interface BatonAppearance {
  /** Light rings around the core, one per handoff tier reached. */
  rings: number
  /** Rare shell of light that only long-lived batons grow. */
  aura: BatonAura
  trail: BatonTrail
  /** Dark fractures in the core, one per rescue. */
  scars: number
  /** 0..1, how strongly the core breathes. Grows with ghost wins. */
  pulse: number
  /** Orbiting markers, one per country beyond the first. */
  markers: number
}

export const RING_THRESHOLDS: readonly number[] = [25, 50, 75, 100, 150, 250, 500, 1000]
export const MAX_SCARS = 3
export const MAX_MARKERS = 12

const DAY_MS = 86_400_000
const AURA_AGE_DAYS: readonly (readonly [BatonAura, number])[] = [
  ['legendary', 180],
  ['radiant', 60],
  ['warm', 14],
]

export const FRESH_BATON: BatonAppearance = Object.freeze({
  rings: 0,
  aura: 'none',
  trail: 'spark',
  scars: 0,
  pulse: 0.35,
  markers: 0,
})

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function trailFor(handoffs: number): BatonTrail {
  if (handoffs >= 500) return 'aurora'
  if (handoffs >= 100) return 'ribbon'
  if (handoffs >= 25) return 'comet'
  return 'spark'
}

function auraFor(ageMs: number): BatonAura {
  const days = count(ageMs) / DAY_MS
  for (const [aura, minimumDays] of AURA_AGE_DAYS) {
    if (days >= minimumDays) return aura
  }
  return 'none'
}

export function batonAppearance(input: BatonAppearanceInput): BatonAppearance {
  const handoffs = count(input.handoffCount)
  const wins = count(input.ghostWins)
  const rescues = input.milestones.filter(milestone => milestone === 'rescue').length
  return {
    rings: RING_THRESHOLDS.filter(threshold => handoffs >= threshold).length,
    aura: auraFor(input.ageMs),
    trail: trailFor(handoffs),
    scars: Math.min(MAX_SCARS, rescues),
    pulse: Math.min(1, FRESH_BATON.pulse + Math.log2(1 + wins) * 0.1),
    markers: Math.min(MAX_MARKERS, Math.max(0, count(input.countries) - 1)),
  }
}
