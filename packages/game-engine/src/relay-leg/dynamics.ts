import { ONE } from '../fixed-point'
import {
  CROSSWIND_BLOW_FIFTHS,
  DRONE_HOP_TICKS,
  GANTRY_FALL_TICKS,
  HIT_MARGIN,
  LANE_WIDTH,
  LOW_HAZARD_HEIGHT,
  MACHINE_HALF,
  MACHINE_WARN_TICKS,
  NEAR_MISS_CLEARANCE,
  TRANSIT_WARN_TICKS,
  VEHICLE_HALF,
} from './constants'
import { laneCenterX, laneLayoutAt, laneSlots, type LaneLayout } from './geometry'
import type { Gate, Hazard, State, Track, WorldEvent, Zone } from './types'

/**
 * Time-based world truth: the beat, pulse gate lanes, moving hazards and world
 * events. Everything resolves against a tick; renderers pass `state.tick` so what
 * they draw is exactly what the simulation collides with.
 */

/** How a courier fares against one obstacle: untouched, a near miss or a hit. */
export const OUTCOME = { CLEAR: 0, NEAR: 1, HIT: 2 } as const
export type HazardOutcome = (typeof OUTCOME)[keyof typeof OUTCOME]

/** What an obstacle's blocked area does to a courier inside it. */
export const COLLISION = { NONE: 0, LOW: 1, OVERHEAD: 2, CRUSH: 3 } as const
export type CollisionClass = (typeof COLLISION)[keyof typeof COLLISION]
export type CollisionName = 'none' | 'low' | 'overhead' | 'crush'
const COLLISION_NAMES: readonly CollisionName[] = ['none', 'low', 'overhead', 'crush']

/** Clearance reported when nothing blocks the road. */
export const NO_BLOCK = 1 << 30

// ---------------------------------------------------------------------------
// Beat and pulse gates
// ---------------------------------------------------------------------------

/**
 * True on the beat window of the pulse section. With `dist` it also requires being
 * inside the section, which is what boost pads use; without it the answer is the pure
 * beat phase for music-synced presentation.
 */
export function onBeat(track: Readonly<Track>, tick: number, dist?: number): boolean {
  const pulse = track.pulse
  if (dist !== undefined && (dist < pulse.from || dist >= pulse.to)) return false
  return tick % pulse.period < pulse.window
}

/** Lane lit by a gate at `tick`: pulse gates light `lane` on even beats and `-lane` on odd beats. */
export function pulseGateLane(gate: Readonly<Gate>, tick: number): number {
  if (gate.kind !== 'pulse' || gate.period <= 0) return gate.lane
  return Math.trunc(tick / gate.period) % 2 === 0 ? gate.lane : -gate.lane
}

// ---------------------------------------------------------------------------
// Lane blocks
// ---------------------------------------------------------------------------

/** Half-extent of a blocked lane around its centre. */
export function blockHalf(layout: Readonly<LaneLayout>): number {
  return Math.trunc(layout.width / 2) - HIT_MARGIN
}

/**
 * Signed lateral clearance from `x` to the area blocked by `lanes` (sorted slots):
 * negative inside. Adjacent blocked lanes merge into one area, and blocking every lane
 * closes the shoulders too, so neither the lane line nor the shoulder slips past.
 */
export function laneBlockClearance(layout: Readonly<LaneLayout>, lanes: readonly number[], x: number): number {
  if (lanes.length === 0) return NO_BLOCK
  const half = blockHalf(layout)
  let clearance = NO_BLOCK
  let runStart = 0
  for (let i = 1; i <= lanes.length; i++) {
    if (i < lanes.length && lanes[i]! === lanes[i - 1]! + 2) continue
    const first = lanes[runStart]!
    const last = lanes[i - 1]!
    const spansRoad = first <= 1 - layout.count && last >= layout.count - 1
    const low = spansRoad ? -layout.halfWidth - ONE : laneCenterX(first, layout.width) - half
    const high = spansRoad ? layout.halfWidth + ONE : laneCenterX(last, layout.width) + half
    clearance = Math.min(clearance, intervalClearance(low, high, x))
    runStart = i
  }
  return clearance
}

