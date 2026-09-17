import { ONE } from '../fixed-point'
import { canonicalJSON, sha256 } from '../replay/hash'
import * as tuning from './constants'
import { createState, step } from './sim'
import { InputCursor, validateTrace } from './trace'
import { PULSE_PERIOD, PULSE_WINDOW } from './track'
import { MAX_TICKS, TICK_RATE, type Config, type InputTrace, type Metrics, type Result, type State } from './types'

const table = (values: Readonly<Record<string, number>>): string =>
  Object.entries(values).map(([name, value]) => `${name}=${value}`).join(',')

/**
 * Human-readable rules fingerprint. Every tuning constant that changes the outcome of a
 * trace is part of it, so a retune changes RULES_HASH and old results can never be
 * confused with new ones.
 */
export const RULES = [
  'relay-leg-v6',
  `hz-${TICK_RATE}`,
  `max-ticks-${MAX_TICKS}`,
  `lanes-shoulder-line-${tuning.SHOULDER_LINE}/edge-overshoot-${tuning.EDGE_OVERSHOOT}/nudge-${tuning.NUDGE_STEP}`,
  `speed-${tuning.BASE_SPEED}+flow*${tuning.FLOW_SPEED}/rush-${tuning.RUSH_SPEED}/stumble-${tuning.STUMBLE_SPEED}/rail-${tuning.RAIL_SPEED}/pad-${tuning.PAD_SPEED}`
    + `/shoulder-drag-${tuning.SHOULDER_DRAG}/grind-drag-${tuning.GRIND_DRAG}/respawn-${tuning.RESPAWN_SPEED}/smooth-${tuning.SPEED_SMOOTHING}`,
  `lane-spring-pole-${tuning.LANE_POLE_SLOW}..${tuning.LANE_POLE_FAST}/acquire-${tuning.ACQUIRE_DISTANCE}@${tuning.ACQUIRE_SPEED}`
    + `/hard-impact-${tuning.HARD_IMPACT_SPEED}/hard-landing-${tuning.HARD_LANDING_SPEED}/deflect-${tuning.HIT_DEFLECT_SPEED}`
    + `/wall-bounce-${tuning.WALL_BOUNCE_SPEED}/edge-release-${tuning.EDGE_RELEASE_SPEED}/wind-offset-${tuning.GUST_OFFSET_TICKS}`,
  `gravity-${tuning.GRAVITY}/jump-${tuning.JUMP_VELOCITY}/ramp-${tuning.RAMP_VELOCITY}/cut-${tuning.CUT_LAUNCH_VELOCITY}/stall-${tuning.STALL_LAUNCH_VELOCITY}/gap-clear-${tuning.GAP_CLEARANCE}`,
  `slide-${tuning.SLIDE_TICKS}/stumble-${tuning.STUMBLE_TICKS}/wall-stumble-${tuning.WALL_STUMBLE_TICKS}/respawn-stumble-${tuning.RESPAWN_STUMBLE_TICKS}`
    + `/buffer-${tuning.ACTION_BUFFER_TICKS}/clean-air-${tuning.CLEAN_LANDING_AIR_TICKS}/fall-${tuning.FALL_TICKS}/tether-${tuning.TETHER_TICKS}`
    + `/rush-${tuning.RUSH_TICKS}/grind-window-${table(tuning.GRIND_WINDOW_TICKS)}/lane-reward-${tuning.LANE_CHANGE_REWARD_TICKS}`,
  `heights-low-${tuning.LOW_HAZARD_HEIGHT}/hit-margin-${tuning.HIT_MARGIN}/near-${tuning.NEAR_MISS_CLEARANCE}/machine-${tuning.MACHINE_HALF}/vehicle-${tuning.VEHICLE_HALF}`,
  `events-machine-warn-${tuning.MACHINE_WARN_TICKS}/transit-warn-${tuning.TRANSIT_WARN_TICKS}/gantry-fall-${tuning.GANTRY_FALL_TICKS}`
    + `/drone-hop-${tuning.DRONE_HOP_TICKS}/crosswind-blow-${tuning.CROSSWIND_BLOW_FIFTHS}of5`,
  `ghost-step-${tuning.GHOSTLINE_STEP}/draft-${tuning.DRAFT_RANGE}@${tuning.DRAFT_MAX_LEAD_TICKS}/lead-margin-${tuning.GHOST_LEAD_MARGIN}`,
  `flow-${table(tuning.FLOW)}`,
  `beat-${PULSE_PERIOD}-ticks/window-${PULSE_WINDOW}/pulse-gates-swap-lanes-each-beat-from-tick-0`,
  'hits-ignored-while-stumbling',
  'actions-impulse-buffered/shift-impulse',
  'score-300000-ticks*40+gates*120+pulse*160+near*60+land*40+risk*400+saves*200+overtakes*150+rushes*300'
    + '-hits*300-falls*500-hard*100+avgflow*2000/failed-0',
].join(':')

export const RULES_HASH = sha256(RULES)

export type ReplayConfig = Config & { inputTrace: InputTrace }

/** Time dominates; clean play and saves add a little; a failed or unfinished leg scores 0. */
export function score(state: Readonly<State>): number {
  if (state.dist < state.track.finishDist || state.motion === 'failed') return 0
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
    + m.edgeSaves * 200
    + m.overtakes * 150
    + m.rushes * 300
    - m.hits * 300
    - m.falls * 500
    - m.hardLandings * 100
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
    completed: state.dist >= state.track.finishDist && state.motion !== 'failed',
    failed: state.motion === 'failed',
    score: score(state),
    metrics: state.metrics,
    moments: state.moments,
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
