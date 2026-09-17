import { describe, expect, it } from 'vitest'
import { ONE } from '../fixed-point'
import { sha256 } from '../replay/hash'
import {
  BASE_SPEED,
  FALL_TICKS,
  FLOW,
  GHOSTLINE_STEP,
  GHOST_LEAD_MARGIN,
  GRIND_WINDOW_TICKS,
  LANE_WIDTH,
  NUDGE_STEP,
  RESPAWN_SPEED,
  RUSH_TICKS,
  SHOULDER_LINE,
  SHOULDER_WIDTH,
  STUMBLE_SPEED,
  STUMBLE_TICKS,
  TETHER_TICKS,
} from './constants'
import { eventState, hazardLaneAt, onBeat, pulseGateLane } from './dynamics'
import { checkpointBefore, laneCenterX, pathOffsetAt } from './geometry'
import { deriveGhostline, ghostlineAt } from './ghostline'
import { RULES, RULES_HASH, finalize, replay, score } from './result'
import { createState, step } from './sim'
import { idleBot, playLeg, skilledBot, sloppyBot } from './test-bots'
import { PULSE_PERIOD, PULSE_WINDOW } from './track'
import { InputCursor, MAX_TRACE_BYTES, validateTrace } from './trace'
import {
  ACTION_JUMP,
  ACTION_NONE,
  ACTION_SLIDE,
  EVENT,
  MAX_MOMENTS,
  MAX_OPENING_FLOW,
  MAX_TICKS,
  WORLDS,
  type Config,
  type Fork,
  type Gate,
  type Ghostline,
  type Hazard,
  type HazardKind,
  type Input,
  type Sample,
  type Segment,
  type State,
  type Tier,
  type Track,
  type WorldEvent,
  type WorldEventKind,
  type Zone,
} from './types'

const M = ONE
const CONFIG: Config = {
  engineVersion: '6',
  challenge: 'relay-leg',
  challengeVersion: '6',
  seed: 'rules',
  world: 'coast',
  tier: 1,
  openingFlow: 0,
  tetherSaves: 1,
  ghostline: null,
}
const NONE: Input = { shift: 0, nudge: 0, action: ACTION_NONE }
const LEFT: Input = { shift: -1, nudge: 0, action: ACTION_NONE }
const RIGHT: Input = { shift: 1, nudge: 0, action: ACTION_NONE }
const JUMP: Input = { shift: 0, nudge: 0, action: ACTION_JUMP }
const SLIDE: Input = { shift: 0, nudge: 0, action: ACTION_SLIDE }
const HALF_WIDTH = Math.trunc(3 * LANE_WIDTH / 2) + SHOULDER_WIDTH

// ---------------------------------------------------------------------------
// Synthetic tracks isolate one rule at a time from authored content.
// A 3-lane road with railed edges, one fork at 400-500 m (safe: 2 lanes, risk: 1 open lane).
// ---------------------------------------------------------------------------

function segment(index: number, from: number, to: number, patch: Partial<Segment> = {}): Segment {
  return {
    index,
    module: 'test.straight.a',
    kind: 'straight',
    from: from * M,
    to: to * M,
    elevationFrom: 0,
    elevationTo: 0,
    laneCount: 3,
    laneWidth: LANE_WIDTH,
    shoulder: SHOULDER_WIDTH,
    leftEdge: 'rail',
    rightEdge: 'rail',
    bend: 0,
    ...patch,
  }
}

const FORK: Fork = {
  index: 0,
  from: 400 * M,
  to: 500 * M,
  riskSide: 1,
  riskProgress: Math.trunc(130 * ONE / 100),
  separation: 14 * M,
  safeLanes: 2,
  riskLanes: 1,
  safeEdges: { left: 'rail', right: 'rail' },
  riskEdges: { left: 'open', right: 'open' },
  label: 'shortcut',
}

function testTrack(overrides: Partial<Track> = {}): Track {
  return {
    world: 'coast',
    tier: 1,
    finishDist: 600 * M,
    segments: [segment(0, 0, 400), segment(1, 400, 500, { kind: 'fork', laneCount: 2 }), segment(2, 500, 600)],
    forks: [FORK],
    gates: [],
    hazards: [],
    events: [],
    ramps: [],
    gaps: [],
    rails: [],
    boostPads: [],
    pulse: { from: 550 * M, to: 580 * M, period: PULSE_PERIOD, window: PULSE_WINDOW },
    setPieces: [],
    checkpoints: [
      { dist: 0, path: 'main', lane: 0 },
      { dist: 200 * M, path: 'main', lane: 0 },
      { dist: 400 * M, path: 'safe', lane: 1 },
      { dist: 400 * M, path: 'risk', lane: 0 },
    ],
    ...overrides,
  }
}

function hazardAt(kind: HazardKind, metres: number, lanes: readonly number[], patch: Partial<Hazard> = {}): Hazard {
  return { dist: metres * M, kind, path: 'main', lanes, period: 0, phase: 0, amplitude: 0, length: 0, ...patch }
}

function zoneAt(from: number, to: number, lanes: readonly number[], patch: Partial<Zone> = {}): Zone {
  return { from: from * M, to: to * M, lanes, path: 'main', ...patch }
}

function eventAt(kind: WorldEventKind, metres: number, patch: Partial<WorldEvent> = {}): WorldEvent {
  return { id: 0, kind, path: 'main', dist: metres * M, length: 0, triggerDist: (metres - 50) * M, duration: 30, lanes: [], period: 0, amplitude: 0, count: 0, ...patch }
}

function gateAt(metres: number, lane: number, patch: Partial<Gate> = {}): Gate {
  return { dist: metres * M, lane, kind: 'gold', path: 'main', period: 0, ...patch }
}

function stateOn(track: Track, patch: Partial<State> = {}): State {
  const base = createState(CONFIG)
  return {
    ...base,
    track,
    eventTicks: track.events.map(() => -1),
    forkChoices: track.forks.map(() => 0 as const),
    ...patch,
  }
}

/** Steps `ticks` times; `inputAt` receives the index of the step (0 = first). */
function simulate(state: State, ticks: number, inputAt: (index: number) => Input = () => NONE): State[] {
  const states: State[] = []
  let current = state
  for (let i = 0; i < ticks && !current.finished; i++) {
    current = step(current, inputAt(i))
    states.push(current)
  }
  return states
}

const firstThen = (first: Input) => (index: number): Input => (index === 0 ? first : NONE)
const allEvents = (states: readonly State[]): number => states.reduce((events, state) => events | state.events, 0)
const indexOfEvent = (states: readonly State[], event: number): number => states.findIndex(state => (state.events & event) !== 0)
const countEvent = (states: readonly State[], event: number): number => states.filter(state => (state.events & event) !== 0).length

