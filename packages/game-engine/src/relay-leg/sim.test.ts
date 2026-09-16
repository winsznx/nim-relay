import { describe, expect, it } from 'vitest'
import { ONE } from '../fixed-point'
import { sha256 } from '../replay/hash'
import { RULES, RULES_HASH, finalize, replay, score } from './result'
import {
  FALL_STUMBLE_TICKS,
  FLOW,
  OUTCOME,
  SLIDE_TICKS,
  STUMBLE_SPEED,
  STUMBLE_TICKS,
  createState,
  doorOpenSide,
  hazardLateral,
  hazardOutcome,
  onBeat,
  step,
  trainBlockedSide,
} from './sim'
import { goodBot, idleBot, playLeg } from './test-bots'
import { InputCursor, MAX_TRACE_BYTES, validateTrace } from './trace'
import {
  ACTION_JUMP,
  ACTION_NONE,
  ACTION_SLIDE,
  EVENT,
  MAX_OPENING_FLOW,
  MAX_TICKS,
  WORLDS,
  type Config,
  type Hazard,
  type HazardKind,
  type Input,
  type Sample,
  type State,
  type Tier,
  type Track,
  type Zone,
} from './types'

const M = ONE
const CONFIG: Config = {
  engineVersion: '5',
  challenge: 'relay-leg',
  challengeVersion: '5',
  seed: 'rules',
  world: 'coast',
  tier: 1,
  openingFlow: 0,
}
const NONE: Input = { steer: 0, action: ACTION_NONE }
const JUMP: Input = { steer: 0, action: ACTION_JUMP }
const SLIDE: Input = { steer: 0, action: ACTION_SLIDE }

// ---------------------------------------------------------------------------
// Synthetic tracks isolate one rule at a time from authored content.
// ---------------------------------------------------------------------------

function testTrack(overrides: Partial<Track> = {}): Track {
  return {
    world: 'coast',
    tier: 1,
    finishDist: 600 * M,
    segments: [
      { index: 0, module: 'test.straight.a', kind: 'straight', from: 0, to: 600 * M, elevationFrom: 0, elevationTo: 0, halfWidth: 4 * M, bend: 0 },
    ],
    fork: {
      from: 400 * M,
      to: 500 * M,
      riskSide: 1,
      riskProgress: Math.trunc(130 * ONE / 100),
      separation: 14 * M,
      safeHalfWidth: 5 * M,
      riskHalfWidth: 3 * M,
    },
    gates: [],
    hazards: [],
    ramps: [],
    gaps: [],
    rails: [],
    boostPads: [],
    pulse: { from: 550 * M, to: 580 * M, period: 28, window: 8 },
    setPieces: [],
    ...overrides,
  }
}

function hazardAt(kind: HazardKind, metres: number, patch: Partial<Hazard> = {}): Hazard {
  return { dist: metres * M, x: 0, half: M, kind, path: 'main', period: 0, phase: 0, amplitude: 0, length: 0, ...patch }
}

function zoneAt(from: number, to: number, patch: Partial<Zone> = {}): Zone {
  return { from: from * M, to: to * M, x: 0, half: 2 * M, path: 'main', ...patch }
}

