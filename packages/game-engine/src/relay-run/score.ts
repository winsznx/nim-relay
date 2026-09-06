import { ONE, add, clamp, mul } from '../fixed-point'
import type { RelayState } from './sim'

export interface RelayScoreResult {
  score: number
  breakdown: Record<string, number>
}

const CATCH_PTS = 2500
const CORRIDOR_PTS = 5000
const OVERHEAT_PENALTY = 400
const PULSE_PTS = 300

/** Deterministic final score from a finished relay run. Integer only. */
export function scoreRelayState(state: RelayState): RelayScoreResult {
  const m = state.metrics
  const catchScore = Math.floor((CATCH_PTS * state.catchQuality) / ONE)
  const corridor = m.stabilizeIn + m.stabilizeOut > 0
    ? Math.floor((CORRIDOR_PTS * m.stabilizeIn) / (m.stabilizeIn + m.stabilizeOut))
    : 0
  const pulse = m.pulseOnBeat * PULSE_PTS
  const overheatPenalty = -m.overheats * OVERHEAT_PENALTY
  const subtotal = m.rawScore + catchScore + corridor + pulse + overheatPenalty

  // Sling multiplier 1.0 .. 2.0
  const slingMult = add(ONE, mul(state.slingAccuracy, ONE))
  const total = clamp(Math.floor((Math.max(0, subtotal) * slingMult) / ONE), 0, 5_000_000)

  return {
    score: total,
    breakdown: {
      gates: m.rawScore,
      catch: catchScore,
      stabilizeCorridor: corridor,
      pulseSync: pulse,
      overheat: overheatPenalty,
      slingMultiplierPct: Math.floor((slingMult * 100) / ONE),
      comboMax: m.comboMax,
    },
  }
}

/** Summary used to seed the *next* leg's carry-state (docs §2.7). */
export function prevLegSummary(state: RelayState): {
  cleanGateRatio: number
  turbulenceScoreNorm: number
  slingAccuracy: number
  slingAngle: number
} {
  return {
    cleanGateRatio: m01(state.metrics.cleanGateRatioNorm),
    turbulenceScoreNorm: m01(state.metrics.turbulenceScoreNorm),
    slingAccuracy: m01(state.slingAccuracy),
    slingAngle: state.slingAngle,
  }
}

function m01(v: number): number {
  return clamp(v, 0, ONE)
}
