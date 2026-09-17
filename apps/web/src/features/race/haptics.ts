import { relayLeg } from '@nim-relay/game-engine'

const { EVENT } = relayLeg

/** Flags the engine may raise on every tick a moment lasts; they buzz when the moment starts. */
const SUSTAINED = EVENT.SHOULDER | EVENT.EDGE_GRIND | EVENT.DRAFTING

/** The strongest moment of a tick decides its buzz, in milliseconds of buzz and pause. */
const PATTERNS: readonly (readonly [mask: number, pattern: readonly number[]])[] = [
  [EVENT.LEG_FAILED | EVENT.FALL, [40, 30, 60]],
  [EVENT.TETHER_SAVE, [12, 40, 12, 40, 70]],
  [EVENT.HIT, [28, 30, 40]],
  [EVENT.RUSH_START, [10, 20, 10, 20, 80]],
  [EVENT.EDGE_SAVE, [15, 40, 25]],
  [EVENT.EDGE_GRIND, [22, 18, 22]],
  [EVENT.HARD_LANDING, [30]],
  [EVENT.SHOULDER, [10, 30, 10]],
  [EVENT.GHOST_OVERTAKE, [12, 30, 12]],
  [EVENT.PERFECT_GATE, [8]],
  [EVENT.LAND, [14]],
  [EVENT.LANE_ACQUIRED, [5]],
]

/** The pattern for one tick's events, given which sustained flags were already on the tick before. */
export function hapticPattern(events: number, sustainedBefore: number): readonly number[] | null {
  const fresh = events & ~(sustainedBefore & SUSTAINED)
  for (const [mask, pattern] of PATTERNS) if (fresh & mask) return pattern
  return null
}

/**
 * Short vibrations for the moments a thumb should feel, where the platform has them (Android).
 * Stops trying after the first failure. One instance follows one run's ticks.
 */
export class RaceHaptics {
  private available = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  private lastTick = Number.NEGATIVE_INFINITY
  private lastSustained = 0

  play(tick: number, events: number): void {
    const before = tick === this.lastTick + 1 ? this.lastSustained : 0
    this.lastTick = tick
    this.lastSustained = events & SUSTAINED
    if (!this.available) return
    const pattern = hapticPattern(events, before)
    if (!pattern) return
    try {
      navigator.vibrate([...pattern])
    } catch {
      // Some WebViews throw when vibration is disallowed; the buzz is optional, so stop asking.
      this.available = false
    }
  }
}