function intervalClearance(low: number, high: number, x: number): number {
  if (x < low) return low - x
  if (x > high) return x - high
  return -Math.min(x - low, high - x)
}

function bodyClearance(bodyX: number, half: number, x: number): number {
  return Math.abs(x - bodyX) - half
}

/** Resolves a courier against one blocked area at one instant. */
export function collisionOutcome(collision: CollisionClass, clearance: number, y: number, slideTicks: number): HazardOutcome {
  if (collision === COLLISION.NONE) return OUTCOME.CLEAR
  if (clearance >= 0) return clearance <= NEAR_MISS_CLEARANCE ? OUTCOME.NEAR : OUTCOME.CLEAR
  if (collision === COLLISION.LOW) return y >= LOW_HAZARD_HEIGHT ? OUTCOME.NEAR : OUTCOME.HIT
  if (collision === COLLISION.OVERHEAD) return slideTicks > 0 ? OUTCOME.NEAR : OUTCOME.HIT
  return OUTCOME.HIT
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

/**
 * Lateral centre (Q16.16 m) of a hazard at `tick`. Sweepers and drones move on an integer
 * triangle wave between the centres of `lanes[0]` and `lanes[1]`; static hazards report the
 * middle of their blocked lanes.
 */
export function hazardLaneAt(hazard: Readonly<Hazard>, tick: number, laneWidth: number = LANE_WIDTH): number {
  const lanes = hazard.lanes
  if (lanes.length === 0) return 0
  const from = laneCenterX(lanes[0]!, laneWidth)
  const to = laneCenterX(lanes[lanes.length - 1]!, laneWidth)
  if ((hazard.kind !== 'sweeper' && hazard.kind !== 'drone') || hazard.period <= 0) return Math.trunc((from + to) / 2)
  const cycle = (tick + hazard.phase) % hazard.period
  const rising = cycle * 2 < hazard.period ? cycle : hazard.period - cycle
  return from + Math.trunc((to - from) * rising * 2 / hazard.period)
}

export function hazardCollision(hazard: Readonly<Hazard>): CollisionClass {
  switch (hazard.kind) {
    case 'barrier':
    case 'sweeper':
      return COLLISION.LOW
    case 'beam':
    case 'drone':
      return COLLISION.OVERHEAD
    case 'gust':
      return COLLISION.NONE
  }
}

export function hazardClearance(hazard: Readonly<Hazard>, layout: Readonly<LaneLayout>, tick: number, x: number): number {
  if (hazard.kind === 'gust') return NO_BLOCK
  if (hazard.kind === 'barrier' || hazard.kind === 'beam') return laneBlockClearance(layout, hazard.lanes, x)
  return bodyClearance(hazardLaneAt(hazard, tick, layout.width), blockHalf(layout), x)
}

// ---------------------------------------------------------------------------
// World events
// ---------------------------------------------------------------------------

export type EventPhase = 'dormant' | 'telegraph' | 'active' | 'settled'

/** Ticks since the event triggered, or -1 while dormant. */
export function eventAge(event: Readonly<WorldEvent>, eventTicks: readonly number[], tick: number): number {
  const triggered = eventTicks[event.id] ?? -1
  return triggered < 0 ? -1 : tick - triggered
}

/** Telegraph length and active length (0 = open-ended) of an event's timeline. */
function timeline(event: Readonly<WorldEvent>): { telegraph: number; active: number } {
  switch (event.kind) {
    case 'maintenance-drone':
      return { telegraph: MACHINE_WARN_TICKS, active: event.duration - MACHINE_WARN_TICKS }
    case 'transit-crossing':
      return { telegraph: TRANSIT_WARN_TICKS, active: event.duration - TRANSIT_WARN_TICKS }
    case 'collapsing-gantry':
      return { telegraph: event.duration, active: GANTRY_FALL_TICKS }
    default:
      return { telegraph: event.duration, active: 0 }
  }
}

export function eventPhase(event: Readonly<WorldEvent>, age: number): EventPhase {
  if (age < 0) return 'dormant'
  const { telegraph, active } = timeline(event)
  if (age < telegraph) return 'telegraph'
  return active === 0 || age < telegraph + active ? 'active' : 'settled'
}

/** 0..ONE through the current phase; open-ended active phases and settled report ONE. */
export function eventProgress(event: Readonly<WorldEvent>, age: number): number {
  if (age < 0) return 0
  const { telegraph, active } = timeline(event)
  if (age < telegraph) return Math.trunc(age * ONE / telegraph)
  if (active > 0 && age < telegraph + active) return Math.trunc((age - telegraph) * ONE / active)
  return ONE
}

/** Span events act over `[dist, dist + length)`; the rest act on the line at `dist`. */
export function eventIsSpan(event: Readonly<WorldEvent>): boolean {
  return event.kind === 'lane-closure' || event.kind === 'crosswind'
}

export function eventCollision(event: Readonly<WorldEvent>, age: number): CollisionClass {
  const phase = eventPhase(event, age)
  if (phase === 'dormant') return COLLISION.NONE
  switch (event.kind) {
    case 'lane-closure':
      return phase === 'active' ? COLLISION.LOW : COLLISION.NONE
    case 'maintenance-drone':
      return COLLISION.LOW
    case 'transit-crossing':
      return phase === 'active' ? COLLISION.LOW : COLLISION.NONE
    case 'collapsing-gantry':
      return phase === 'telegraph' ? COLLISION.OVERHEAD : phase === 'active' ? COLLISION.CRUSH : COLLISION.LOW
    case 'drone-pattern':
      return phase === 'active' ? COLLISION.OVERHEAD : COLLISION.NONE
    default:
      return COLLISION.NONE
  }
}

/** Number of moving bodies an event has: the machine, the vehicle or the drones. */
export function eventBodyCount(event: Readonly<WorldEvent>): number {
  if (event.kind === 'maintenance-drone' || event.kind === 'transit-crossing') return 1
  return event.kind === 'drone-pattern' ? event.count : 0
}

/** Half-extent (Q16.16 m) of an event body's blocked area. */
export function eventBodyHalf(event: Readonly<WorldEvent>, layout: Readonly<LaneLayout>): number {
  if (event.kind === 'maintenance-drone') return MACHINE_HALF - HIT_MARGIN
  if (event.kind === 'transit-crossing') return VEHICLE_HALF - HIT_MARGIN
  return blockHalf(layout)
}

/** Lateral centre (Q16.16 m) of body `index` of an event `age` ticks after it triggered. */
export function eventBodyX(event: Readonly<WorldEvent>, age: number, laneWidth: number, index: number): number {
  switch (event.kind) {
    case 'maintenance-drone':
      return driftX(event, age, laneWidth, MACHINE_WARN_TICKS)
    case 'transit-crossing':
      return driftX(event, age, laneWidth, TRANSIT_WARN_TICKS)
    case 'drone-pattern':
      return droneX(event, age, laneWidth, index)
    default:
      return 0
  }
}

/** Moves from the first to the last lane of `lanes` between `warn` and `duration`. */
function driftX(event: Readonly<WorldEvent>, age: number, laneWidth: number, warn: number): number {
  const from = laneCenterX(event.lanes[0]!, laneWidth)
  const to = laneCenterX(event.lanes[event.lanes.length - 1]!, laneWidth)
  const travel = event.duration - warn
  const moved = Math.min(Math.max(age - warn, 0), travel)
  return from + Math.trunc((to - from) * moved / travel)
}

/**
 * Drones hold a formation over consecutive lanes of `lanes` and step it one lane at a time,
 * back and forth, every `period` ticks, gliding over the last DRONE_HOP_TICKS of each step.
 * `count < lanes.length`, so one lane is always free.
 */
function droneX(event: Readonly<WorldEvent>, age: number, laneWidth: number, index: number): number {
  const span = event.lanes.length - event.count
  const time = Math.max(age - event.duration, 0)
  const step = Math.trunc(time / event.period)
  const within = time % event.period
  const here = laneCenterX(event.lanes[formationOffset(step, span) + index]!, laneWidth)
  const hopStart = event.period - DRONE_HOP_TICKS
  if (within < hopStart) return here
  const next = laneCenterX(event.lanes[formationOffset(step + 1, span) + index]!, laneWidth)
  return here + Math.trunc((next - here) * (within - hopStart) / DRONE_HOP_TICKS)
}

function formationOffset(step: number, span: number): number {
  const cycle = step % (2 * span)
  return cycle <= span ? cycle : 2 * span - cycle
}

export function eventClearance(event: Readonly<WorldEvent>, age: number, layout: Readonly<LaneLayout>, x: number): number {
  if (event.kind === 'lane-closure' || event.kind === 'collapsing-gantry') return laneBlockClearance(layout, event.lanes, x)
  const bodies = eventBodyCount(event)
  const half = eventBodyHalf(event, layout)
  let clearance = NO_BLOCK
  for (let i = 0; i < bodies; i++) clearance = Math.min(clearance, bodyClearance(eventBodyX(event, age, layout.width, i), half, x))
  return clearance
}

/** Crosswind push right now, signed millimetres per tick; it builds over the telegraph, then gusts. */
export function eventPush(event: Readonly<WorldEvent>, age: number): number {
  if (event.kind !== 'crosswind' || age < 0) return 0
  if (age < event.duration) return Math.trunc(event.amplitude * age / event.duration)
  const cycle = (age - event.duration) % event.period
  return cycle * 5 < event.period * CROSSWIND_BLOW_FIFTHS ? event.amplitude : 0
}

/** Rising bridges and bridge breaks turn the ramps inside their span into speed-gated launches. */
export function isGatingEvent(event: Readonly<WorldEvent>): boolean {
  return event.kind === 'rising-bridge' || event.kind === 'bridge-break'
}

/** The rising-bridge or bridge-break event gating a ramp, or null for an ordinary ramp. */
export function gatingEventFor(track: Readonly<Track>, ramp: Readonly<Zone>): WorldEvent | null {
  const events = track.events
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    if (!isGatingEvent(event) || event.path !== ramp.path) continue
    if (ramp.from >= event.dist && ramp.to <= event.dist + event.length) return event
  }
  return null
}

