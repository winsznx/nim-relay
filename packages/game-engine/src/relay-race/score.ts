import type { RaceState } from './sim'

export interface RaceResult {
  timeMs: number
  timeSeconds: number // rounded to 2dp
  perfectGates: number
  totalGates: number
  shortcuts: number
  boostControlPct: number
  hazardsHit: number
  relayScore: number // hidden composite; player sees TIME, not this as headline
  finished: boolean
}

/** Player-facing numbers only. No internal identifiers leak past this function. */
export function scoreRace(state: RaceState): RaceResult {
  const m = state.metrics
  const timeMs = Math.round((state.finishTick / 60) * 1000)
  const wastedOnOverheat = m.overheatEvents * 42
  const boostControlPct = m.boostTicks === 0
    ? 100
    : Math.max(0, Math.min(100, Math.round(100 * (1 - wastedOnOverheat / m.boostTicks))))

  // relay score: faster time + clean gates + risk taken, minus hazards. Bounded.
  const timeBonus = Math.max(0, 60000 - timeMs)
  const relayScore = Math.max(
    0,
    Math.round(timeBonus / 12) + m.perfectGates * 250 + m.grazeGates * 60 + m.beatHits * 200 + state.onShortcut * 800 - m.hazardsHit * 300,
  )

  return {
    timeMs,
    timeSeconds: Math.round(timeMs / 10) / 100,
    perfectGates: m.perfectGates,
    totalGates: m.gatesOnLine,
    shortcuts: state.onShortcut,
    boostControlPct,
    hazardsHit: m.hazardsHit,
    relayScore,
    finished: state.finished === 1 && state.finishTick < 5400,
  }
}
