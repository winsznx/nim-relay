import { ONE } from '../fixed-point'
import {
  ACQUIRE_DISTANCE,
  ACQUIRE_SPEED,
  ACTION_BUFFER_TICKS,
  BASE_SPEED,
  EDGE_OVERSHOOT,
  EDGE_RELEASE_SPEED,
  FALL_TICKS,
  FLOW,
  FLOW_SPEED,
  GRAVITY,
  GRIND_DRAG,
  GRIND_WINDOW_TICKS,
  GUST_OFFSET_TICKS,
  HARD_IMPACT_SPEED,
  JUMP_VELOCITY,
  LANE_CHANGE_REWARD_TICKS,
  LANE_POLE_FAST,
  LANE_POLE_SLOW,
  NUDGE_STEP,
  PAD_SPEED,
  RAIL_SPEED,
  RESPAWN_SPEED,
  RESPAWN_STUMBLE_TICKS,
  RUSH_SPEED,
  SHOULDER_DRAG,
  SLIDE_TICKS,
  SPEED_SMOOTHING,
  STUMBLE_SPEED,
  TETHER_TICKS,
  WALL_BOUNCE_SPEED,
  WALL_STUMBLE_TICKS,
} from './constants'
import { eventAge, eventPush } from './dynamics'
import { addMoment, breakFlow, gainFlow, loseFlow, type Draft } from './flow'
import {
  activePathAt,
  checkpointBefore,
  edgeOnSide,
  forkAt,
  groundAt,
  laneCenterX,
  laneEdgeOf,
  laneLayoutAt,
  nearestLane,
  slotTargetX,
  type LaneLayout,
} from './geometry'
import { ACTION_JUMP, EVENT, type Input } from './types'
import { millimetres } from './units'

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

export function countDownTimers(s: Draft): void {
  if (s.stumbleTicks > 0) s.stumbleTicks--
  if (s.slideTicks > 0) s.slideTicks--
  // FLOW drains first so gains earned this tick can still reach full FLOW.
  if (s.rushTicks === 0) s.flow = Math.max(0, s.flow - FLOW.DECAY_TICK)
}

// ---------------------------------------------------------------------------
// Lane shifts
// ---------------------------------------------------------------------------

/**
 * A shift retargets one slot from `targetLane`: to the neighbouring lane, from an outer
 * lane onto the shoulder, and from the shoulder past the road edge. Shifting inward from
 * the shoulder or the edge line goes straight back to the outer lane.
 */
export function applyShift(s: Draft, shift: Input['shift'], layout: Readonly<LaneLayout>): void {
  if (shift === 0) return
  const next = shiftedSlot(s.targetLane, shift, layout.count)
  if (next === s.targetLane) return
  s.targetLane = next
  s.events |= EVENT.LANE_SHIFT
  s.metrics.laneChanges++
}

function shiftedSlot(from: number, shift: -1 | 1, count: number): number {
  const reach = Math.abs(from)
  const side = from < 0 ? -1 : 1
  if (reach <= count - 1) {
    const next = from + 2 * shift
    return Math.abs(next) <= count - 1 ? next : shift * count
  }
  if (side !== shift) return side * (count - 1)
  return reach === count ? shift * (count + 1) : from
}

/** Keeps `lane` and `targetLane` meaningful when the lane layout under the courier changes. */
function normaliseLanes(s: Draft, layout: Readonly<LaneLayout>): void {
  if (!isSlotOf(layout, s.targetLane)) s.targetLane = nearestLane(layout.count, layout.width, s.x)
  if (!isSlotOf(layout, s.lane)) s.lane = nearestLane(layout.count, layout.width, s.x)
}

function isSlotOf(layout: Readonly<LaneLayout>, slot: number): boolean {
  const reach = Math.abs(slot)
  if (reach >= layout.count) return reach <= layout.count + 1
  return (slot + layout.count - 1) % 2 === 0
}

// ---------------------------------------------------------------------------
// Lateral motion
// ---------------------------------------------------------------------------

