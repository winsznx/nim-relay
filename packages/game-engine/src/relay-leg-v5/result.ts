import { ONE } from '../fixed-point'
import { canonicalJSON, sha256 } from '../replay/hash'
import {
  ACTION_BUFFER_TICKS,
  BASE_SPEED,
  CLEAN_LANDING_AIR_TICKS,
  DRONE_HEIGHT,
  FALL_STUMBLE_TICKS,
  FLOW,
  FLOW_SPEED,
  GAP_CLEARANCE,
  GRAVITY,
  JUMP_VELOCITY,
  LOW_HAZARD_HEIGHT,
  NEAR_MISS_MARGIN,
  PAD_SPEED,
  RAIL_SPEED,
  RAMP_VELOCITY,
  SLIDE_TICKS,
  SPEED_SMOOTHING,
  STEER_SMOOTHING,
  STUMBLE_SPEED,
  STUMBLE_TICKS,
  TRAIN_HEIGHT,
  createState,
  step,
} from './sim'
import { InputCursor, validateTrace } from './trace'
import { PULSE_PERIOD, PULSE_WINDOW } from './track'
import { MAX_TICKS, TICK_RATE, type Config, type InputTrace, type Metrics, type Result, type State } from './types'

/**
 * Human-readable rules fingerprint. Every tuning constant that changes the
 * outcome of a trace is part of it, so a retune changes RULES_HASH and old
 * results can never be confused with new ones.
 */
export const RULES = [
  'relay-leg-v5',
  `hz-${TICK_RATE}`,
  `max-ticks-${MAX_TICKS}`,
  `speed-${BASE_SPEED}+flow*${FLOW_SPEED}/stumble-${STUMBLE_SPEED}/rail-${RAIL_SPEED}/pad-${PAD_SPEED}/smooth-${SPEED_SMOOTHING}`,
  `steer-smooth-${STEER_SMOOTHING}`,
  `gravity-${GRAVITY}/jump-${JUMP_VELOCITY}/ramp-${RAMP_VELOCITY}/gap-clear-${GAP_CLEARANCE}`,
  `slide-${SLIDE_TICKS}/stumble-${STUMBLE_TICKS}/fall-stumble-${FALL_STUMBLE_TICKS}/buffer-${ACTION_BUFFER_TICKS}/clean-air-${CLEAN_LANDING_AIR_TICKS}`,
  `heights-low-${LOW_HAZARD_HEIGHT}/drone-${DRONE_HEIGHT}/train-${TRAIN_HEIGHT}/near-${NEAR_MISS_MARGIN}`,
  `flow-${Object.entries(FLOW).map(([name, value]) => `${name}=${value}`).join(',')}`,
  `beat-${PULSE_PERIOD}-ticks/window-${PULSE_WINDOW}/pulse-gates-swap-lanes-each-beat-from-tick-0`,
  'hits-ignored-while-stumbling',
  'actions-impulse-buffered',
  'score-300000-ticks*40+gates*120+pulse*160+near*60+land*40+risk*400-hits*300-falls*500+avgflow*2000',
].join(':')

export const RULES_HASH = sha256(RULES)

export type ReplayConfig = Config & { inputTrace: InputTrace }

export function score(state: Readonly<State>): number {
  if (state.dist < state.track.finishDist) return 0
  const m: Readonly<Metrics> = state.metrics
  const ticks = Math.max(1, state.tick)
  const averageFlowBonus = Math.trunc(m.flowSum * 2000 / (ticks * ONE))
  const total = 300000
    - ticks * 40
    + m.perfectGates * 120
    + m.pulseHits * 160
    + m.nearMisses * 60
    + m.cleanLandings * 40
    + m.riskRoutes * 400
    - m.hits * 300
    - m.falls * 500
    + averageFlowBonus
  return Math.max(0, total)
}

export function finalize(state: State, inputTrace: InputTrace): Result {
  if (!state.finished) throw new RangeError('Leg not finished')
  const validation = validateTrace(inputTrace, state.tick)
  if (!validation.ok) throw new RangeError(validation.error.code)
  return {
    resultHash: sha256(canonicalJSON({ rules: RULES_HASH, state, inputTrace })),
    ticks: state.tick,
    timeMs: Math.trunc(state.tick * 1000 / TICK_RATE),
    completed: state.dist >= state.track.finishDist,
    score: score(state),
    metrics: state.metrics,
  }
}

/** Server verification: validate the trace, rebuild the leg from config and run it to the end. */
export function replay(config: ReplayConfig): Result {
  const validation = validateTrace(config.inputTrace)
  if (!validation.ok) throw new RangeError(validation.error.code)
  const { inputTrace: _inputTrace, ...legConfig } = config
  void _inputTrace
  const cursor = new InputCursor(validation.trace)
  let state = createState(legConfig)
  while (!state.finished) state = step(state, cursor.at(state.tick))
  return finalize(state, validation.trace)
}
