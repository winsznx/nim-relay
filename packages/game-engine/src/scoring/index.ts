import { clamp, ONE, quotient } from '../fixed-point'
import type { GameState } from '../simulation'
export interface ScoreResult { score: number; breakdown: Record<string, number> }
export function scoreState(state: GameState): ScoreResult {
  const m = state.metrics
  const ticks = state.tick || 1
  const average = (value: number, count = ticks): number => quotient(value, count || 1)
  let breakdown: Record<string, number>
  switch (state.config.challenge) {
    case 'stabilize': breakdown = {
      safeZone: average(m.safeTicks * 6000), perfectZone: average(m.perfectTicks * 4000),
      controlAccuracy: average((ticks * ONE - m.controlError) * 2000, ticks * ONE),
      boundaryStrikes: -m.boundaryStrikes * 100, recoveryTime: -average(m.recoveryTicks * 2000),
    }; break
    case 'slipstream': breakdown = {
      gateHits: m.gateHits * 600, centerAccuracy: average(m.centerAccuracy * 400, ONE), misses: -m.misses * 300,
      completionTime: m.gateHits * 200 - average(m.completionTicks * 200, ticks),
      pathAccuracy: average((ticks * ONE - m.pathDeviation) * 2000, ticks * ONE),
    }; break
    case 'pulse-sync': breakdown = {
      timingAccuracy: m.attempts * 200 - m.timingError * 10, perfectSyncs: m.perfectSyncs * 800,
      combo: m.maxCombo * 300, missedPulses: -m.missedPulses * 500,
    }; break
    case 'sling': breakdown = {
      angleAccuracy: m.attempts * 300 - average(m.angleError * 600, ONE),
      powerAccuracy: m.attempts * 300 - average(m.powerError * 600, ONE),
      timingAccuracy: average(m.timingAccuracy * 300, ONE), streak: m.maxStreak * 300, combo: m.maxCombo * 100,
    }; break
    case 'redline': breakdown = {
      recoveryTime: -average(m.recoveryTicks * 4000), stabilityGain: average(m.stabilityGain * 1000, ONE),
      strikes: -m.boundaryStrikes * 200, finalStability: average(m.finalStability * 6000, ONE),
    }; break
  }
  return { score: clamp(Object.values(breakdown).reduce((sum, value) => sum + value, 0), 0, 1000000), breakdown }
}