/** Lateral wind push (Q16.16 m of target offset) from gust hazards and crosswinds at `dist`. */
export function windOffset(s: Draft, dist: number): number {
  const track = s.track
  let push = 0
  for (let i = 0; i < track.hazards.length; i++) {
    const hazard = track.hazards[i]!
    if (hazard.dist > dist) break
    if (hazard.kind !== 'gust' || dist >= hazard.dist + hazard.length) continue
    if (hazard.path === activePathAt(track, dist, s.path)) push += hazard.amplitude
  }
  for (let i = 0; i < track.events.length; i++) {
    const event = track.events[i]!
    if (event.dist > dist) break
    if (event.kind !== 'crosswind' || dist >= event.dist + event.length) continue
    if (event.path === activePathAt(track, dist, s.path)) push += eventPush(event, eventAge(event, s.eventTicks, s.tick))
  }
  return millimetres(push) * GUST_OFFSET_TICKS
}

/** Where the lane spring is pulling: the target slot, the held nudge and the wind. */
export function steerTargetX(s: Draft, layout: Readonly<LaneLayout>, wind: number): number {
  return slotTargetX(layout, s.targetLane) + s.nudge * NUDGE_STEP + wind
}

/** Spring gains for the lane spring: pole 68% at base speed tightening to 64% at full FLOW speed. */
export function laneSpring(speed: number): { stiffness: number; damping: number } {
  const over = Math.min(Math.max(speed - BASE_SPEED, 0), FLOW_SPEED)
  const pole = LANE_POLE_SLOW - Math.trunc((LANE_POLE_SLOW - LANE_POLE_FAST) * over / FLOW_SPEED)
  return { stiffness: Math.trunc((ONE - pole) * (ONE - pole) / ONE), damping: ONE - Math.trunc(pole * pole / ONE) }
}

/**
 * Moves the courier laterally for one tick and resolves the road edges. Riding couriers
 * follow a critically damped spring toward the steer target; grinding couriers stay pinned
 * to their rail.
 */
export function moveLaterally(s: Draft, layout: Readonly<LaneLayout>, wind: number, previousX: number): void {
  if (s.motion === 'grinding') {
    holdRail(s, layout)
    return
  }
  normaliseLanes(s, layout)
  const { stiffness, damping } = laneSpring(s.speed)
  const error = s.x - steerTargetX(s, layout, wind)
  s.vx = s.vx - Math.trunc(stiffness * error / ONE) - Math.trunc(damping * s.vx / ONE)
  s.x += s.vx
  const side: -1 | 1 = s.x < 0 ? -1 : 1
  if (Math.abs(s.x) > layout.halfWidth) {
    touchEdge(s, layout, side)
    return
  }
  const laneEdge = laneEdgeOf(layout)
  if (Math.abs(s.x) > laneEdge) {
    if (Math.abs(previousX) <= laneEdge) s.events |= EVENT.SHOULDER
    loseFlow(s, FLOW.SHOULDER_TICK)
  }
}