function stateWithEvent(states: readonly State[], event: number): State {
  const found = states.find(state => (state.events & event) !== 0)
  if (!found) throw new Error(`event ${event} never fired`)
  return found
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function unsafeNumbers(value: unknown, path = 'state'): string[] {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? [] : [`${path}=${value}`]
  if (value === null || typeof value !== 'object') return typeof value === 'undefined' ? [`${path} is undefined`] : []
  return Object.entries(value).flatMap(([key, child]) => unsafeNumbers(child, `${path}.${key}`))
}

/** A courier held on the shoulder line of the right edge, ready to touch the rail. */
function onRightShoulder(track: Track, patch: Partial<State> = {}): State {
  const x = Math.trunc(3 * LANE_WIDTH / 2) + SHOULDER_LINE
  return stateOn(track, { x, lane: 3, targetLane: 3, dist: 100 * M, ...patch })
}

// ---------------------------------------------------------------------------
// Config, input and purity
// ---------------------------------------------------------------------------

describe('relay leg config and input', () => {
  it('starts in the centre lane of the main path at tick 0 with the inherited opening FLOW', () => {
    // #given a config carrying a mid-range opening flow and a tether save
    // #when creating the leg
    const state = createState({ ...CONFIG, openingFlow: 12000 })
    // #then the courier stands at the start, settled in the centre lane
    expect([state.tick, state.dist, state.path, state.lane, state.targetLane, state.x, state.flow, state.motion, state.tetherSaves, state.finished])
      .toEqual([0, 0, 'main', 0, 0, 0, 12000, 'riding', 1, 0])
  })

  it('rejects opening FLOW above MAX_OPENING_FLOW, negative or fractional', () => {
    for (const openingFlow of [MAX_OPENING_FLOW + 1, -1, 0.5, Number.NaN]) {
      expect(() => createState({ ...CONFIG, openingFlow }), String(openingFlow)).toThrow(RangeError)
    }
    expect(createState({ ...CONFIG, openingFlow: MAX_OPENING_FLOW }).flow).toBe(MAX_OPENING_FLOW)
  })

  it('rejects wrong versions, unknown worlds, tiers, bad seeds and tether saves', () => {
    const invalid: unknown[] = [
      { ...CONFIG, engineVersion: '5' },
      { ...CONFIG, challengeVersion: '5' },
      { ...CONFIG, challenge: 'station-race' },
      { ...CONFIG, world: 'moon' },
      { ...CONFIG, tier: 3 },
      { ...CONFIG, seed: '' },
      { ...CONFIG, seed: 'x'.repeat(129) },
      { ...CONFIG, tetherSaves: 2 },
      { ...CONFIG, tetherSaves: -1 },
    ]
    for (const config of invalid) expect(() => createState(config as Config), JSON.stringify(config).slice(0, 80)).toThrow(RangeError)
  })

  it('rejects malformed ghostlines', () => {
    const good: Ghostline = { step: GHOSTLINE_STEP, path: [0, 0], x: [0, 10], tick: [0, 9] }
    const invalid: unknown[] = [
      { ...good, step: GHOSTLINE_STEP + 1 },
      { ...good, x: [0] },
      { ...good, tick: [5, 4] },
      { ...good, path: [0, 3] },
      { ...good, x: [0, 0.5] },
      { ...good, x: [0, 100000] },
      { ...good, tick: [0, MAX_TICKS + 1] },
      { step: GHOSTLINE_STEP, path: [], x: [], tick: [] },
    ]
    expect(createState({ ...CONFIG, ghostline: good }).config.ghostline).toEqual(good)
    for (const ghostline of invalid) expect(() => createState({ ...CONFIG, ghostline } as Config), JSON.stringify(ghostline)).toThrow(RangeError)
  })

  it('rejects shifts other than -1/0/1, nudges outside -8..8 or fractional, and unknown actions', () => {
    const state = createState(CONFIG)
    const invalid: unknown[] = [
      { shift: 2, nudge: 0, action: 0 },
      { shift: 0.5, nudge: 0, action: 0 },
      { shift: 0, nudge: 9, action: 0 },
      { shift: 0, nudge: -9, action: 0 },
      { shift: 0, nudge: 1.5, action: 0 },
      { shift: 0, nudge: 0, action: 3 },
    ]
    for (const input of invalid) expect(() => step(state, input as Input), JSON.stringify(input)).toThrow(RangeError)
  })

  it('never mutates the state it steps from', () => {
    // #given a deeply frozen live state a few seconds into a real leg
    let state = createState({ ...CONFIG, world: 'metro' })
    for (let i = 0; i < 240; i++) state = step(state, { shift: i % 40 === 0 ? 1 : i % 40 === 20 ? -1 : 0, nudge: (i % 17) - 8, action: i % 50 === 0 ? ACTION_JUMP : ACTION_NONE })
    const before = JSON.stringify(state)
    deepFreeze(state)
    // #when stepping from it
    const next = step(state, RIGHT)
    // #then the original is untouched and a new state is returned
    expect(JSON.stringify(state)).toBe(before)
    expect(next).not.toBe(state)
    expect(next.tick).toBe(state.tick + 1)
  })

  it('keeps every number in a finished leg a safe integer, track and ghostline included', () => {
    for (const world of WORLDS) {
      // #given full legs raced against a ghost by the skilled and the sloppy courier
      const config = { ...CONFIG, world, seed: `integers-${world}` }
      const ghostline = deriveGhostline(config, playLeg(config, sloppyBot('safe')).trace)
      const { state } = playLeg({ ...config, ghostline }, skilledBot('risk'))
      // #then no float, NaN or undefined leaked into the authoritative state
      expect(unsafeNumbers(state), world).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

describe('relay leg lanes', () => {
  it('changes lane in 12-18 ticks: LANE_SHIFT on the press, LANE_ACQUIRED on arrival', () => {
    for (const flow of [0, ONE - 1]) {
      // #given a settled courier in the centre lane, slow and fast
      const start = stateOn(testTrack(), { flow, speed: BASE_SPEED + Math.trunc(flow * 30 / 100) })
      // #when shifting right once
      const states = simulate(start, 40, firstThen(RIGHT))
      const acquired = indexOfEvent(states, EVENT.LANE_ACQUIRED)
      // #then the shift fires at once and the lane is acquired 200-300 ms later, on the lane centre
      expect(states[0]!.events & EVENT.LANE_SHIFT).toBe(EVENT.LANE_SHIFT)
      expect(states[0]!.targetLane).toBe(2)
      expect(acquired + 1, `flow ${flow}`).toBeGreaterThanOrEqual(12)
      expect(acquired + 1, `flow ${flow}`).toBeLessThanOrEqual(18)
      expect(states[acquired]!.lane).toBe(2)
      expect(Math.abs(states.at(-1)!.x - laneCenterX(2))).toBeLessThan(Math.trunc(M / 100))
    }
  })

  it('changes lane faster at high speed', () => {
    const ticksToAcquire = (speed: number): number => indexOfEvent(simulate(stateOn(testTrack(), { speed }), 40, firstThen(RIGHT)), EVENT.LANE_ACQUIRED)
    expect(ticksToAcquire(BASE_SPEED + 30 * M / 100)).toBeLessThan(ticksToAcquire(BASE_SPEED))
  })

  it('magnetizes a courier with neutral nudge back to its lane centre', () => {
    // #given a courier knocked 0.9 m off the centre of its lane
    const states = simulate(stateOn(testTrack(), { x: Math.trunc(9 * M / 10) }), 30)
    // #then it settles on the centre without changing lanes
    expect(Math.abs(states.at(-1)!.x)).toBeLessThan(Math.trunc(M / 100))
    expect(allEvents(states) & (EVENT.LANE_SHIFT | EVENT.LANE_ACQUIRED)).toBe(0)
  })

  it('holds a nudge as a small offset inside the lane', () => {
    const states = simulate(stateOn(testTrack()), 40, () => ({ shift: 0, nudge: 8, action: 0 }))
    expect(Math.abs(states.at(-1)!.x - 8 * NUDGE_STEP)).toBeLessThan(Math.trunc(M / 100))
    expect(states.at(-1)!.lane).toBe(0)
  })

  it('retargets from the target lane when shifting again mid-change', () => {
    // #given a courier in the left lane
    const start = stateOn(testTrack(), { x: laneCenterX(-2), lane: -2, targetLane: -2 })
    // #when shifting right on two consecutive ticks
    const states = simulate(start, 60, index => (index < 2 ? RIGHT : NONE))
    // #then the target moves two lanes and the courier settles in the right lane
    expect(states[1]!.targetLane).toBe(2)
    expect(states.at(-1)!.lane).toBe(2)
    expect(states.at(-1)!.metrics.laneChanges).toBe(2)
  })

  it('never leaves the courier floating between lanes', () => {
    // #given shifts pressed at every phase of an earlier change
    for (let second = 1; second < 16; second++) {
      const states = simulate(stateOn(testTrack()), 60, index => (index === 0 ? RIGHT : index === second ? LEFT : NONE))
      const last = states.at(-1)!
      // #then within a second the courier sits on a lane centre with lane === targetLane
      expect(last.lane, `second shift at ${second}`).toBe(last.targetLane)
      expect(Math.abs(last.x - laneCenterX(last.lane)), `second shift at ${second}`).toBeLessThan(Math.trunc(8 * M / 100))
    }
  })

  it('pays a clean lane change a little FLOW, at most about once a second', () => {
    // #given a courier shifting back and forth every 20 ticks for 10 seconds
    const states = simulate(stateOn(testTrack(), { flow: 30000 }), 600, index => (index % 40 === 0 ? RIGHT : index % 40 === 20 ? LEFT : NONE))
    const last = states.at(-1)!
    // #then every change counts as clean but the FLOW it pays is budgeted to one per 60 ticks
    expect(last.metrics.cleanLaneChanges).toBe(30)
    const paid = Math.trunc(600 / 60) + 1
    const baseline = simulate(stateOn(testTrack(), { flow: 30000 }), 600).at(-1)!
    expect(last.flow - baseline.flow).toBeLessThanOrEqual(paid * FLOW.CLEAN_LANE_CHANGE)
    expect(last.flow).toBeGreaterThan(baseline.flow)
  })
})

// ---------------------------------------------------------------------------
// Road edges
// ---------------------------------------------------------------------------

describe('relay leg road edges', () => {
  it('shifts from the outer lane onto the shoulder, which drags speed and drains FLOW', () => {
    // #given a courier in the right lane with FLOW to lose
    const start = stateOn(testTrack(), { x: laneCenterX(2), lane: 2, targetLane: 2, flow: 30000 })
    // #when shifting right once more
    const states = simulate(start, 90, firstThen(RIGHT))
    const inLane = simulate(start, 90).at(-1)!
    const last = states.at(-1)!
    // #then it settles on the shoulder line, 0.6 m past the lane edge, slower and with less FLOW
    expect(states[0]!.targetLane).toBe(3)
    expect(countEvent(states, EVENT.SHOULDER)).toBe(1)
    expect(Math.abs(last.x - (Math.trunc(3 * LANE_WIDTH / 2) + SHOULDER_LINE))).toBeLessThan(Math.trunc(M / 100))
    expect([last.lane, last.motion]).toEqual([3, 'riding'])
    expect(last.speed).toBeLessThan(inLane.speed)
    expect(last.flow).toBeLessThan(inLane.flow)
  })

  it('grinds the rail when shifting outward again from the shoulder', () => {
    // #when shifting right from the shoulder
    const states = simulate(onRightShoulder(testTrack()), 20, firstThen(RIGHT))
    const grind = stateWithEvent(states, EVENT.EDGE_GRIND)
    // #then the courier is pinned to the rail with the tier's recovery window
    expect([grind.motion, grind.edgeSide, grind.x, grind.motionTicks]).toEqual(['grinding', 1, HALF_WIDTH, GRIND_WINDOW_TICKS[1]])
    expect(grind.metrics.edgeGrinds).toBe(1)
  })

  it('sets the recovery window by tier', () => {
    expect(GRIND_WINDOW_TICKS).toEqual({ 0: 55, 1: 40, 2: 32 })
    for (const tier of [0, 1, 2] as const) {
      const grind = stateWithEvent(simulate(onRightShoulder(testTrack({ tier })), 20, firstThen(RIGHT)), EVENT.EDGE_GRIND)
      expect(grind.motionTicks).toBe(GRIND_WINDOW_TICKS[tier])
    }
  })

  it('costs more FLOW for a hard rail impact than for a soft touch', () => {
    const flow = 50000
    const soft = stateWithEvent(simulate(onRightShoulder(testTrack(), { flow }), 20, firstThen(RIGHT)), EVENT.EDGE_GRIND)
    const hard = stateWithEvent(simulate(stateOn(testTrack(), { flow, x: laneCenterX(2), lane: 2, targetLane: 2, dist: 100 * M }), 30, index => (index < 2 ? RIGHT : NONE)), EVENT.EDGE_GRIND)
    expect(flow - soft.flow).toBeLessThan(flow - hard.flow)
    expect(flow - hard.flow).toBeGreaterThanOrEqual(FLOW.RAIL_IMPACT)
  })

  it('saves the edge when steering inward inside the window', () => {
    for (const release of [LEFT, { shift: 0, nudge: -3, action: 0 } satisfies Input]) {
      // #given a courier grinding the right rail
      const grinding = stateWithEvent(simulate(onRightShoulder(testTrack(), { flow: 30000 }), 10, firstThen(RIGHT)), EVENT.EDGE_GRIND)
      // #when steering or nudging inward ten ticks later
      const states = simulate(grinding, 60, index => (index === 10 ? release : NONE))
      const saved = stateWithEvent(states, EVENT.EDGE_SAVE)
      // #then it rides away from the rail with an edge-save moment and back into its outer lane
      expect([saved.motion, saved.edgeSide, saved.metrics.edgeSaves]).toEqual(['riding', 0, 1])
      expect(saved.moments.map(moment => moment.kind)).toEqual(['edge-save'])
      expect(allEvents(states) & EVENT.FALL).toBe(0)
      expect(states.at(-1)!.lane).toBe(2)
    }
  })

  it('pays the edge save FLOW', () => {
    const grinding = stateWithEvent(simulate(onRightShoulder(testTrack(), { flow: 30000 }), 10, firstThen(RIGHT)), EVENT.EDGE_GRIND)
    const saved = step(grinding, LEFT)
    const held = step(grinding, NONE)
    // #then the save pays, minus the shoulder drain the courier rides through on its way back
    expect(saved.flow - held.flow).toBe(FLOW.EDGE_SAVE + FLOW.GRIND_TICK - FLOW.SHOULDER_TICK)
  })

  it('goes over the rail when the window expires or the courier shifts outward', () => {
    const grinding = stateWithEvent(simulate(onRightShoulder(testTrack()), 10, firstThen(RIGHT)), EVENT.EDGE_GRIND)
    const expired = simulate(grinding, GRIND_WINDOW_TICKS[1] + 2)
    const outward = step(grinding, RIGHT)
    expect(indexOfEvent(expired, EVENT.FALL)).toBe(GRIND_WINDOW_TICKS[1] - 1)
    expect([outward.motion, outward.events & EVENT.FALL, outward.edgeSide]).toEqual(['falling', EVENT.FALL, 1])
  })

  it('drops the courier straight over an open edge', () => {
    // #given an open right edge
    const track = testTrack({ segments: [segment(0, 0, 600, { rightEdge: 'open' })], forks: [] })
    // #when shifting past it from the shoulder
    const states = simulate(onRightShoulder(track), 20, firstThen(RIGHT))
    // #then there is no grind, only a fall
    expect(allEvents(states) & EVENT.EDGE_GRIND).toBe(0)
    expect(stateWithEvent(states, EVENT.FALL).motion).toBe('falling')
  })

  it('bounces off a wall back toward the outer lane without a fall', () => {
    const track = testTrack({ segments: [segment(0, 0, 600, { rightEdge: 'wall' })], forks: [] })
    const states = simulate(onRightShoulder(track, { flow: 30000 }), 90, firstThen(RIGHT))
    const bump = stateWithEvent(states, EVENT.EDGE_GRIND)
    expect([bump.motion, bump.targetLane]).toEqual(['riding', 2])
    expect(bump.stumbleTicks).toBeGreaterThan(0)
    expect(allEvents(states) & EVENT.FALL).toBe(0)
    expect(states.at(-1)!.lane).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Falls and the baton tether
// ---------------------------------------------------------------------------

describe('relay leg falls and tether', () => {
  const gapTrack = testTrack({ gaps: [zoneAt(250, 262, [-2, 0, 2])] })
  const beforeGap = { dist: 249 * M, speed: M }

  it('falls into a gap ridden on the ground: FLOW -45%, frozen distance, dropping height', () => {
    const flow = 40000
    const states = simulate(stateOn(gapTrack, { ...beforeGap, flow }), 40)
    const fell = indexOfEvent(states, EVENT.FALL)
    const falling = states[fell]!
    expect(fell).toBeGreaterThanOrEqual(0)
    expect([falling.motion, falling.motionTicks, falling.metrics.falls]).toEqual(['falling', FALL_TICKS, 1])
    expect(states[fell + 20]!.dist).toBe(falling.dist)
    expect(states[fell + 20]!.y).toBeLessThan(-M)
    expect(simulate(stateOn(testTrack(), { ...beforeGap, flow }), 40)[fell]!.flow - falling.flow).toBe(FLOW.FALL)
  })

  it('carries an airborne courier over a gap but drops one that lands inside it', () => {
    const shortGap = simulate(stateOn(testTrack({ gaps: [zoneAt(101, 103, [-2, 0, 2])] }), { dist: 100 * M, y: 2 * M }), 60)
    const longGap = simulate(stateOn(testTrack({ gaps: [zoneAt(101, 160, [-2, 0, 2])] }), { dist: 100 * M, y: 2 * M }), 60)
    expect(allEvents(shortGap) & (EVENT.FALL | EVENT.LAND)).toBe(EVENT.LAND)
    expect(allEvents(longGap) & EVENT.FALL).toBe(EVENT.FALL)
  })

  it('saves a fall with the tether and respawns at the checkpoint behind it, on the clock', () => {
    // #given a courier with a tether save riding into a gap
    const start = stateOn(gapTrack, { ...beforeGap, flow: 40000, rushTicks: 0 })
    // #when the fall and the tether play out
    const states = simulate(start, FALL_TICKS + TETHER_TICKS + 10)
    const fell = indexOfEvent(states, EVENT.FALL)
    const saved = indexOfEvent(states, EVENT.TETHER_SAVE)
    const respawned = states[saved + TETHER_TICKS]!
    const flowAfterFall = states[fell]!.flow
    // #then the tether takes over after the fall, and the courier respawns at 200 m on its lane
    expect(saved - fell).toBe(FALL_TICKS)
    expect([states[saved]!.motion, states[saved]!.tetherSaves, states[saved]!.metrics.tetherSaves]).toEqual(['tethering', 0, 1])
    expect(states[saved]!.moments.map(moment => moment.kind)).toEqual(['tether-save'])
    expect([respawned.motion, respawned.dist, respawned.path, respawned.lane, respawned.x, respawned.y]).toEqual(['riding', 200 * M, 'main', 0, 0, 0])
    expect(respawned.speed).toBe(RESPAWN_SPEED)
    expect(respawned.flow).toBeLessThanOrEqual(Math.trunc(flowAfterFall / 2))
    expect(respawned.tick).toBe(start.tick + fell + 1 + FALL_TICKS + TETHER_TICKS)
  })

  it('fails the leg when a fall has no tether save left', () => {
    // #given a courier without tether saves riding into a gap
    const start = stateOn(gapTrack, { ...beforeGap, tetherSaves: 0 })
    const states = simulate(start, FALL_TICKS + 20)
    const failed = stateWithEvent(states, EVENT.LEG_FAILED)
    // #then the leg ends when the fall does, failed and scoreless
    expect([failed.motion, failed.finished]).toEqual(['failed', 1])
    expect(indexOfEvent(states, EVENT.LEG_FAILED) - indexOfEvent(states, EVENT.FALL)).toBe(FALL_TICKS)
    const result = finalize(failed, [[0, 0, 0, 0]])
    expect([result.completed, result.failed, result.score]).toEqual([false, true, 0])
  })

  it('re-arms hazards between the checkpoint and the fall, but never re-scores gates', () => {
    // #given a gate and a barrier between the checkpoint at 200 m and a gap at 250 m
    const track = testTrack({ gaps: gapTrack.gaps, gates: [gateAt(220, 0)], hazards: [hazardAt('barrier', 235, [0])] })
    // #when the courier jumps the barrier, falls, respawns and rides the stretch again
    const states = simulate(stateOn(track, { dist: 201 * M, speed: M }), 400, index => (index === 25 ? JUMP : NONE))
    const last = states.at(-1)!
    // #then the barrier can hit again after the respawn while the gate counted once
    expect(last.metrics.totalGates).toBe(1)
    expect(countEvent(states, EVENT.TETHER_SAVE)).toBe(1)
    expect(last.metrics.hits).toBe(1)
  })

  it('respawns on the fork path it fell from, or before the fork when that path has no checkpoint', () => {
    const track = testTrack()
    expect(checkpointBefore(track, 450 * M, 'safe')).toEqual({ dist: 400 * M, path: 'safe', lane: 1 })
    expect(checkpointBefore(track, 450 * M, 'risk')).toEqual({ dist: 400 * M, path: 'risk', lane: 0 })
    const noRiskCheckpoint = { ...track, checkpoints: track.checkpoints.filter(checkpoint => checkpoint.path !== 'risk') }
    expect(checkpointBefore(noRiskCheckpoint, 450 * M, 'risk')).toEqual({ dist: 200 * M, path: 'main', lane: 0 })
    expect(checkpointBefore(track, 550 * M, 'main')).toEqual({ dist: 200 * M, path: 'main', lane: 0 })
  })
})

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

describe('relay leg hazards', () => {
  const centreBarrier = testTrack({ hazards: [hazardAt('barrier', 106, [0])] })
  const at = { dist: 100 * M }

  it('hits a grounded courier in a blocked lane: FLOW -30%, stumble, speed drop, shove toward a free lane', () => {
    const flow = 40000
    const states = simulate(stateOn(centreBarrier, { ...at, flow, x: Math.trunc(M / 5) }), 30)
    const baseline = simulate(stateOn(testTrack(), { ...at, flow, x: Math.trunc(M / 5) }), 30)
    const hitIndex = indexOfEvent(states, EVENT.HIT)
    const hit = states[hitIndex]!
    expect(hitIndex).toBeGreaterThan(0)
    expect(baseline[hitIndex]!.flow - hit.flow).toBe(FLOW.HIT)
    expect([hit.stumbleTicks, hit.metrics.hits, hit.targetLane]).toEqual([STUMBLE_TICKS, 1, 0])
    expect(hit.speed).toBeLessThanOrEqual(STUMBLE_SPEED)
    expect(hit.vx).toBeGreaterThan(baseline[hitIndex]!.vx)
  })

  it('passes a blocked lane from the next lane, with a near miss only when it cuts close', () => {
    const crossingNow = { dist: 106 * M - 1000, speed: M }
    const wide = simulate(stateOn(centreBarrier, { ...at, x: laneCenterX(2), lane: 2, targetLane: 2 }), 30)
    const close = simulate(stateOn(centreBarrier, { ...crossingNow, x: Math.trunc(LANE_WIDTH / 2), lane: 2, targetLane: 2 }), 3)
    expect(allEvents(wide) & (EVENT.NEAR_MISS | EVENT.HIT)).toBe(0)
    expect(allEvents(close) & (EVENT.NEAR_MISS | EVENT.HIT)).toBe(EVENT.NEAR_MISS)
  })

  it('clears a barrier with a jump for a near miss', () => {
    const states = simulate(stateOn(centreBarrier, at), 30, firstThen(JUMP))
    expect(allEvents(states) & (EVENT.HIT | EVENT.NEAR_MISS)).toBe(EVENT.NEAR_MISS)
  })

  it('needs a slide under a beam, and jumping into one is a hit', () => {
    const track = testTrack({ hazards: [hazardAt('beam', 106, [0])] })
    expect(allEvents(simulate(stateOn(track, at), 30)) & EVENT.HIT).toBe(EVENT.HIT)
    expect(allEvents(simulate(stateOn(track, at), 30, firstThen(SLIDE))) & (EVENT.HIT | EVENT.NEAR_MISS)).toBe(EVENT.NEAR_MISS)
    expect(allEvents(simulate(stateOn(track, at), 30, firstThen(JUMP))) & EVENT.HIT).toBe(EVENT.HIT)
  })

  it('merges adjacent blocked lanes, so the lane line between them is no way through', () => {
    const track = testTrack({ hazards: [hazardAt('barrier', 106, [0, 2])] })
    const onLine = simulate(stateOn(track, { dist: 106 * M - 1000, speed: M, x: Math.trunc(LANE_WIDTH / 2), lane: 0, targetLane: 2 }), 3)
    expect(allEvents(onLine) & EVENT.HIT).toBe(EVENT.HIT)
  })

  it('closes the shoulders too when every lane is blocked', () => {
    const track = testTrack({ hazards: [hazardAt('barrier', 106, [-2, 0, 2])] })
    const onShoulder = simulate(onRightShoulder(track, { dist: 100 * M }), 30)
    expect(allEvents(onShoulder) & EVENT.HIT).toBe(EVENT.HIT)
  })

  it('ignores further hazards while stumbling', () => {
    const track = testTrack({ hazards: [hazardAt('barrier', 106, [0]), hazardAt('barrier', 112, [-2, 0, 2])] })
    expect(simulate(stateOn(track, at), 40).at(-1)!.metrics.hits).toBe(1)
  })

  it('moves sweepers and drones on an integer triangle wave between their lane centres', () => {
    // #given a sweeper from the left lane to the right lane with a 100 tick period
    const sweeper = hazardAt('sweeper', 0, [-2, 2], { period: 100 })
    // #when sampling two full periods
    const positions = Array.from({ length: 200 }, (_, tick) => hazardLaneAt(sweeper, tick))
    // #then it swings lane to lane, stays in range and repeats exactly
    expect([positions[0], positions[25], positions[50], positions[75]]).toEqual([laneCenterX(-2), 0, laneCenterX(2), 0])
    expect(positions.every(x => Number.isSafeInteger(x) && x >= laneCenterX(-2) && x <= laneCenterX(2))).toBe(true)
    expect(positions.slice(100)).toEqual(positions.slice(0, 100))
  })
})

// ---------------------------------------------------------------------------
// World events
// ---------------------------------------------------------------------------

describe('relay leg world events', () => {
  /** A state `age` ticks after `event` triggered, for reading eventState. */
  function aged(event: WorldEvent, age: number): State {
    return stateOn(testTrack({ events: [event] }), { tick: 1000 + age, eventTicks: [1000] })
  }

  it('triggers on distance, so every courier gets the same telegraph distance', () => {
    const track = testTrack({ events: [eventAt('lane-closure', 150, { triggerDist: 100 * M, length: 40 * M, lanes: [2] })] })
    for (const speed of [BASE_SPEED, M]) {
      const states = simulate(stateOn(track, { dist: 95 * M, speed }), 30)
      const triggered = stateWithEvent(states, EVENT.EVENT_TRIGGERED)
      expect(triggered.eventTicks).toEqual([triggered.tick])
      expect(triggered.dist).toBeGreaterThanOrEqual(100 * M)
      expect(triggered.dist - speed).toBeLessThan(100 * M)
    }
  })

  it('closes lanes after the telegraph and hits a courier who steers into a closed lane mid-span', () => {
    const closure = eventAt('lane-closure', 110, { triggerDist: 60 * M, length: 60 * M, lanes: [2], duration: 30 })
    expect(eventState(closure, aged(closure, 10))).toMatchObject({ phase: 'telegraph', collision: 'none', lanes: [] })
    expect(eventState(closure, aged(closure, 30))).toMatchObject({ phase: 'active', collision: 'low', lanes: [2] })
    // #given a courier inside the closed stretch, in the open centre lane
    const inside = stateOn(testTrack({ events: [closure] }), { dist: 120 * M, tick: 500, eventTicks: [100] })
    // #when it shifts right into the closed lane
    const states = simulate(inside, 60, firstThen(RIGHT))
    const hit = stateWithEvent(states, EVENT.HIT)
    // #then it is hit and knocked back into the free lane for good
    expect(hit.targetLane).toBe(0)
    expect(states.at(-1)!.lane).toBe(0)
  })

  it('drifts a maintenance machine across the road and settles it off the deck', () => {
    const machine = eventAt('maintenance-drone', 120, { duration: 220, lanes: [-5, 5] })
    const early = eventState(machine, aged(machine, 20))
    const middle = eventState(machine, aged(machine, 130))
    const late = eventState(machine, aged(machine, 230))
    expect([early.phase, early.x[0]]).toEqual(['telegraph', laneCenterX(-5)])
    expect([middle.phase, middle.collision, middle.x[0]]).toEqual(['active', 'low', 0])
    expect(middle.lanes).toEqual([0])
    expect([late.phase, late.x[0], late.lanes]).toEqual(['settled', laneCenterX(5), []])
  })

  it('crosses a transit vehicle only while active, over a readable subset of lanes', () => {
    const tram = eventAt('transit-crossing', 120, { duration: 250, lanes: [-6, 6] })
    expect(eventState(tram, aged(tram, 40))).toMatchObject({ phase: 'telegraph', collision: 'none' })
    const crossing = eventState(tram, aged(tram, 150))
    expect([crossing.phase, crossing.collision]).toEqual(['active', 'low'])
    expect(crossing.lanes.length).toBeGreaterThan(0)
    expect(crossing.lanes.length).toBeLessThan(3)
    expect(eventState(tram, aged(tram, 260))).toMatchObject({ phase: 'settled', collision: 'none' })
  })

  it('gusts a crosswind: it builds over the telegraph, blows for 3/5 of its period and lulls', () => {
    const wind = eventAt('crosswind', 100, { length: 100 * M, duration: 40, period: 100, amplitude: 40 })
    expect(eventState(wind, aged(wind, 20)).push).toBe(20)
    expect(eventState(wind, aged(wind, 40 + 10)).push).toBe(40)
    expect(eventState(wind, aged(wind, 40 + 70)).push).toBe(0)
    // #and it pushes a courier inside it downwind
    const states = simulate(stateOn(testTrack({ events: [wind] }), { dist: 101 * M, tick: 1045, eventTicks: [1000] }), 30)
    expect(states.at(-1)!.x).toBeGreaterThan(Math.trunc(M / 2))
  })

  it('sags a gantry overhead, crushes its lanes as it falls, then leaves debris', () => {
    const gantry = eventAt('collapsing-gantry', 106, { duration: 60, lanes: [0, 2] })
    expect(eventState(gantry, aged(gantry, 30))).toMatchObject({ phase: 'telegraph', collision: 'overhead', lanes: [0, 2] })
    expect(eventState(gantry, aged(gantry, 65))).toMatchObject({ phase: 'active', collision: 'crush' })
    expect(eventState(gantry, aged(gantry, 100))).toMatchObject({ phase: 'settled', collision: 'low' })
    const crossing = (age: number, input: Input): number =>
      allEvents(simulate(stateOn(testTrack({ events: [gantry] }), { dist: 105 * M, speed: M, tick: 1000 + age - 1, eventTicks: [1000] }), 3, firstThen(input)))
    expect(crossing(30, SLIDE) & (EVENT.HIT | EVENT.NEAR_MISS)).toBe(EVENT.NEAR_MISS)
    expect(crossing(65, SLIDE) & EVENT.HIT).toBe(EVENT.HIT)
  })

  it('steps a drone formation across the lanes, always leaving one lane free', () => {
    const drones = eventAt('drone-pattern', 120, { duration: 30, lanes: [-2, 0, 2], count: 2, period: 45 })
    for (let age = 30; age < 30 + 45 * 6; age++) {
      const view = eventState(drones, aged(drones, age))
      expect(view.x).toHaveLength(2)
      expect(view.lanes.length, `age ${age}`).toBeLessThan(3)
    }
    expect(eventState(drones, aged(drones, 31)).collision).toBe('overhead')
  })

  it('reports rising bridges and bridge breaks through their telegraph', () => {
    for (const kind of ['rising-bridge', 'bridge-break', 'pulse-tunnel'] as const) {
      const event = eventAt(kind, 120, { duration: 40 })
      expect(eventState(event, stateOn(testTrack({ events: [event] })))).toMatchObject({ phase: 'dormant', progress: 0 })
      expect(eventState(event, aged(event, 20))).toMatchObject({ phase: 'telegraph', progress: ONE / 2, collision: 'none' })
      expect(eventState(event, aged(event, 40))).toMatchObject({ phase: 'active', progress: ONE })
    }
  })
})

// ---------------------------------------------------------------------------
// Forks and the relay cut
// ---------------------------------------------------------------------------

describe('relay leg forks', () => {
  const beforeFork = { dist: 400 * M - 1000, speed: M }

  it('takes the path of the lane nearest the courier at the split, carrying its lane across', () => {
    const risk = step(stateOn(testTrack(), { ...beforeFork, x: laneCenterX(2), lane: 2, targetLane: 2 }), NONE)
    const safe = step(stateOn(testTrack(), beforeFork), NONE)
    const left = step(stateOn(testTrack(), { ...beforeFork, x: laneCenterX(-2), lane: -2, targetLane: -2 }), NONE)
    expect([risk.path, risk.lane, risk.events & EVENT.FORK_RISK, risk.forkChoices]).toEqual(['risk', 0, EVENT.FORK_RISK, [2]])
    expect([safe.path, safe.lane, safe.events & EVENT.FORK_SAFE, safe.forkChoices]).toEqual(['safe', 1, EVENT.FORK_SAFE, [1]])
    expect([left.path, left.lane]).toEqual(['safe', -1])
    // #then the courier's position in main-road terms does not jump across the split
    const mainX = (state: State): number => state.x + pathOffsetAt(state.track, FORK.from, state.path)
    expect([mainX(risk), mainX(safe), mainX(left)]).toEqual([laneCenterX(2), 0, laneCenterX(-2)])
  })

  it('merges fork lanes back into the main lanes they line up with', () => {
    const exitingRisk = step(stateOn(testTrack(), { dist: 500 * M - 1000, speed: M, path: 'risk', riskClean: 1 }), NONE)
    const exitingSafe = step(stateOn(testTrack(), { dist: 500 * M - 1000, speed: M, path: 'safe', x: laneCenterX(-1), lane: -1, targetLane: -1 }), NONE)
    expect([exitingRisk.path, exitingRisk.lane, exitingRisk.x]).toEqual(['main', 2, laneCenterX(2)])
    expect([exitingSafe.path, exitingSafe.lane, exitingSafe.x]).toEqual(['main', -2, laneCenterX(-2)])
  })

  it('progresses faster on the risk path at the same speed', () => {
    const inside = { dist: 410 * M, speed: M, flow: 30000 }
    const risk = simulate(stateOn(testTrack(), { ...inside, path: 'risk', riskClean: 1 }), 30).at(-1)!
    const safe = simulate(stateOn(testTrack(), { ...inside, path: 'safe', x: laneCenterX(1), lane: 1, targetLane: 1 }), 30).at(-1)!
    expect(risk.speed).toBe(safe.speed)
    expect(risk.dist).toBeGreaterThan(safe.dist)
  })

  it('pays RISK_CLEAR for a clean risk path and nothing after a hit', () => {
    const exiting = { dist: 500 * M - 1000, speed: M, path: 'risk' as const }
    const clean = step(stateOn(testTrack(), { ...exiting, riskClean: 1 }), NONE)
    const dirty = step(stateOn(testTrack(), { ...exiting, riskClean: 0 }), NONE)
    expect([clean.events & EVENT.RISK_CLEAR, clean.metrics.riskRoutes]).toEqual([EVENT.RISK_CLEAR, 1])
    expect(clean.flow - dirty.flow).toBe(FLOW.RISK_CLEAR)
    expect([dirty.events & EVENT.RISK_CLEAR, dirty.metrics.riskRoutes]).toEqual([0, 1])
  })

  describe('relay cut', () => {
    const cutFork: Fork = { ...FORK, label: 'relay-cut' }
    const cutTrack = testTrack({
      forks: [cutFork],
      events: [eventAt('bridge-break', 420, { path: 'risk', triggerDist: 380 * M, length: 58 * M, duration: 40, lanes: [0], amplitude: 640 })],
      ramps: [zoneAt(420, 428, [0], { path: 'risk' })],
      gaps: [zoneAt(434, 478, [0], { path: 'risk' })],
      checkpoints: testTrack().checkpoints.filter(checkpoint => checkpoint.path !== 'risk'),
    })
    const onCut = (speed: number, flow: number): State =>
      stateOn(cutTrack, { dist: 410 * M, path: 'risk', riskClean: 1, speed, flow, tick: 900, eventTicks: [100] })

    it('carries a fast courier across the gap: RISK_CLEAR, +15% FLOW and a relay-cut moment', () => {
      const states = simulate(onCut(centimetresOf(70), 50000), 200)
      const cleared = stateWithEvent(states, EVENT.RISK_CLEAR)
      expect(allEvents(states) & EVENT.FALL).toBe(0)
      expect(cleared.moments.map(moment => moment.kind)).toContain('relay-cut')
      expect(cleared.dist).toBeGreaterThanOrEqual(478 * M)
    })

    it('drops a slow courier into the gap and tethers it back before the fork', () => {
      const states = simulate(onCut(centimetresOf(50), 0), 300)
      expect(allEvents(states) & (EVENT.FALL | EVENT.RISK_CLEAR)).toBe(EVENT.FALL)
      const respawned = states.find((state, i) => i > 0 && states[i - 1]!.motion === 'tethering' && state.motion === 'riding')!
      expect([respawned.dist, respawned.path]).toEqual([200 * M, 'main'])
    })
  })
})

function centimetresOf(cm: number): number {
  return Math.trunc(cm * M / 100)
}

// ---------------------------------------------------------------------------
// Gates, FLOW and Relay Rush
// ---------------------------------------------------------------------------

describe('relay leg gates and FLOW', () => {
  const flow = 30000

  function flowDelta(track: Track, patch: Partial<State> = {}): { delta: number; events: number } {
    const states = simulate(stateOn(track, { flow, dist: 100 * M, ...patch }), 20)
    const baseline = simulate(stateOn(testTrack(), { flow, dist: 100 * M, ...patch }), 20)
    const index = indexOfEvent(states, EVENT.PERFECT_GATE | EVENT.MISSED_GATE)
    if (index < 0) throw new Error('gate never crossed')
    return { delta: states[index]!.flow - baseline[index]!.flow, events: states[index]!.events & (EVENT.PERFECT_GATE | EVENT.MISSED_GATE | EVENT.PULSE_HIT) }
  }

  it('pays +4% for a gold gate passed in its lane and takes 4% for any other lane', () => {
    expect(flowDelta(testTrack({ gates: [gateAt(103, 0)] }))).toEqual({ delta: FLOW.PERFECT_GATE, events: EVENT.PERFECT_GATE })
    expect(flowDelta(testTrack({ gates: [gateAt(103, 2)] }))).toEqual({ delta: -FLOW.MISSED_GATE, events: EVENT.MISSED_GATE })
  })

  it('runs the beat at 144 BPM from tick 0 with no per-route phase', () => {
    expect(PULSE_PERIOD).toBe(25)
    for (const world of WORLDS) {
      const { track } = createState({ ...CONFIG, world, seed: `beat-${world}` })
      expect(track.pulse.period, world).toBe(PULSE_PERIOD)
      expect(track.gates.filter(gate => gate.kind === 'pulse').every(gate => gate.period === PULSE_PERIOD), world).toBe(true)
    }
  })

  it('lights one lane of a pulse gate at every tick and swaps it on the beat', () => {
    const pulseGate = gateAt(560, 2, { kind: 'pulse', period: PULSE_PERIOD })
    const lanes = Array.from({ length: 250 }, (_, tick) => pulseGateLane(pulseGate, tick))
    expect(lanes.every((lane, tick) => lane === (Math.trunc(tick / 25) % 2 === 0 ? 2 : -2))).toBe(true)
    expect([24, 25, 49, 50].map(tick => pulseGateLane(pulseGate, tick))).toEqual([2, -2, -2, 2])
    expect([0, 25, 57].map(tick => pulseGateLane(gateAt(560, 2), tick))).toEqual([2, 2, 2])
  })

  it('pays a pulse gate +8% in the lit lane and counts the dark lane or the centre as a miss', () => {
    const track = testTrack({ gates: [gateAt(560, 2, { kind: 'pulse', period: PULSE_PERIOD })] })
    const crossing = (tick: number, lane: number): State =>
      step(stateOn(track, { dist: 560 * M - 1000, speed: M, flow, tick, x: laneCenterX(lane), lane, targetLane: lane }), NONE)
    const lit = crossing(23, 2)
    const dark = crossing(24, 2)
    const centred = crossing(23, 0)
    const mask = EVENT.PULSE_HIT | EVENT.PERFECT_GATE | EVENT.MISSED_GATE
    expect(lit.events & mask).toBe(EVENT.PULSE_HIT | EVENT.PERFECT_GATE)
    expect(lit.flow - step(stateOn(testTrack(), { dist: 560 * M - 1000, speed: M, flow, tick: 23, x: laneCenterX(2), lane: 2, targetLane: 2 }), NONE).flow).toBe(FLOW.PULSE_GATE)
    expect(dark.events & mask).toBe(EVENT.MISSED_GATE)
    expect(centred.events & mask).toBe(EVENT.MISSED_GATE)
    expect([lit.metrics.pulseHits, dark.metrics.pulseHits, dark.metrics.totalGates]).toEqual([1, 0, 1])
  })

  it('is on beat only inside the pulse section when given a distance', () => {
    const track = testTrack()
    expect([onBeat(track, 25, 560 * M), onBeat(track, 32, 560 * M), onBeat(track, 33, 560 * M), onBeat(track, 24, 560 * M)]).toEqual([true, true, false, false])
    expect([onBeat(track, 25, 100 * M), onBeat(track, 50)]).toEqual([false, true])
  })

  it('drains FLOW by about 1.5% per second when nothing is earned', () => {
    const states = simulate(stateOn(testTrack(), { flow }), 60)
    expect(flow - states.at(-1)!.flow).toBe(FLOW.DECAY_TICK * 60)
  })

  it('starts Relay Rush at full FLOW: faster, FLOW pinned, one rush moment, 70% FLOW when it runs out', () => {
    // #given a courier one gate short of full FLOW, with gates it will miss during the rush
    const gates = [gateAt(103, 0), gateAt(120, 2), gateAt(140, 2)]
    const start = stateOn(testTrack({ gates }), { dist: 100 * M, flow: ONE - 1000 })
    const states = simulate(start, RUSH_TICKS + 30)
    const started = indexOfEvent(states, EVENT.RUSH_START)
    const rushing = states[started + 60]!
    const ended = states[started + RUSH_TICKS]!
    // #then the rush starts with FLOW_MAX, shrugs off the misses and ends at 70%
    expect(states[started]!.events & EVENT.FLOW_MAX).toBe(EVENT.FLOW_MAX)
    expect([states[started]!.rushTicks, states[started]!.metrics.rushes]).toEqual([RUSH_TICKS, 1])
    expect(rushing.flow).toBe(ONE)
    expect(rushing.metrics.totalGates - rushing.metrics.perfectGates).toBe(2)
    expect(rushing.speed).toBeGreaterThan(BASE_SPEED + Math.trunc(30 * M / 100))
    expect([ended.rushTicks, ended.flow]).toEqual([0, FLOW.RUSH_END])
    expect(states.at(-1)!.moments.map(moment => moment.kind)).toEqual(['rush'])
  })

  it('ends Relay Rush immediately on a hit', () => {
    const track = testTrack({ hazards: [hazardAt('barrier', 120, [0])] })
    const states = simulate(stateOn(track, { dist: 100 * M, flow: ONE, rushTicks: 200 }), 60)
    const hit = stateWithEvent(states, EVENT.HIT)
    expect([hit.rushTicks, hit.flow]).toEqual([0, ONE - FLOW.HIT])
  })
})

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

describe('relay leg ghost', () => {
  /** A ghost that holds `metresPerTick` from tick 0 on the main path, `xCm` from the centre line. */
  function steadyGhost(metresPerTickPercent: number, xCm = 0, samples = 160): Ghostline {
    return {
      step: GHOSTLINE_STEP,
      path: Array.from({ length: samples }, () => 0 as const),
      x: Array.from({ length: samples }, () => xCm),
      tick: Array.from({ length: samples }, (_, i) => Math.trunc(i * 4 * 100 / metresPerTickPercent)),
    }
  }

  function withGhost(ghostline: Ghostline, patch: Partial<State> = {}): State {
    const state = stateOn(testTrack(), patch)
    return { ...state, config: { ...state.config, ghostline } }
  }

  it('reports how far ahead the ghost is and drafts on its line', () => {
    // #given a ghost 40 ticks ahead on the centre line
    const ghost = steadyGhost(50)
    const states = simulate(withGhost(ghost, { dist: 100 * M, tick: 240, speed: Math.trunc(M / 2) }), 30)
    const last = states.at(-1)!
    // #then the lead is positive and the courier drafts every tick
    expect(last.ghostLeadTicks).toBeGreaterThan(30)
    expect(last.ghostLeadTicks).toBeLessThanOrEqual(DRAFT_LEAD)
    expect(countEvent(states, EVENT.DRAFTING)).toBe(30)
    expect(last.metrics.draftTicks).toBe(30)
  })

  it('does not draft off the ghost line or when the ghost is too far ahead', () => {
    const offLine = simulate(withGhost(steadyGhost(50, 300), { dist: 100 * M, tick: 240, speed: Math.trunc(M / 2) }), 20)
    const farAhead = simulate(withGhost(steadyGhost(50), { dist: 100 * M, tick: 400, speed: Math.trunc(M / 2) }), 20)
    expect(allEvents(offLine) & EVENT.DRAFTING).toBe(0)
    expect(allEvents(farAhead) & EVENT.DRAFTING).toBe(0)
  })

  it('overtakes once when catching the ghost, with FLOW and a moment, and is overtaken when it pulls clear', () => {
    // #given a ghost 20 ticks ahead at the same speed that the courier out-runs
    const ghost = steadyGhost(50)
    const start = withGhost(ghost, { dist: 100 * M, tick: 220, speed: M, flow: 20000, ghostAhead: 1 })
    const states = simulate(start, 120)
    const overtake = indexOfEvent(states, EVENT.GHOST_OVERTAKE)
    // #then the overtake fires once, pays FLOW and records the moment
    expect(overtake).toBeGreaterThan(0)
    expect(countEvent(states, EVENT.GHOST_OVERTAKE)).toBe(1)
    expect(states[overtake]!.ghostLeadTicks).toBeLessThanOrEqual(0)
    expect(states[overtake]!.moments.map(moment => moment.kind)).toEqual(['ghost-overtake'])
    // #and a courier that stops is overtaken back once the ghost leads clearly
    const stalled = simulate({ ...states.at(-1)!, motion: 'falling', motionTicks: 150, tetherSaves: 0 }, 200)
    expect(countEvent(stalled, EVENT.GHOST_OVERTAKEN)).toBe(1)
    expect(stateWithEvent(stalled, EVENT.GHOST_OVERTAKEN).ghostLeadTicks).toBeGreaterThanOrEqual(GHOST_LEAD_MARGIN)
  })

  it('cannot farm overtakes by running level with the ghost', () => {
    // #given a ghost at exactly base speed and a courier level with it at base speed
    const ghost = steadyGhost(46)
    const level = simulate(withGhost(ghost, { dist: 100 * M, tick: 217, speed: BASE_SPEED, flow: 0, ghostAhead: 1 }), 600)
    // #then the lead dithers around zero but the overtake pays once
    expect(level.some(state => state.ghostLeadTicks > 0)).toBe(true)
    expect(countEvent(level, EVENT.GHOST_OVERTAKE)).toBe(1)
    expect(countEvent(level, EVENT.GHOST_OVERTAKEN)).toBe(0)
  })

  it('treats distances the ghost never reached as the courier being ahead', () => {
    const short = steadyGhost(50, 0, 10)
    const past = step(withGhost(short, { dist: 200 * M, tick: 500, ghostAhead: 1 }), NONE)
    expect(past.ghostLeadTicks).toBeLessThan(0)
    expect(past.events & EVENT.GHOST_OVERTAKE).toBe(EVENT.GHOST_OVERTAKE)
    expect(ghostlineAt(short, 200 * M)).toBeNull()
  })

  it('interpolates ghostline samples', () => {
    const ghost: Ghostline = { step: GHOSTLINE_STEP, path: [0, 0, 2], x: [0, 100, 300], tick: [0, 10, 30] }
    expect(ghostlineAt(ghost, 2 * M)).toEqual({ x: Math.trunc(M / 2), path: 'main', tick: 5 })
    expect(ghostlineAt(ghost, 6 * M)).toEqual({ x: M, path: 'main', tick: 20 })
    expect(ghostlineAt(ghost, 8 * M)).toEqual({ x: 3 * M, path: 'risk', tick: 30 })
    expect(ghostlineAt(ghost, 10 * M)).toEqual({ x: 3 * M, path: 'risk', tick: 40 })
    expect(ghostlineAt(ghost, 12 * M)).toBeNull()
  })

  it('derives a ghostline every 4 m of route progress from a verified run, purely', () => {
    const config = { ...CONFIG, world: 'alpine' as const, seed: 'ghostline' }
    const run = playLeg(config, sloppyBot('risk'))
    const ghostline = deriveGhostline(config, run.trace)
    expect(run.state.dist).toBe(run.state.track.finishDist)
    expect(deriveGhostline(config, run.trace)).toEqual(ghostline)
    expect(ghostline.step).toBe(GHOSTLINE_STEP)
    expect(ghostline.tick).toHaveLength(Math.trunc(run.state.track.finishDist / GHOSTLINE_STEP) + 1)
    expect(ghostline.tick.every((tick, i) => i === 0 || tick >= ghostline.tick[i - 1]!)).toBe(true)
    expect(ghostline.tick.at(-1)!).toBeLessThanOrEqual(run.state.tick)
    expect(ghostline.path.every(code => code === 0 || code === 1 || code === 2)).toBe(true)
    expect(() => deriveGhostline(config, [[1, 0, 0, 0]])).toThrow(RangeError)
    // #and racing it replays to the same result
    const chase = playLeg({ ...config, ghostline }, skilledBot('safe'))
    expect(replay({ ...config, ghostline, inputTrace: chase.trace })).toEqual(finalize(chase.state, chase.trace))
  })
})

const DRAFT_LEAD = 90

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

describe('relay leg moments', () => {
  it('keeps moments in route order, bounded, never repeating a kind at one distance', () => {
    // #given a courier saving an edge over and over along the route
    let state = onRightShoulder(testTrack(), { dist: 10 * M })
    for (let round = 0; round < 12; round++) {
      const grinding: State = { ...state, motion: 'grinding', motionTicks: GRIND_WINDOW_TICKS[1], edgeSide: 1, x: HALF_WIDTH, vx: 0 }
      state = simulate(grinding, 20, firstThen(LEFT)).at(-1)!
    }
    // #then at most MAX_MOMENTS are kept, ordered by distance
    expect(state.moments.length).toBe(MAX_MOMENTS)
    expect(state.moments.every((moment, i) => i === 0 || moment.dist >= state.moments[i - 1]!.dist)).toBe(true)
    const keys = state.moments.map(moment => `${moment.kind}@${moment.dist}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

// ---------------------------------------------------------------------------
// Finish, traces, replay and result
// ---------------------------------------------------------------------------

describe('relay leg finish', () => {
  it('finishes on reaching the finish distance and stays finished', () => {
    const finished = step(stateOn(testTrack(), { dist: 600 * M - 1000, speed: M }), NONE)
    expect([finished.finished, finished.motion, finished.dist, finished.events & EVENT.FINISH]).toEqual([1, 'finished', 600 * M, EVENT.FINISH])
    expect(step(finished, JUMP)).toBe(finished)
  })

  it('ends an unfinished leg at MAX_TICKS as incomplete with no score', () => {
    const capped = step(stateOn(testTrack(), { tick: MAX_TICKS - 1 }), NONE)
    const result = finalize(capped, [[0, 0, 0, 0]])
    expect([capped.finished, capped.events & EVENT.FINISH]).toEqual([1, 0])
    expect([result.completed, result.failed, result.score, result.ticks, result.timeMs]).toEqual([false, false, 0, MAX_TICKS, 90000])
  })
})

describe('relay leg traces', () => {
  it('accepts a well-formed trace', () => {
    const trace: Sample[] = [[0, -1, 8, 0], [12, 1, -8, 1], [1, 0, 0, 2]]
    expect(validateTrace(trace)).toEqual({ ok: true, trace })
  })

  it('rejects malformed traces with a code and index', () => {
    const cases: [unknown, string, number][] = [
      ['nope', 'count', -1],
      [[], 'count', -1],
      [Array.from({ length: MAX_TICKS + 1 }, (_, i) => [i === 0 ? 0 : 1, 0, 0, 0]), 'count', -1],
      [[[0, 0, 0]], 'shape', 0],
      [[[0, 0, 0, 0, 0]], 'shape', 0],
      [[[0, 0, 0, 0], 'x'], 'shape', 1],
      [[[1, 0, 0, 0]], 'order', 0],
      [[[0, 0, 0, 0], [0, 0, 0, 0]], 'order', 1],
      [[[0, 0, 0, 0], [-3, 0, 0, 0]], 'order', 1],
      [[[0, 0, 0, 0], [1.5, 0, 0, 0]], 'order', 1],
      [[[0, 2, 0, 0]], 'input', 0],
      [[[0, -2, 0, 0]], 'input', 0],
      [[[0, 0, 9, 0]], 'input', 0],
      [[[0, 0, -9, 0]], 'input', 0],
      [[[0, 0, 0.5, 0]], 'input', 0],
      [[[0, 0, 0, 3]], 'input', 0],
      [[[0, 0, 0, '1']], 'input', 0],
      [[[0, 0, 0, 0], [MAX_TICKS, 0, 0, 0]], 'after-end', 1],
    ]
    for (const [trace, code, index] of cases) {
      expect(validateTrace(trace), `${code} ${JSON.stringify(trace).slice(0, 40)}`).toEqual({ ok: false, error: { code, index } })
    }
  })

  it(`rejects traces over ${MAX_TRACE_BYTES} canonical bytes`, () => {
    const trace = Array.from({ length: MAX_TICKS }, (_, i) => [i === 0 ? 0 : 100000, -1, -8, 2])
    const result = validateTrace(trace, Number.MAX_SAFE_INTEGER)
    expect(result.ok ? 'ok' : result.error.code).toBe('size')
  })

  it('holds nudge between samples and fires shifts and actions only on their sample tick', () => {
    // #given a right shift with a jump at tick 0 and a left shift with a slide at tick 4
    const cursor = new InputCursor([[0, 1, 5, ACTION_JUMP], [4, -1, -3, ACTION_SLIDE]])
    // #then shifts and actions are impulses while nudge holds
    expect(cursor.at(0)).toEqual({ shift: 1, nudge: 5, action: ACTION_JUMP })
    expect(cursor.at(1)).toEqual({ shift: 0, nudge: 5, action: ACTION_NONE })
    expect(cursor.at(4)).toEqual({ shift: -1, nudge: -3, action: ACTION_SLIDE })
    expect(cursor.at(5)).toEqual({ shift: 0, nudge: -3, action: ACTION_NONE })
  })

  it('refuses to read an invalid trace', () => {
    expect(() => new InputCursor([[1, 0, 0, 0]])).toThrow(RangeError)
  })
})

describe('relay leg result', () => {
  const config: Config = { ...CONFIG, world: 'solar', seed: 'result' }
  const played = playLeg(config, skilledBot('risk'))

  it('replays a live leg to the identical result', () => {
    // #given a live leg and its recorded trace
    const live = finalize(played.state, played.trace)
    // #when the server replays the trace
    const verified = replay({ ...config, inputTrace: played.trace })
    // #then everything, hash included, matches
    expect(verified).toEqual(live)
    expect([verified.completed, verified.failed]).toEqual([true, false])
    expect(verified.resultHash).toMatch(/^[a-f0-9]{64}$/)
    expect(verified.moments).toEqual(played.state.moments)
  })

  it('replays a failed leg as failed', () => {
    const idleWithoutTether = { ...CONFIG, tier: 1 as const, tetherSaves: 0 as const }
    const gapInCentre = testTrack({ gaps: [zoneAt(30, 40, [0])] })
    const failed = simulate(stateOn(gapInCentre, { config: idleWithoutTether }), 400).at(-1)!
    const result = finalize(failed, [[0, 0, 0, 0]])
    expect([result.completed, result.failed, result.score]).toEqual([false, true, 0])
  })

  it('requires a finished state to finalize', () => {
    expect(() => finalize(createState(CONFIG), [[0, 0, 0, 0]])).toThrow(RangeError)
  })

  it('rejects malformed traces and samples after the finish', () => {
    const idle = replay({ ...CONFIG, inputTrace: [[0, 0, 0, 0]] })
    expect(() => replay({ ...CONFIG, inputTrace: [[0, 0, 0, 0], [idle.ticks, 0, 0, 0]] })).toThrow(RangeError)
    expect(() => replay({ ...CONFIG, inputTrace: [] })).toThrow(RangeError)
  })

  it('binds world, tier, opening FLOW, tether saves and the ghostline into the hash, and ignores unknown fields', () => {
    const inputTrace: Sample[] = [[0, 0, 0, 0]]
    const base = replay({ ...CONFIG, inputTrace }).resultHash
    const ghostline: Ghostline = { step: GHOSTLINE_STEP, path: [0], x: [0], tick: [0] }
    expect(replay({ ...CONFIG, world: 'alpine', inputTrace }).resultHash).not.toBe(base)
    expect(replay({ ...CONFIG, tier: 2, inputTrace }).resultHash).not.toBe(base)
    expect(replay({ ...CONFIG, openingFlow: 1, inputTrace }).resultHash).not.toBe(base)
    expect(replay({ ...CONFIG, tetherSaves: 0, inputTrace }).resultHash).not.toBe(base)
    expect(replay({ ...CONFIG, ghostline, inputTrace }).resultHash).not.toBe(base)
    const withExtraField = { ...CONFIG, inputTrace, issuedAt: 1726500000000 }
    expect(replay(withExtraField).resultHash).toBe(base)
  })

  it('derives time and score from the final state, time first', () => {
    const { state } = played
    const m = state.metrics
    const expected = 300000 - state.tick * 40 + m.perfectGates * 120 + m.pulseHits * 160 + m.nearMisses * 60
      + m.cleanLandings * 40 + m.riskRoutes * 400 + m.edgeSaves * 200 + m.overtakes * 150 + m.rushes * 300
      - m.hits * 300 - m.falls * 500 - m.hardLandings * 100
      + Math.trunc(m.flowSum * 2000 / (state.tick * ONE))
    const result = finalize(state, played.trace)
    expect(result.timeMs).toBe(Math.trunc(state.tick * 1000 / 60))
    expect(result.score).toBe(expected)
    expect(score({ ...state, tick: state.tick + 60 })).toBeLessThan(result.score)
  })

  it('hashes the rules string', () => {
    expect(RULES_HASH).toBe(sha256(RULES))
    expect(RULES).toMatch(/^relay-leg-v6:/)
  })
})

// ---------------------------------------------------------------------------
// Playability across authored content
// ---------------------------------------------------------------------------

describe('relay leg playability', () => {
  const SEEDS = 4
  const TIERS: readonly Tier[] = [0, 1, 2]

  function legConfig(world: Config['world'], tier: Tier, index: number, patch: Partial<Config> = {}): Config {
    return { ...CONFIG, world, tier, seed: `play-${index}`, openingFlow: (index * 811) % (MAX_OPENING_FLOW + 1), ...patch }
  }

  const seconds = (state: State): number => state.tick / 60
  const completed = (state: State): boolean => state.dist >= state.track.finishDist && state.motion !== 'failed'

  it('lets the skilled courier finish every world and tier in 36-46 s on either fork plan', { timeout: 60000 }, () => {
    const failures: string[] = []
    for (const world of WORLDS) {
      for (const tier of TIERS) {
        for (let i = 0; i < SEEDS; i++) {
          for (const plan of ['safe', 'risk'] as const) {
            const { state } = playLeg(legConfig(world, tier, i), skilledBot(plan))
            if (!completed(state) || seconds(state) < 36 || seconds(state) > 46) {
              failures.push(`${world} t${tier} #${i} ${plan}: ${seconds(state).toFixed(1)} s, ${state.motion}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('makes the risk plan the faster line for the skilled courier', { timeout: 60000 }, () => {
    for (const world of WORLDS) {
      let risk = 0
      let safe = 0
      for (let i = 0; i < SEEDS; i++) {
        risk += playLeg(legConfig(world, 1, i), skilledBot('risk')).state.tick
        safe += playLeg(legConfig(world, 1, i), skilledBot('safe')).state.tick
      }
      expect(risk, world).toBeLessThan(safe)
    }
  })

  it('lets the skilled courier clear relay cuts at speed', { timeout: 60000 }, () => {
    let cuts = 0
    let legs = 0
    for (const world of WORLDS) {
      for (let i = 0; i < SEEDS; i++) {
        const { state } = playLeg(legConfig(world, 1, i), skilledBot('risk'))
        legs++
        if (state.moments.some(moment => moment.kind === 'relay-cut')) cuts++
        expect(state.metrics.falls, `${world} #${i}`).toBe(0)
      }
    }
    expect(cuts * 100).toBeGreaterThanOrEqual(legs * 80)
  })

  it('has the sloppy courier finish in 40-60 s on average, with falls the tether saves', { timeout: 60000 }, () => {
    let finishedTicks = 0
    let finished = 0
    let legs = 0
    let tethers = 0
    for (const world of WORLDS) {
      for (const tier of TIERS) {
        for (let i = 0; i < SEEDS; i++) {
          const { state } = playLeg(legConfig(world, tier, i), sloppyBot(i % 2 === 0 ? 'safe' : 'risk'))
          legs++
          tethers += state.metrics.tetherSaves
          if (!completed(state)) continue
          finished++
          finishedTicks += state.tick
        }
      }
    }
    const averageSeconds = finishedTicks / finished / 60
    expect(finished * 100).toBeGreaterThanOrEqual(legs * 90)
    expect(averageSeconds).toBeGreaterThanOrEqual(40)
    expect(averageSeconds).toBeLessThanOrEqual(60)
    expect(tethers).toBeGreaterThan(0)
  })

  it('lets a hands-off courier with a tether save finish every world and tier', { timeout: 60000 }, () => {
    const failures: string[] = []
    for (const world of WORLDS) {
      for (const tier of TIERS) {
        for (let i = 0; i < SEEDS; i++) {
          const { state } = playLeg(legConfig(world, tier, i), idleBot)
          if (!completed(state) || state.tick >= MAX_TICKS) failures.push(`${world} t${tier} #${i}: ${seconds(state).toFixed(1)} s, ${state.motion}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('fails a hands-off courier without tether saves on its first fall, and a tether turns the same fall into a finish', () => {
    // #given a route whose centre lane drops into an unramped gap
    const gapInCentre = testTrack({ gaps: [zoneAt(30, 40, [0])], checkpoints: [{ dist: 0, path: 'main', lane: 0 }] })
    const run = (tetherSaves: 0 | 1): State => {
      const config = { ...CONFIG, tetherSaves }
      const start = stateOn(gapInCentre, { config, tetherSaves })
      return simulate(start, MAX_TICKS).at(-1)!
    }
    // #then without a save the leg fails, and with one the courier respawns and falls again, failing later
    const bare = run(0)
    const tethered = run(1)
    expect([bare.motion, bare.metrics.falls, bare.metrics.tetherSaves]).toEqual(['failed', 1, 0])
    expect([tethered.motion, tethered.metrics.falls, tethered.metrics.tetherSaves]).toEqual(['failed', 2, 1])
    expect(tethered.tick).toBeGreaterThan(bare.tick)
  })

  it('lets real hands-off legs without a tether either finish or fail cleanly', { timeout: 60000 }, () => {
    for (const world of WORLDS) {
      for (const tier of TIERS) {
        const { state, trace } = playLeg(legConfig(world, tier, 0, { tetherSaves: 0 }), idleBot)
        const result = replay({ ...legConfig(world, tier, 0, { tetherSaves: 0 }), inputTrace: trace })
        expect(result.completed !== result.failed, `${world} t${tier}`).toBe(true)
        expect(result.failed).toBe(state.motion === 'failed')
      }
    }
  })

  it('lets the skilled courier meet at least 80% of pulse gates in the lit lane', { timeout: 60000 }, () => {
    let hits = 0
    let pulseGates = 0
    for (const world of WORLDS) {
      for (let i = 0; i < SEEDS; i++) {
        const { state } = playLeg(legConfig(world, 1, i), skilledBot(i % 2 === 0 ? 'safe' : 'risk'))
        hits += state.metrics.pulseHits
        pulseGates += state.track.gates.filter(gate => gate.kind === 'pulse').length
      }
    }
    expect(hits * 100).toBeGreaterThanOrEqual(pulseGates * 80)
  })

  it('gives a courier who stays centred no pulse hits', () => {
    for (const world of WORLDS) {
      expect(playLeg(legConfig(world, 1, 0), idleBot).state.metrics.pulseHits, world).toBe(0)
    }
  })

  it('drafts and overtakes a ghost that leads early', { timeout: 60000 }, () => {
    let drafted = 0
    let overtook = 0
    for (const world of WORLDS) {
      const config = legConfig(world, 1, 7)
      const rival = { ...config, openingFlow: MAX_OPENING_FLOW }
      const ghostline = deriveGhostline(rival, playLeg(rival, sloppyBot('risk')).trace)
      const { state } = playLeg({ ...config, openingFlow: 0, ghostline }, skilledBot('safe'))
      drafted += state.metrics.draftTicks
      overtook += state.metrics.overtakes
    }
    expect(drafted).toBeGreaterThan(0)
    expect(overtook).toBeGreaterThan(0)
  })
})