export interface EventView {
  phase: EventPhase
  /** 0..ONE through the current phase. */
  progress: number
  collision: CollisionName
  /** Lateral centres (Q16.16 m, event path frame) of the moving bodies. */
  x: readonly number[]
  /** Half-extent (Q16.16 m) of each body's blocked area. */
  half: number
  /** Lane slots blocked right now. */
  lanes: readonly number[]
  /** Crosswind push right now, signed millimetres per tick. */
  push: number
}

/** Everything a renderer or bot needs to draw or read an event on `state`'s tick. */
export function eventState(event: Readonly<WorldEvent>, state: Readonly<State>): EventView {
  const age = eventAge(event, state.eventTicks, state.tick)
  const layout = laneLayoutAt(state.track, event.dist, event.path)
  const collision = eventCollision(event, age)
  const x = Array.from({ length: eventBodyCount(event) }, (_, i) => eventBodyX(event, Math.max(age, 0), layout.width, i))
  const lanes = collision === COLLISION.NONE
    ? []
    : laneSlots(layout.count).filter(slot => eventClearance(event, Math.max(age, 0), layout, laneCenterX(slot, layout.width)) < 0)
  return {
    phase: eventPhase(event, age),
    progress: eventProgress(event, age),
    collision: COLLISION_NAMES[collision]!,
    x,
    half: eventBodyHalf(event, layout),
    lanes,
    push: eventPush(event, age),
  }
}