function stateOn(track: Track, patch: Partial<State> = {}): State {
  return { ...createState(CONFIG), track, ...patch }
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

// ---------------------------------------------------------------------------
// Config, input and purity
// ---------------------------------------------------------------------------

describe('relay leg config and input', () => {
  it('starts on the main path at tick 0 with the inherited opening FLOW', () => {
    // #given a config carrying a mid-range opening flow
    // #when creating the leg
    const state = createState({ ...CONFIG, openingFlow: 12000 })
    // #then the courier stands at the start with that flow
    expect([state.tick, state.dist, state.path, state.flow, state.finished]).toEqual([0, 0, 'main', 12000, 0])
  })

  it('rejects opening FLOW above MAX_OPENING_FLOW, negative or fractional', () => {
    for (const openingFlow of [MAX_OPENING_FLOW + 1, -1, 0.5, Number.NaN]) {
      expect(() => createState({ ...CONFIG, openingFlow }), String(openingFlow)).toThrow(RangeError)
    }
    expect(createState({ ...CONFIG, openingFlow: MAX_OPENING_FLOW }).flow).toBe(MAX_OPENING_FLOW)
  })

  it('rejects wrong versions, unknown worlds, tiers and bad seeds', () => {
    const invalid: unknown[] = [
      { ...CONFIG, engineVersion: '4' },
      { ...CONFIG, challengeVersion: '4' },
      { ...CONFIG, challenge: 'station-race' },
      { ...CONFIG, world: 'moon' },
      { ...CONFIG, tier: 3 },
      { ...CONFIG, seed: '' },
      { ...CONFIG, seed: 'x'.repeat(129) },
    ]
    for (const config of invalid) expect(() => createState(config as Config), JSON.stringify(config).slice(0, 80)).toThrow(RangeError)
  })

  it('rejects steer outside -64..64, fractional steer and unknown actions', () => {
    const state = createState(CONFIG)
    const invalid: unknown[] = [{ steer: 65, action: 0 }, { steer: -65, action: 0 }, { steer: 1.5, action: 0 }, { steer: 0, action: 3 }]
    for (const input of invalid) expect(() => step(state, input as Input)).toThrow(RangeError)
  })

  it('never mutates the state it steps from', () => {
    // #given a deeply frozen live state a few seconds into a real leg
    let state = createState({ ...CONFIG, world: 'metro' })
    for (let i = 0; i < 240; i++) state = step(state, { steer: (i % 64) - 32, action: i % 50 === 0 ? ACTION_JUMP : ACTION_NONE })
    const before = JSON.stringify(state)
    deepFreeze(state)
    // #when stepping from it
    const next = step(state, JUMP)
    // #then the original is untouched and a new state is returned
    expect(JSON.stringify(state)).toBe(before)
    expect(next).not.toBe(state)
    expect(next.tick).toBe(state.tick + 1)
  })

  it('keeps every number in a finished leg a safe integer, track included', () => {
    for (const world of WORLDS) {
      // #given a full leg played by the good bot
      const { state } = playLeg({ ...CONFIG, world, seed: `integers-${world}` }, goodBot('risk'))
      // #then no float, NaN or undefined leaked into the authoritative state
      expect(unsafeNumbers(state), world).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

describe('relay leg movement', () => {
  it('steers towards the steer target with 1/6 smoothing and clamps to the half-width', () => {
    // #given a courier on the centre line of a 4 m half-width deck
    const start = stateOn(testTrack())
    // #when holding full right
    const states = simulate(start, 120, () => ({ steer: 64, action: ACTION_NONE }))
    // #then the first tick closes a sixth of the gap and x settles on the edge without passing it
    expect(states[0]!.x).toBe(Math.trunc(4 * M / 6))
    expect(states.every(state => state.x <= 4 * M)).toBe(true)
    expect(4 * M - states.at(-1)!.x).toBeLessThan(6)
  })

  it('pushes the courier sideways inside a gust zone only', () => {
    // #given a gust covering the first 100 m
    const track = testTrack({ hazards: [hazardAt('gust', 0, { amplitude: 2000, length: 100 * M })] })
    // #when coasting through and past it
    const inside = step(stateOn(track), NONE)
    const outside = step(stateOn(track, { dist: 150 * M }), NONE)
    // #then only the courier inside the zone drifts
    expect(inside.x).toBe(2000)
    expect(outside.x).toBe(0)
  })

  it('runs faster with more FLOW', () => {
    const slow = simulate(stateOn(testTrack(), { flow: 0 }), 120).at(-1)!
    const fast = simulate(stateOn(testTrack(), { flow: ONE }), 120).at(-1)!
    expect(fast.dist).toBeGreaterThan(slow.dist)
  })

  it('jumps for about 0.7 s and lands', () => {
    // #given a grounded courier
    // #when pressing jump once
    const states = simulate(stateOn(testTrack()), 80, firstThen(JUMP))
    // #then it leaves the ground on the press and spends 41 ticks in the air (press included)
    expect(states[0]!.events & EVENT.JUMP).toBe(EVENT.JUMP)
    expect(indexOfEvent(states, EVENT.LAND)).toBe(40)
    expect(states.at(-1)!.metrics.jumps).toBe(1)
  })

  it('buffers a jump pressed just before landing and fires it on touchdown', () => {
    // #given a courier 10 cm above the ground
    const start = stateOn(testTrack(), { y: Math.trunc(M / 10) })
    // #when pressing jump while still airborne
    const states = simulate(start, 20, firstThen(JUMP))
    // #then the jump fires right after the landing
    const landed = indexOfEvent(states, EVENT.LAND)
    expect(landed).toBeGreaterThan(0)
    expect(indexOfEvent(states, EVENT.JUMP)).toBe(landed + 1)
  })

  it('drops a buffered jump when the courier stays airborne too long', () => {
    const states = simulate(stateOn(testTrack(), { y: 3 * M }), 60, firstThen(JUMP))
    expect(indexOfEvent(states, EVENT.LAND)).toBeGreaterThan(0)
    expect(allEvents(states) & EVENT.JUMP).toBe(0)
  })

  it('cannot jump while stumbling', () => {
    const states = simulate(stateOn(testTrack(), { stumbleTicks: 12 }), 12, firstThen(JUMP))
    expect(allEvents(states) & EVENT.JUMP).toBe(0)
  })

  it('slides for 0.6 s when grounded', () => {
    const states = simulate(stateOn(testTrack()), 40, firstThen(SLIDE))
    expect(states[0]!.slideTicks).toBe(SLIDE_TICKS)
    expect(states[0]!.events & EVENT.SLIDE).toBe(EVENT.SLIDE)
    expect(states[SLIDE_TICKS]!.slideTicks).toBe(0)
  })

  it('launches a longer jump off a ramp crossed inside its window, and not outside it', () => {
    // #given a centre ramp ending at 2 m
    const track = testTrack({ ramps: [zoneAt(1, 2, { half: M })] })
    // #when riding over it on the centre line and in the far lane
    const onRamp = simulate(stateOn(track), 120)
    const beside = simulate(stateOn(track, { x: 3 * M }), 120, () => ({ steer: 48, action: ACTION_NONE }))
    // #then only the centre run gets ~1.1 s of air and a clean landing
    const launch = indexOfEvent(onRamp, EVENT.JUMP)
    expect(launch).toBeGreaterThanOrEqual(0)
    expect(indexOfEvent(onRamp, EVENT.LAND) - launch).toBe(65)
    expect(allEvents(onRamp) & EVENT.CLEAN_LAND).toBe(EVENT.CLEAN_LAND)
    expect(allEvents(beside) & EVENT.JUMP).toBe(0)
  })

  it('pays no clean-landing FLOW for hopping on flat ground', () => {
    const states = simulate(stateOn(testTrack()), 60, firstThen(JUMP))
    expect(allEvents(states) & EVENT.LAND).toBe(EVENT.LAND)
    expect(allEvents(states) & EVENT.CLEAN_LAND).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Hazards and gaps
// ---------------------------------------------------------------------------

describe('relay leg hazards', () => {
  const barrierTrack = testTrack({ hazards: [hazardAt('barrier', 6)] })
  const control = testTrack()

  it('hits a grounded courier inside a barrier: FLOW -35%, 0.8 s stumble, speed drop', () => {
    // #given a courier with FLOW to lose heading into a centre barrier
    const flow = 40000
    const states = simulate(stateOn(barrierTrack, { flow }), 30)
    const baseline = simulate(stateOn(control, { flow }), 30)
    // #when it crosses the barrier
    const hitIndex = indexOfEvent(states, EVENT.HIT)
    const hit = states[hitIndex]!
    // #then the hit costs exactly the HIT share and starts a stumble
    expect(hitIndex).toBeGreaterThan(0)
    expect(baseline[hitIndex]!.flow - hit.flow).toBe(FLOW.HIT)
    expect(hit.stumbleTicks).toBe(STUMBLE_TICKS)
    expect(hit.speed).toBeLessThanOrEqual(STUMBLE_SPEED)
    expect(hit.metrics.hits).toBe(1)
  })

  it('clears a barrier with a jump for a near miss', () => {
    const states = simulate(stateOn(barrierTrack), 30, firstThen(JUMP))
    expect(allEvents(states) & EVENT.HIT).toBe(0)
    expect(allEvents(states) & EVENT.NEAR_MISS).toBe(EVENT.NEAR_MISS)
  })

  it('rewards passing within 0.6 m of a barrier and ignores wider berths', () => {
    const close = simulate(stateOn(testTrack({ hazards: [hazardAt('barrier', 6, { x: Math.trunc(3 * M / 2) })] })), 30)
    const wide = simulate(stateOn(testTrack({ hazards: [hazardAt('barrier', 6, { x: 3 * M })] })), 30)
    expect(allEvents(close) & (EVENT.NEAR_MISS | EVENT.HIT)).toBe(EVENT.NEAR_MISS)
    expect(allEvents(wide) & (EVENT.NEAR_MISS | EVENT.HIT)).toBe(0)
  })

  it('ignores further hazards while stumbling', () => {
    const track = testTrack({ hazards: [hazardAt('barrier', 6), hazardAt('barrier', 10)] })
    const states = simulate(stateOn(track), 40)
    expect(states.at(-1)!.metrics.hits).toBe(1)
  })

  it('requires a slide under a beam', () => {
    const track = testTrack({ hazards: [hazardAt('beam', 6, { half: 4 * M })] })
    expect(allEvents(simulate(stateOn(track), 30)) & EVENT.HIT).toBe(EVENT.HIT)
    expect(allEvents(simulate(stateOn(track), 30, firstThen(SLIDE))) & EVENT.HIT).toBe(0)
  })

  it('lets a courier slide under a drone but not jump into it', () => {
    const track = testTrack({ hazards: [hazardAt('drone', 6)] })
    expect(allEvents(simulate(stateOn(track), 30, firstThen(SLIDE))) & EVENT.HIT).toBe(0)
    expect(allEvents(simulate(stateOn(track), 30, firstThen(JUMP))) & EVENT.HIT).toBe(EVENT.HIT)
  })

  it('opens alternate door sides every half period and punishes the closed side and the post', () => {
    // #given a centred door with a 0.3 m post, open on the left for ticks 0-59
    const door = hazardAt('door', 0, { half: Math.trunc(3 * M / 10), period: 120 })
    // #then each lateral position resolves by side
    expect(doorOpenSide(door, 10)).toBe(-1)
    expect(doorOpenSide(door, 70)).toBe(1)
    expect(hazardOutcome(door, -2 * M, 0, 0, 10)).toBe(OUTCOME.CLEAR)
    expect(hazardOutcome(door, -Math.trunc(M / 2), 0, 0, 10)).toBe(OUTCOME.NEAR)
    expect(hazardOutcome(door, 0, 0, 0, 10)).toBe(OUTCOME.HIT)
    expect(hazardOutcome(door, 2 * M, 0, 0, 10)).toBe(OUTCOME.HIT)
    expect(hazardOutcome(door, 2 * M, 0, 0, 70)).toBe(OUTCOME.CLEAR)
  })

  it('blocks one half of the track with a train unless the courier is above 2 m', () => {
    const train = hazardAt('train', 0, { half: 4 * M, period: 200 })
    expect(trainBlockedSide(train, 10)).toBe(1)
    expect(trainBlockedSide(train, 110)).toBe(-1)
    expect(hazardOutcome(train, -2 * M, 0, 0, 10)).toBe(OUTCOME.CLEAR)
    expect(hazardOutcome(train, 2 * M, 0, 0, 10)).toBe(OUTCOME.HIT)
    expect(hazardOutcome(train, 2 * M, 3 * M, 0, 10)).toBe(OUTCOME.NEAR)
    expect(hazardOutcome(train, -Math.trunc(3 * M / 10), 0, 0, 10)).toBe(OUTCOME.NEAR)
  })

  it('moves sweepers and drones on an integer triangle wave inside their amplitude', () => {
    // #given a sweeper with a 2 m amplitude and a 100 tick period
    const sweeper = hazardAt('sweeper', 0, { amplitude: 2 * M, period: 100, half: Math.trunc(8 * M / 10) })
    // #when sampling two full periods
    const positions = Array.from({ length: 200 }, (_, tick) => hazardLateral(sweeper, tick))
    // #then it swings edge to edge, stays in range and repeats exactly
    expect([positions[0], positions[25], positions[50], positions[75]]).toEqual([-2 * M, 0, 2 * M, 0])
    expect(positions.every(x => Number.isSafeInteger(x) && x >= -2 * M && x <= 2 * M)).toBe(true)
    expect(positions.slice(100)).toEqual(positions.slice(0, 100))
    expect(hazardOutcome(sweeper, 0, 0, 0, 25)).toBe(OUTCOME.HIT)
    expect(hazardOutcome(sweeper, 0, 0, 0, 50)).toBe(OUTCOME.CLEAR)
  })

  it('drops a grounded courier into a gap: FLOW -45%, 1.2 s stumble', () => {
    const flow = 40000
    const gapTrack = testTrack({ gaps: [zoneAt(3, 12)] })
    const states = simulate(stateOn(gapTrack, { flow }), 30)
    const baseline = simulate(stateOn(control, { flow }), 30)
    const fallIndex = indexOfEvent(states, EVENT.FALL)
    expect(fallIndex).toBeGreaterThan(0)
    expect(baseline[fallIndex]!.flow - states[fallIndex]!.flow).toBe(FLOW.FALL)
    expect(states[fallIndex]!.stumbleTicks).toBe(FALL_STUMBLE_TICKS)
  })

  it('carries an airborne courier over a gap but drops one that lands inside it', () => {
    const shortGap = simulate(stateOn(testTrack({ gaps: [zoneAt(1, 3)] }), { y: 2 * M }), 60)
    const longGap = simulate(stateOn(testTrack({ gaps: [zoneAt(1, 60)] }), { y: 2 * M }), 60)
    expect(allEvents(shortGap) & (EVENT.FALL | EVENT.LAND)).toBe(EVENT.LAND)
    expect(allEvents(longGap) & EVENT.FALL).toBe(EVENT.FALL)
  })
})

// ---------------------------------------------------------------------------
// Gates, FLOW, rails, pads
// ---------------------------------------------------------------------------

describe('relay leg gates and FLOW', () => {
  const flow = 30000

  function flowDelta(track: Track, patch: Partial<State> = {}, event: number = EVENT.PERFECT_GATE | EVENT.MISSED_GATE): { delta: number; events: number } {
    const states = simulate(stateOn(track, { flow, ...patch }), 20)
    const baseline = simulate(stateOn(testTrack(), { flow, ...patch }), 20)
    const index = indexOfEvent(states, event)
    if (index < 0) throw new Error('gate never crossed')
    return { delta: states[index]!.flow - baseline[index]!.flow, events: states[index]!.events }
  }

  it('pays +5% for a perfect gate and takes 4% for a missed one', () => {
    const gate = { dist: 3 * M, x: 0, half: M, kind: 'gold', path: 'main' } as const
    const perfect = flowDelta(testTrack({ gates: [gate] }))
    const missed = flowDelta(testTrack({ gates: [{ ...gate, x: 3 * M }] }))
    expect(perfect).toEqual({ delta: FLOW.PERFECT_GATE, events: EVENT.PERFECT_GATE })
    expect(missed).toEqual({ delta: -FLOW.MISSED_GATE, events: EVENT.MISSED_GATE })
  })

  it('pays a pulse gate +9% on the beat and +3% off it', () => {
    // #given a pulse gate just inside the pulse section and a courier arriving next tick
    const gate = { dist: 551 * M, x: 0, half: M, kind: 'pulse', path: 'main' } as const
    const track = testTrack({ gates: [gate] })
    const arriving = { dist: 551 * M - 1000, speed: M }
    // #when the crossing tick lands on the beat (tick 28) or off it (tick 11)
    const onBeatRun = simulate(stateOn(track, { ...arriving, flow, tick: 27 }), 1)[0]!
    const offBeatRun = simulate(stateOn(track, { ...arriving, flow, tick: 10 }), 1)[0]!
    const control = (tick: number): State => simulate(stateOn(testTrack(), { ...arriving, flow, tick }), 1)[0]!
    // #then only the on-beat crossing is a PULSE_HIT
    expect(onBeatRun.events & (EVENT.PULSE_HIT | EVENT.PERFECT_GATE)).toBe(EVENT.PULSE_HIT | EVENT.PERFECT_GATE)
    expect(onBeatRun.flow - control(27).flow).toBe(FLOW.PULSE_GATE)
    expect(offBeatRun.events & (EVENT.PULSE_HIT | EVENT.PERFECT_GATE)).toBe(EVENT.PERFECT_GATE)
    expect(offBeatRun.flow - control(10).flow).toBe(FLOW.OFFBEAT_PULSE_GATE)
  })

  it('is on beat only inside the pulse section when given a distance', () => {
    const track = testTrack()
    expect(onBeat(track, 28, 560 * M)).toBe(true)
    expect(onBeat(track, 36, 560 * M)).toBe(false)
    expect(onBeat(track, 28, 100 * M)).toBe(false)
    expect(onBeat(track, 28)).toBe(true)
  })

  it('drains FLOW by about 1.5% per second when nothing is earned', () => {
    const states = simulate(stateOn(testTrack(), { flow }), 60)
    expect(flow - states.at(-1)!.flow).toBe(FLOW.DECAY_TICK * 60)
  })

  it('fires FLOW_MAX when FLOW reaches full', () => {
    const gate = { dist: 3 * M, x: 0, half: M, kind: 'gold', path: 'main' } as const
    const states = simulate(stateOn(testTrack({ gates: [gate] }), { flow: ONE - 500 }), 20)
    const maxed = stateWithEvent(states, EVENT.FLOW_MAX)
    expect(maxed.flow).toBe(ONE)
    expect(maxed.metrics.flowPeak).toBe(ONE)
  })

  it('grinds rails: RAIL_ON, per-tick FLOW, RAIL_OFF when steering off', () => {
    // #given a centre rail over the first 100 m
    const track = testTrack({ rails: [zoneAt(0, 100, { half: M })] })
    const states = simulate(stateOn(track, { flow }), 60, index => ({ steer: index < 20 ? 0 : 64, action: ACTION_NONE }))
    const baseline = simulate(stateOn(testTrack(), { flow }), 1)[0]!
    // #then the first tick locks on, pays, and steering away unlocks
    expect(states[0]!.events & EVENT.RAIL_ON).toBe(EVENT.RAIL_ON)
    expect(states[0]!.flow - baseline.flow).toBe(FLOW.RAIL_TICK)
    expect(allEvents(states) & EVENT.RAIL_OFF).toBe(EVENT.RAIL_OFF)
    expect(states.at(-1)!.railing).toBe(0)
    expect(states.at(-1)!.metrics.railTicks).toBeGreaterThanOrEqual(20)
  })

  it('speeds up on boost pads, and only on the beat inside the pulse section', () => {
    const padTrack = testTrack({ boostPads: [zoneAt(0, 100), zoneAt(550, 580)] })
    const boosted = simulate(stateOn(padTrack), 60).at(-1)!
    const plain = simulate(stateOn(testTrack()), 60).at(-1)!
    expect(boosted.dist).toBeGreaterThan(plain.dist)
    expect(boosted.metrics.boostPadTicks).toBe(60)
    const pulseStart = { dist: 552 * M }
    expect(step(stateOn(padTrack, { ...pulseStart, tick: 27 }), NONE).events & EVENT.BOOST_PAD).toBe(EVENT.BOOST_PAD)
    expect(step(stateOn(padTrack, { ...pulseStart, tick: 10 }), NONE).events & EVENT.BOOST_PAD).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Fork and finish
// ---------------------------------------------------------------------------

describe('relay leg fork', () => {
  const beforeFork = { dist: 400 * M - 1000 }

  it('takes the risk path only when x is on the risk side at the split', () => {
    const risk = step(stateOn(testTrack(), { ...beforeFork, x: M }), { steer: 16, action: ACTION_NONE })
    const safe = step(stateOn(testTrack(), { ...beforeFork, x: -M }), { steer: -16, action: ACTION_NONE })
    const centre = step(stateOn(testTrack(), beforeFork), NONE)
    expect([risk.path, risk.events & EVENT.FORK_RISK]).toEqual(['risk', EVENT.FORK_RISK])
    expect([safe.path, safe.events & EVENT.FORK_SAFE]).toEqual(['safe', EVENT.FORK_SAFE])
    expect(centre.path).toBe('safe')
  })

  it('progresses faster on the risk path at the same speed', () => {
    const inside = { dist: 410 * M, speed: M, flow: 30000 }
    const risk = simulate(stateOn(testTrack(), { ...inside, path: 'risk', riskClean: 1 }), 30).at(-1)!
    const safe = simulate(stateOn(testTrack(), { ...inside, path: 'safe' }), 30).at(-1)!
    expect(risk.speed).toBe(safe.speed)
    expect(risk.dist).toBeGreaterThan(safe.dist)
  })

  it('only applies features on the path the courier took', () => {
    const track = testTrack({ hazards: [hazardAt('barrier', 420, { path: 'risk' })] })
    const inside = { dist: 415 * M, speed: M }
    expect(allEvents(simulate(stateOn(track, { ...inside, path: 'risk' }), 10)) & EVENT.HIT).toBe(EVENT.HIT)
    expect(allEvents(simulate(stateOn(track, { ...inside, path: 'safe' }), 10)) & EVENT.HIT).toBe(0)
  })

  it('pays RISK_CLEAR for a clean risk path and nothing after a hit', () => {
    const exiting = { dist: 500 * M - 1000, speed: M, path: 'risk' as const }
    const clean = step(stateOn(testTrack(), { ...exiting, riskClean: 1 }), NONE)
    const dirty = step(stateOn(testTrack(), { ...exiting, riskClean: 0 }), NONE)
    expect([clean.path, clean.events & EVENT.RISK_CLEAR, clean.metrics.riskRoutes]).toEqual(['main', EVENT.RISK_CLEAR, 1])
    expect([dirty.path, dirty.events & EVENT.RISK_CLEAR, dirty.metrics.riskRoutes]).toEqual(['main', 0, 1])
  })

  it('voids RISK_CLEAR when the courier is hit on the risk path', () => {
    // #given a barrier on the risk line right after the split
    const track = testTrack({ hazards: [hazardAt('barrier', 401, { path: 'risk' })] })
    // #when riding the risk path into it and on to the rejoin
    const states = simulate(stateOn(track, { dist: 399 * M, x: M, speed: M }), 600, () => ({ steer: 16, action: ACTION_NONE }))
    const rejoined = states.findIndex(state => state.path === 'main' && state.dist >= 500 * M)
    // #then the risk route counts but pays no RISK_CLEAR
    expect(rejoined).toBeGreaterThan(0)
    expect(states[rejoined]!.metrics.riskRoutes).toBe(1)
    expect(allEvents(states) & (EVENT.FORK_RISK | EVENT.HIT | EVENT.RISK_CLEAR)).toBe(EVENT.FORK_RISK | EVENT.HIT)
  })
})

describe('relay leg finish', () => {
  it('finishes on reaching the finish distance and stays finished', () => {
    const finished = step(stateOn(testTrack(), { dist: 600 * M - 1000, speed: M }), NONE)
    expect([finished.finished, finished.dist, finished.events & EVENT.FINISH]).toEqual([1, 600 * M, EVENT.FINISH])
    expect(step(finished, JUMP)).toBe(finished)
  })

  it('ends an unfinished leg at MAX_TICKS as incomplete with no score', () => {
    const capped = step(stateOn(testTrack(), { tick: MAX_TICKS - 1 }), NONE)
    const result = finalize(capped, [[0, 0, 0]])
    expect([capped.finished, capped.events & EVENT.FINISH]).toEqual([1, 0])
    expect([result.completed, result.score, result.ticks, result.timeMs]).toEqual([false, 0, MAX_TICKS, 90000])
  })
})

// ---------------------------------------------------------------------------
// Traces, replay and result
// ---------------------------------------------------------------------------

describe('relay leg traces', () => {
  it('accepts a well-formed trace', () => {
    const trace: Sample[] = [[0, -64, 0], [12, 64, 1], [1, 0, 2]]
    expect(validateTrace(trace)).toEqual({ ok: true, trace })
  })

  it('rejects malformed traces with a code and index', () => {
    const cases: [unknown, string, number][] = [
      ['nope', 'count', -1],
      [[], 'count', -1],
      [Array.from({ length: MAX_TICKS + 1 }, (_, i) => [i === 0 ? 0 : 1, 0, 0]), 'count', -1],
      [[[0, 0]], 'shape', 0],
      [[[0, 0, 0, 0]], 'shape', 0],
      [[[0, 0, 0], 'x'], 'shape', 1],
      [[[1, 0, 0]], 'order', 0],
      [[[0, 0, 0], [0, 0, 0]], 'order', 1],
      [[[0, 0, 0], [-3, 0, 0]], 'order', 1],
      [[[0, 0, 0], [1.5, 0, 0]], 'order', 1],
      [[[0, 65, 0]], 'input', 0],
      [[[0, -65, 0]], 'input', 0],
      [[[0, 0.5, 0]], 'input', 0],
      [[[0, 0, 3]], 'input', 0],
      [[[0, 0, '1']], 'input', 0],
      [[[0, 0, 0], [MAX_TICKS, 0, 0]], 'after-end', 1],
    ]
    for (const [trace, code, index] of cases) {
      expect(validateTrace(trace), `${code} ${JSON.stringify(trace).slice(0, 40)}`).toEqual({ ok: false, error: { code, index } })
    }
  })

  it(`rejects traces over ${MAX_TRACE_BYTES} canonical bytes`, () => {
    const trace = Array.from({ length: MAX_TICKS }, (_, i) => [i === 0 ? 0 : 100000, -64, 2])
    const result = validateTrace(trace, Number.MAX_SAFE_INTEGER)
    expect(result.ok ? 'ok' : result.error.code).toBe('size')
  })

  it('holds steer between samples and fires actions only on their sample tick', () => {
    // #given a jump at tick 0 and a slide at tick 4
    const cursor = new InputCursor([[0, 25, ACTION_JUMP], [4, -12, ACTION_SLIDE]])
    // #then actions are impulses while steer holds
    expect(cursor.at(0)).toEqual({ steer: 25, action: ACTION_JUMP })
    expect(cursor.at(1)).toEqual({ steer: 25, action: ACTION_NONE })
    expect(cursor.at(4)).toEqual({ steer: -12, action: ACTION_SLIDE })
    expect(cursor.at(5)).toEqual({ steer: -12, action: ACTION_NONE })
  })

  it('refuses to read an invalid trace', () => {
    expect(() => new InputCursor([[1, 0, 0]])).toThrow(RangeError)
  })
})

describe('relay leg result', () => {
  const played = playLeg({ ...CONFIG, world: 'solar', seed: 'result' }, goodBot('risk'))

  it('replays a live leg to the identical result', () => {
    // #given a live leg and its recorded trace
    const live = finalize(played.state, played.trace)
    // #when the server replays the trace
    const verified = replay({ ...played.state.config, inputTrace: played.trace })
    // #then everything, hash included, matches
    expect(verified).toEqual(live)
    expect(verified.completed).toBe(true)
    expect(verified.resultHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires a finished state to finalize', () => {
    expect(() => finalize(createState(CONFIG), [[0, 0, 0]])).toThrow(RangeError)
  })

  it('rejects malformed traces and samples after the finish', () => {
    const idle = replay({ ...CONFIG, inputTrace: [[0, 0, 0]] })
    expect(() => replay({ ...CONFIG, inputTrace: [[0, 0, 0], [idle.ticks, 0, 0]] })).toThrow(RangeError)
    expect(() => replay({ ...CONFIG, inputTrace: [] })).toThrow(RangeError)
  })

  it('binds world, tier and opening FLOW into the hash and ignores unknown config fields', () => {
    const inputTrace: Sample[] = [[0, 0, 0]]
    const base = replay({ ...CONFIG, inputTrace }).resultHash
    expect(replay({ ...CONFIG, world: 'alpine', inputTrace }).resultHash).not.toBe(base)
    expect(replay({ ...CONFIG, tier: 2, inputTrace }).resultHash).not.toBe(base)
    expect(replay({ ...CONFIG, openingFlow: 1, inputTrace }).resultHash).not.toBe(base)
    const withExtraField = { ...CONFIG, inputTrace, issuedAt: 1726500000000 }
    expect(replay(withExtraField).resultHash).toBe(base)
  })

  it('derives time and score from the final state, time first', () => {
    const { state } = played
    const m = state.metrics
    const expected = 300000 - state.tick * 40 + m.perfectGates * 120 + m.pulseHits * 160 + m.nearMisses * 60
      + m.cleanLandings * 40 + m.riskRoutes * 400 - m.hits * 300 - m.falls * 500
      + Math.trunc(m.flowSum * 2000 / (state.tick * ONE))
    const result = finalize(state, played.trace)
    expect(result.timeMs).toBe(Math.trunc(state.tick * 1000 / 60))
    expect(result.score).toBe(expected)
    expect(score({ ...state, tick: state.tick + 60 })).toBeLessThan(result.score)
  })

  it('hashes the rules string', () => {
    expect(RULES_HASH).toBe(sha256(RULES))
    expect(RULES).toMatch(/^relay-leg-v5:/)
  })
})

// ---------------------------------------------------------------------------
// Playability across authored content
// ---------------------------------------------------------------------------

describe('relay leg playability', () => {
  const SEEDS = 20

  function legConfig(world: Config['world'], tier: Tier, index: number): Config {
    return { ...CONFIG, world, tier, seed: `play-${index}`, openingFlow: (index * 811) % (MAX_OPENING_FLOW + 1) }
  }

  it('lets a good courier finish tier 0 and tier 1 legs on every world in 32-50 s with average FLOW above 45%', () => {
    const failures: string[] = []
    for (const world of WORLDS) {
      for (const tier of [0, 1] as const) {
        for (let i = 0; i < SEEDS; i++) {
          // #given a route the good bot reads like a player
          const { state } = playLeg(legConfig(world, tier, i), goodBot('safe'))
          // #then it completes on time with FLOW mostly earned
          const seconds = state.tick / 60
          const flowPercent = state.metrics.flowSum * 100 / (state.tick * ONE)
          const completed = state.dist >= state.track.finishDist
          if (!completed || seconds < 32 || seconds > 50 || flowPercent <= 45) {
            failures.push(`${world} t${tier} #${i}: ${seconds.toFixed(1)} s, flow ${flowPercent.toFixed(0)}%, completed ${completed}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('lets a hands-off courier finish every world and tier in under 70 s', () => {
    const failures: string[] = []
    for (const world of WORLDS) {
      for (const tier of [0, 1, 2] as const) {
        for (let i = 0; i < SEEDS; i++) {
          const { state } = playLeg(legConfig(world, tier, i), idleBot)
          const completed = state.dist >= state.track.finishDist
          if (!completed || state.tick >= 70 * 60) failures.push(`${world} t${tier} #${i}: ${(state.tick / 60).toFixed(1)} s, completed ${completed}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('makes the risk route the faster line for a clean courier', () => {
    for (const world of WORLDS) {
      let riskTicks = 0
      let safeTicks = 0
      for (let i = 0; i < 10; i++) {
        riskTicks += playLeg(legConfig(world, 1, i), goodBot('risk')).state.tick
        safeTicks += playLeg(legConfig(world, 1, i), goodBot('safe')).state.tick
      }
      expect(riskTicks, world).toBeLessThan(safeTicks)
    }
  })
})