/** Settles into the target slot once the courier is on it and nearly still. */
export function acquireLane(s: Draft, layout: Readonly<LaneLayout>, wind: number): void {
  if (s.motion !== 'riding' || s.lane === s.targetLane) return
  const offTarget = Math.abs(s.x - steerTargetX(s, layout, wind))
  if (offTarget >= ACQUIRE_DISTANCE || Math.abs(s.vx) >= ACQUIRE_SPEED) return
  const realLanes = Math.abs(s.lane) < layout.count && Math.abs(s.targetLane) < layout.count
  const clean = realLanes && s.stumbleTicks === 0 && Math.abs(s.x) <= laneEdgeOf(layout)
  s.lane = s.targetLane
  s.events |= EVENT.LANE_ACQUIRED
  if (!clean) return
  s.metrics.cleanLaneChanges++
  if (s.metrics.cleanLaneChanges <= Math.trunc(s.tick / LANE_CHANGE_REWARD_TICKS) + 1) gainFlow(s, FLOW.CLEAN_LANE_CHANGE)
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function touchEdge(s: Draft, layout: Readonly<LaneLayout>, side: -1 | 1): void {
  const edge = edgeOnSide(layout, side)
  if (edge === 'open') fallOverEdge(s, layout, side)
  else if (edge === 'wall') bounceOffWall(s, layout, side)
  else startGrind(s, layout, side)
}

function startGrind(s: Draft, layout: Readonly<LaneLayout>, side: -1 | 1): void {
  const hard = Math.abs(s.vx) >= HARD_IMPACT_SPEED
  s.motion = 'grinding'
  s.motionTicks = GRIND_WINDOW_TICKS[s.track.tier]
  s.edgeSide = side
  s.x = side * layout.halfWidth
  s.vx = 0
  s.events |= EVENT.EDGE_GRIND
  s.metrics.edgeGrinds++
  loseFlow(s, hard ? FLOW.RAIL_IMPACT : FLOW.EDGE_CONTACT)
}

/** A wall shoves the courier back toward its outer lane: a stumble and a little FLOW, never a fall. */
function bounceOffWall(s: Draft, layout: Readonly<LaneLayout>, side: -1 | 1): void {
  s.motion = 'riding'
  s.motionTicks = 0
  s.edgeSide = 0
  s.x = side * layout.halfWidth
  s.vx = -side * WALL_BOUNCE_SPEED
  s.targetLane = side * (layout.count - 1)
  s.events |= EVENT.EDGE_GRIND
  s.stumbleTicks = Math.max(s.stumbleTicks, WALL_STUMBLE_TICKS)
  s.slideTicks = 0
  s.speed = Math.min(s.speed, BASE_SPEED)
  loseFlow(s, FLOW.WALL_BUMP)
}

/** Grinding: pinned to the rail while it lasts; the edge beside it can change under the courier. */
function holdRail(s: Draft, layout: Readonly<LaneLayout>): void {
  const side: -1 | 1 = s.edgeSide < 0 ? -1 : 1
  const edge = edgeOnSide(layout, side)
  if (edge === 'open') fallOverEdge(s, layout, side)
  else if (edge === 'wall') bounceOffWall(s, layout, side)
  else {
    s.x = side * layout.halfWidth
    s.vx = 0
    loseFlow(s, FLOW.GRIND_TICK)
  }
}

/**
 * Grind recovery: shifting or nudging inward inside the window saves it; shifting outward
 * or letting the window run out goes over the rail.
 */
export function resolveGrind(s: Draft, input: Input, layout: Readonly<LaneLayout>): void {
  const side: -1 | 1 = s.edgeSide < 0 ? -1 : 1
  if (input.shift === side) {
    fallOverEdge(s, layout, side)
    return
  }
  if (input.shift === -side || input.nudge * side < 0) {
    saveEdge(s, layout, side)
    return
  }
  s.motionTicks--
  if (s.motionTicks <= 0) fallOverEdge(s, layout, side)
}

function saveEdge(s: Draft, layout: Readonly<LaneLayout>, side: -1 | 1): void {
  s.motion = 'riding'
  s.motionTicks = 0
  s.edgeSide = 0
  s.targetLane = side * (layout.count - 1)
  s.vx = -side * EDGE_RELEASE_SPEED
  s.events |= EVENT.EDGE_SAVE
  s.metrics.edgeSaves++
  gainFlow(s, FLOW.EDGE_SAVE)
  addMoment(s, 'edge-save')
}

// ---------------------------------------------------------------------------
// Falls and the baton tether
// ---------------------------------------------------------------------------

function fallOverEdge(s: Draft, layout: Readonly<LaneLayout>, side: -1 | 1): void {
  fall(s)
  s.edgeSide = side
  s.x = side * (layout.halfWidth + EDGE_OVERSHOOT)
}

/** Starts a fall: FLOW -45%, Relay Rush over, the courier drops for FALL_TICKS while the clock runs. */
export function fall(s: Draft): void {
  s.events |= EVENT.FALL
  s.metrics.falls++
  breakFlow(s, FLOW.FALL)
  if (s.railing) s.events |= EVENT.RAIL_OFF
  s.motion = 'falling'
  s.motionTicks = FALL_TICKS
  s.vx = 0
  s.vy = Math.min(s.vy, 0)
  s.slideTicks = 0
  s.stumbleTicks = 0
  s.railing = 0
  s.airTicks = 0
  s.airCleared = 0
  s.riskClean = 0
  s.bufferedAction = 0
  s.bufferTicks = 0
}

export function advanceFall(s: Draft): void {
  s.vy -= GRAVITY
  s.y += s.vy
  s.motionTicks--
  if (s.motionTicks > 0) return
  s.vy = 0
  if (s.tetherSaves > 0) {
    s.tetherSaves--
    s.metrics.tetherSaves++
    s.motion = 'tethering'
    s.motionTicks = TETHER_TICKS
    s.events |= EVENT.TETHER_SAVE
    addMoment(s, 'tether-save')
    return
  }
  s.motion = 'failed'
  s.events |= EVENT.LEG_FAILED
  s.finished = 1
}

/** The tether hauls the courier back up to deck height, then respawns it at the checkpoint behind the fall. */
export function advanceTether(s: Draft): void {
  s.y = Math.trunc(s.y * (s.motionTicks - 1) / s.motionTicks)
  s.motionTicks--
  if (s.motionTicks === 0) respawn(s)
}

function respawn(s: Draft): void {
  const checkpoint = checkpointBefore(s.track, s.dist, s.path)
  const layout = laneLayoutAt(s.track, checkpoint.dist, checkpoint.path)
  s.dist = checkpoint.dist
  s.path = checkpoint.path
  s.lane = checkpoint.lane
  s.targetLane = checkpoint.lane
  s.x = laneCenterX(checkpoint.lane, layout.width)
  s.vx = 0
  s.y = 0
  s.vy = 0
  s.edgeSide = 0
  s.motion = 'riding'
  s.motionTicks = 0
  s.speed = RESPAWN_SPEED
  s.flow = Math.trunc(s.flow / 2)
  s.stumbleTicks = RESPAWN_STUMBLE_TICKS
  s.slideTicks = 0
  s.riskClean = 0
  s.hazardIdx = firstHazardAfter(s, checkpoint.dist)
  s.ground = groundAt(s.track, s.dist)
}

function firstHazardAfter(s: Draft, dist: number): number {
  const hazards = s.track.hazards
  let index = 0
  while (index < hazards.length && hazards[index]!.dist <= dist) index++
  return index
}

// ---------------------------------------------------------------------------
// Actions and vertical motion
// ---------------------------------------------------------------------------

export function resolveAction(s: Draft, pressed: Input['action']): void {
  const buffered = s.bufferTicks > 0 ? s.bufferedAction : 0
  if (s.bufferTicks > 0) s.bufferTicks--
  if (s.bufferTicks === 0) s.bufferedAction = 0
  const action = pressed !== 0 ? pressed : buffered
  if (action === 0) return
  if (tryAction(s, action)) {
    s.bufferedAction = 0
    s.bufferTicks = 0
  } else if (pressed !== 0) {
    s.bufferedAction = pressed
    s.bufferTicks = ACTION_BUFFER_TICKS
  }
}

function tryAction(s: Draft, action: 1 | 2): boolean {
  const grounded = s.y === 0 && s.vy === 0
  if (!grounded || s.motion !== 'riding') return false
  if (action === ACTION_JUMP) {
    if (s.stumbleTicks > 0) return false
    s.vy = JUMP_VELOCITY
    s.slideTicks = 0
    s.airCleared = 0
    s.metrics.jumps++
    s.events |= EVENT.JUMP
    return true
  }
  s.slideTicks = SLIDE_TICKS
  s.metrics.slides++
  s.events |= EVENT.SLIDE
  return true
}

/** Returns the length of the air sequence that ended this tick, or 0. */
export function integrateVertical(s: Draft): number {
  if (s.y === 0 && s.vy === 0) return 0
  s.vy -= GRAVITY
  s.y += s.vy
  s.airTicks++
  if (s.y > 0) return 0
  const airTicks = s.airTicks
  s.y = 0
  s.vy = 0
  s.airTicks = 0
  return airTicks
}

// ---------------------------------------------------------------------------
// Forward motion
// ---------------------------------------------------------------------------

export function updateSpeed(s: Draft, onPad: boolean, layout: Readonly<LaneLayout>): void {
  let target = STUMBLE_SPEED
  if (s.stumbleTicks === 0) {
    target = BASE_SPEED + Math.trunc(s.flow * FLOW_SPEED / ONE)
    if (s.rushTicks > 0) target += RUSH_SPEED
    if (s.railing) target += RAIL_SPEED
    if (onPad) target += PAD_SPEED
  }
  if (s.motion === 'grinding') target -= GRIND_DRAG
  else if (Math.abs(s.x) > laneEdgeOf(layout)) target -= SHOULDER_DRAG
  s.speed += Math.trunc((target - s.speed) / SPEED_SMOOTHING)
}

export function advance(s: Draft): void {
  const fork = s.path === 'risk' ? forkAt(s.track, s.dist) : null
  const progress = fork ? Math.trunc(s.speed * fork.riskProgress / ONE) : s.speed
  s.dist = Math.min(s.track.finishDist, s.dist + progress)
}
