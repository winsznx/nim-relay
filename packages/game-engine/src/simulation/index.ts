import { abs, add, clamp, HALF, mul, ONE, quotient, ratio, sub } from '../fixed-point'
import { seedState, splitmix64 } from '../prng'

export const CHALLENGE_IDS = ['stabilize', 'slipstream', 'pulse-sync', 'sling', 'redline'] as const
export type ChallengeId = typeof CHALLENGE_IDS[number]
export interface RunConfig { engineVersion: string; challenge: ChallengeId; challengeVersion?: string; seed: string; difficulty: number; durationMs: number }
export interface ChallengeConfig { phaseOffset: number; period: number; safeWidth: number; perfectWidth: number; acceleration: number }
export interface Metrics {
  safeTicks: number; perfectTicks: number; controlError: number; boundaryStrikes: number; recoveryTicks: number;
  gateHits: number; centerAccuracy: number; misses: number; completionTicks: number; pathDeviation: number;
  timingError: number; perfectSyncs: number; maxCombo: number; missedPulses: number; attempts: number;
  angleError: number; powerError: number; timingAccuracy: number; maxStreak: number; stabilityGain: number; finalStability: number
}
export interface GameState {
  config: Readonly<RunConfig>; rules: Readonly<ChallengeConfig>; tick: number; position: number; target: number; velocity: number;
  combo: number; streak: number; lastInput: 0 | 1; metrics: Readonly<Metrics>; safeWidth: number; perfectWidth: number;
  phase: number; power: number; angle: number; cycleTick: number; cycleIndex: number; cyclePeriod: number; shotTaken: boolean; pulseHit: boolean; recovering: boolean; previousError: number
}
export function totalTicks(config: Pick<RunConfig, 'durationMs'>): number { return quotient(config.durationMs * 60 + 999, 1000) }
export function deriveConfig(seed: string, difficulty: number): ChallengeConfig {
  const random = splitmix64(seedState(seed)).value
  return Object.freeze({ phaseOffset: Number(random % 180n), period: 180 - difficulty * 6,
    safeWidth: 12000 - difficulty * 600, perfectWidth: 3500 - difficulty * 150, acceleration: 120 + difficulty * 16 })
}
export function validateConfig(config: RunConfig): void {
  if (config.engineVersion !== '1.0.0' || (config.challengeVersion !== undefined && config.challengeVersion !== '1.0.0')) throw new RangeError('Unsupported engine or challenge version')
  if (!CHALLENGE_IDS.includes(config.challenge)) throw new RangeError('Unknown challenge')
  if (typeof config.seed !== 'string' || !config.seed.length || config.seed.length > 128) throw new RangeError('Seed must contain 1–128 code units')
  if (!Number.isInteger(config.difficulty) || config.difficulty < 1 || config.difficulty > 10) throw new RangeError('Difficulty must be 1–10')
  if (!Number.isInteger(config.durationMs) || config.durationMs < 15000 || config.durationMs > 30000) throw new RangeError('Duration must be 15000–30000 ms')
}
export function createState(config: RunConfig): GameState {
  validateConfig(config)
  const rules = deriveConfig(config.seed, config.difficulty)
  const position = config.challenge === 'redline' ? 6000 : HALF
  return { config: Object.freeze({ ...config, challengeVersion: config.challengeVersion ?? '1.0.0' }), rules,
    tick: 0, position, target: HALF, velocity: 0, combo: 0, streak: 0, lastInput: 0,
    safeWidth: rules.safeWidth, perfectWidth: rules.perfectWidth, phase: 0, power: 0, angle: 0,
    cycleTick: 0, cycleIndex: rules.phaseOffset % 3, cyclePeriod: rules.period + (rules.phaseOffset % 3 - 1) * 12, shotTaken: false,
    pulseHit: false, recovering: config.challenge === 'redline', previousError: abs(position - HALF),
    metrics: { safeTicks: 0, perfectTicks: 0, controlError: 0, boundaryStrikes: 0, recoveryTicks: 0,
      gateHits: 0, centerAccuracy: 0, misses: 0, completionTicks: 0, pathDeviation: 0, timingError: 0,
      perfectSyncs: 0, maxCombo: 0, missedPulses: 0, attempts: 0, angleError: 0, powerError: 0,
      timingAccuracy: 0, maxStreak: 0, stabilityGain: 0, finalStability: ONE - abs(position - HALF) } }
}
function triangle(tick: number, period: number): number {
  const phase = ratio(tick % period, period)
  return phase < HALF ? phase * 2 : (ONE - phase) * 2
}
export function step(state: GameState, input: 0 | 1, tick = state.tick): GameState {
  if (!Number.isInteger(tick) || tick !== state.tick || (input !== 0 && input !== 1)) throw new RangeError('Invalid step tick or input')
  if (tick >= totalTicks(state.config)) return state
  const { rules, config } = state
  const phaseTick = state.cycleTick
  const period = state.cyclePeriod
  const phase = ratio(phaseTick, period)
  const target = add(18000, mul(30000, triangle(tick + rules.phaseOffset, rules.period * 3)))
  const acceleration = config.challenge === 'redline' ? rules.acceleration * 2 : rules.acceleration
  let velocity = mul(add(state.velocity, input ? acceleration : -acceleration), 63500)
  let position = clamp(add(state.position, velocity))
  if (position === 0 || position === ONE) velocity = 0
  const metrics = { ...state.metrics }
  let combo = state.combo
  let streak = state.streak
  let pulseHit = phaseTick === 0 ? false : state.pulseHit
  let power = state.power
  let shotTaken = phaseTick === 0 ? false : state.shotTaken
  const angle = triangle(tick + rules.phaseOffset, 100)
  const press = input === 1 && state.lastInput === 0
  const release = input === 0 && state.lastInput === 1
  let error = abs(sub(position, target))
  if (config.challenge === 'pulse-sync') {
    position = input ? target : clamp(target - 12000)
    error = abs(position - target)
    if (press) {
      const timing = abs(phaseTick - quotient(period, 2))
      metrics.attempts++
      metrics.timingError += timing
      if (!pulseHit && timing <= 10) {
        pulseHit = true; combo++; streak++
        if (timing <= 3) metrics.perfectSyncs++
      } else { combo = 0; streak = 0 }
    }
    if (phaseTick === period - 1 && !pulseHit) { metrics.missedPulses++; combo = 0; streak = 0 }
  } else if (config.challenge === 'sling') {
    power = input ? clamp(add(power, 1050)) : 0
    position = input ? power : state.position
    if (release && !shotTaken) {
      shotTaken = true
      const angleError = abs(angle - HALF)
      const powerError = abs(state.power - 46000)
      const timingError = abs(phaseTick - quotient(period, 2))
      metrics.attempts++; metrics.angleError += angleError; metrics.powerError += powerError
      metrics.timingError += timingError
      metrics.timingAccuracy += clamp(ONE - ratio(timingError, period))
      if (angleError < 16000 && powerError < 14000 && timingError < quotient(period, 3)) { streak++; combo++ } else { streak = 0; combo = 0 }
      position = clamp(ONE - quotient(angleError + powerError, 2))
    }
  }
  const safe = error <= rules.safeWidth
  const perfect = error <= rules.perfectWidth
  if (safe) metrics.safeTicks++
  if (perfect) metrics.perfectTicks++
  metrics.controlError += error
  metrics.pathDeviation += error
  if ((position === 0 || position === ONE) && position !== state.position) metrics.boundaryStrikes++
  if (!safe) metrics.recoveryTicks++
  metrics.finalStability = ONE - error
  metrics.stabilityGain += state.previousError > error ? state.previousError - error : 0
  if (config.challenge === 'stabilize' || config.challenge === 'redline') {
    combo = perfect ? combo + 1 : 0; streak = safe ? streak + 1 : 0
  }
  if (config.challenge === 'slipstream' && phaseTick === period - 1) {
    if (safe) {
      metrics.gateHits++; metrics.centerAccuracy += ONE - ratio(error, rules.safeWidth)
      metrics.completionTicks += tick + 1; combo++; streak++
    } else { metrics.misses++; combo = 0; streak = 0 }
  }
  metrics.maxCombo = combo > metrics.maxCombo ? combo : metrics.maxCombo
  metrics.maxStreak = streak > metrics.maxStreak ? streak : metrics.maxStreak
  return { ...state, tick: tick + 1, position, velocity, target, metrics, combo, streak,
    lastInput: input, phase, power, angle, pulseHit, recovering: !safe, previousError: error, shotTaken,
    cycleTick: phaseTick + 1 === period ? 0 : phaseTick + 1,
    cycleIndex: phaseTick + 1 === period ? state.cycleIndex + 1 : state.cycleIndex,
    cyclePeriod: phaseTick + 1 === period ? rules.period + ((state.cycleIndex + 1) % 3 - 1) * 12 : period }
}
