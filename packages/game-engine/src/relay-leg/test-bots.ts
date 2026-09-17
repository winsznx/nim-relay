import { ONE } from '../fixed-point'
import {
  BASE_SPEED,
  CUT_LAUNCH_VELOCITY,
  DRAFT_MAX_LEAD_TICKS,
  FLOW_SPEED,
  GAP_CLEARANCE,
  GRAVITY,
  LOW_HAZARD_HEIGHT,
  NUDGE_STEP,
  RAMP_VELOCITY,
  RUSH_SPEED,
  STALL_LAUNCH_VELOCITY,
} from './constants'
import { zoneCovers } from './contact'
import {
  COLLISION,
  eventCollision,
  eventClearance,
  eventIsSpan,
  gatingEventFor,
  hazardClearance,
  hazardCollision,
  isGatingEvent,
  pulseGateLane,
  type CollisionClass,
} from './dynamics'
import {
  activePathAt,
  forkAt,
  forkOffsetSlots,
  forkPathFor,
  laneCenterX,
  laneLayoutAt,
  laneSlots,
  mainLanesAtFork,
  pathCode,
  segmentAt,
  type LaneLayout,
} from './geometry'
import { ghostPathCodeAt, ghostTickAt, ghostXAt } from './ghost-sample'
import { laneSpring } from './locomotion'
import { createState, step } from './sim'
import { centimetres, millimetres } from './units'
import { ACTION_JUMP, ACTION_SLIDE, NUDGE_RANGE, type Config, type Fork, type Input, type Path, type Sample, type State, type Zone } from './types'

/**
 * Deterministic, integer-only couriers for the tests and the golden corpus. The package
 * index doesn't export them.
 *
 * The skilled courier predicts its own lateral spring for every lane it could steer to, then
 * scores each lane against what it would meet there: hazards and world events at their
 * position on the arrival tick, gaps it would not be airborne over, the fork it plans to
 * take, gates and pulse gates lit on arrival, and the ghost's line to draft.
 */

export type ForkPlan = 'safe' | 'risk'
export type Policy = (state: State) => Input

const IDLE: Input = { shift: 0, nudge: 0, action: 0 }
export const idleBot: Policy = () => IDLE

const HORIZON = 72 * ONE
const PREDICT_TICKS = 160
const JUMP_LEAD_TICKS = 20
const MIN_JUMP_TICKS = 9
const JUMP_AIR_TICKS = 42
const SLIDE_LEAD_TICKS = 22
/** Ticks a courier needs after meeting one thing before it can be settled in another lane. */
const REPLAN_TICKS = 22
const SAFE_CLEARANCE = centimetres(25)
/** Decide on a speed-gated risk path until the split is this close, then commit. */
const FORK_COMMIT = 30 * ONE
/** Take a speed-gated risk path only with this much speed to spare. */
const GATE_SPEED_MARGIN = centimetres(3)

const COST = {
  BLOCK: 1000,
  GAP: 5000,
  WRONG_PATH: 3000,
  ACTION: 25,
  CHANGE: 4,
  GOLD_GATE: 12,
  PULSE_GATE: 60,
  GHOST_LINE: 6,
} as const

interface Tick {
  state: State
  /** Route metres per tick at the current speed on the current path. */
  progress: number
  slots: readonly number[]
  layout: LaneLayout
  /** Predicted lateral position per candidate slot, per tick from now. */
  trajectories: readonly (readonly number[])[]
  pathFor: (fork: Fork) => Path
}

export interface BotHabits {
  /** Take speed-gated relay cuts and rising bridges whatever the speed, until the first fall. */
  recklessCuts?: boolean
  /** Percent of gates the courier steers for (default 100). */
  gateShare?: number
}

export function skilledBot(plan: ForkPlan, habits: BotHabits = {}): Policy {
  const decisions = new Map<number, Path>()
  return state => {
    if (state.motion === 'grinding') return { shift: state.edgeSide < 0 ? 1 : -1, nudge: 0, action: 0 }
    if (state.motion !== 'riding') return IDLE
    const tick = planTick(state, fork => forkPlanFor(state, fork, plan, decisions, habits))
    const choice = bestSlot(tick, scoreLanes(tick, habits.gateShare ?? 100))
    const index = tick.slots.indexOf(choice)
    const shift: Input['shift'] = choice === state.targetLane ? 0 : choice > state.targetLane ? 1 : -1
    return { shift, nudge: draftNudge(tick, choice), action: chooseAction(tick, index) }
  }
}

/**
 * The skilled courier with coarse habits: it notices two gates in three, re-reads the road
 * only every 10 ticks, lets every third hazard go unanswered, often shifts once or twice too
 * many toward an outer lane, hesitates on a rail grind before steering off it, and goes for
 * speed-gated jumps whatever its speed until it has fallen once.
 */
export function sloppyBot(plan: ForkPlan): Policy {
  const skilled = skilledBot(plan, { recklessCuts: true, gateShare: 65 })
  let pendingShifts = 0
  let pendingSide: -1 | 1 = 1
  let grindStart = -1
  return state => {
    const input = skilled(state)
    if (state.motion === 'grinding') {
      if (grindStart < 0) grindStart = state.tick
      const hesitation = 20 + (Math.trunc(state.dist / ONE) * 7) % 50
      return state.tick - grindStart >= hesitation ? input : IDLE
    }
    grindStart = -1
    if (state.motion !== 'riding') return IDLE
    if (pendingShifts > 0) {
      pendingShifts--
      return { shift: pendingSide, nudge: 0, action: 0 }
    }
    const reading = state.tick % 10 < 2
    const shift = reading ? input.shift : 0
    if (shift !== 0 && overshoots(state, shift)) {
      pendingSide = shift
      pendingShifts = state.tick % 3 === 0 ? 2 : 1
    }
    const action = state.hazardIdx % 3 === 1 ? 0 : input.action
    return { shift, nudge: 0, action }
  }
}

/** Heading for an outer lane, a sloppy courier now and then keeps its thumb down a tick or two too long. */
function overshoots(state: State, shift: -1 | 1): boolean {
  const layout = laneLayoutAt(state.track, state.dist, state.path)
  const next = state.targetLane + 2 * shift
  const toOuterLane = Math.abs(next) === layout.count - 1 && layout.count > 1
  return toOuterLane && (state.tick * 7 + Math.trunc(state.dist / ONE)) % 4 === 0
}

/** Runs a policy to the end, recording a compact trace: a sample on every impulse and nudge change. */
export function playLeg(config: Config, policy: Policy): { state: State; trace: Sample[] } {
  let state = createState(config)
  const trace: Sample[] = []
  let lastTick = 0
  let nudge = 0
  while (!state.finished) {
    const input = policy(state)
    if (trace.length === 0 || input.shift !== 0 || input.action !== 0 || input.nudge !== nudge) {
      trace.push([state.tick - lastTick, input.shift, input.nudge, input.action])
      lastTick = state.tick
      nudge = input.nudge
    }
    state = step(state, input)
  }
  return { state, trace }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function planTick(state: State, pathFor: (fork: Fork) => Path): Tick {
  const layout = laneLayoutAt(state.track, state.dist, state.path)
  const slots = laneSlots(layout.count)
  const fork = state.path === 'risk' ? forkAt(state.track, state.dist) : null
  const progress = Math.max(1, fork ? Math.trunc(state.speed * fork.riskProgress / ONE) : state.speed)
  const ticks = Math.min(PREDICT_TICKS, Math.trunc(HORIZON / progress) + 2)
  const trajectories = slots.map(slot => predictLateral(state, laneCenterX(slot, layout.width), ticks))
  return { state, progress, slots, layout, trajectories, pathFor }
}

function predictLateral(state: State, targetX: number, ticks: number): number[] {
  const { stiffness, damping } = laneSpring(state.speed)
  const xs = [state.x]
  let x = state.x
  let vx = state.vx
  for (let t = 1; t <= ticks; t++) {
    vx = vx - Math.trunc(stiffness * (x - targetX) / ONE) - Math.trunc(damping * vx / ONE)
    x += vx
    xs.push(x)
  }
  return xs
}

function xAt(tick: Tick, index: number, ticks: number): number {
  const xs = tick.trajectories[index]!
  return xs[Math.min(ticks, xs.length - 1)]!
}

function arrival(tick: Tick, dist: number): number {
  const ahead = dist - tick.state.dist
  return ahead <= 0 ? 1 : Math.trunc((ahead + tick.progress - 1) / tick.progress)
}

/** Path the courier will be on at `dist`: its own inside the current fork, the plan for a later one. */
function plannedPathAt(tick: Tick, dist: number): Path {
  const fork = forkAt(tick.state.track, dist)
  if (!fork) return 'main'
  if (tick.state.path !== 'main' && forkAt(tick.state.track, tick.state.dist) === fork) return tick.state.path
  return tick.pathFor(fork)
}

/** Lateral offset (Q16.16 m) from the current path's frame to the frame of the path at `dist`. */
function frameOffset(tick: Tick, dist: number, path: Path): number {
  const { state } = tick
  const track = state.track
  if (state.path !== 'main') {
    const here = forkAt(track, state.dist)
    if (!here || dist < here.to) return 0
    const width = segmentAt(track, here.to).laneWidth
    return -Math.trunc(forkOffsetSlots(here, mainLanesAtFork(track, here, 'rejoin'), state.path) * width / 2)
  }
  const fork = forkAt(track, dist)
  if (!fork || path === 'main') return 0
  const width = segmentAt(track, fork.from - 1).laneWidth
  return Math.trunc(forkOffsetSlots(fork, mainLanesAtFork(track, fork, 'split'), path) * width / 2)
}

function forkPlanFor(state: State, fork: Fork, plan: ForkPlan, decisions: Map<number, Path>, habits: BotHabits): Path {
  if (plan === 'safe') return 'safe'
  const gate = state.track.events.find(event => isGatingEvent(event) && event.dist >= fork.from && event.dist < fork.to)
  if (!gate || (habits.recklessCuts && state.metrics.falls === 0)) return 'risk'
  const decided = decisions.get(fork.index)
  if (decided && (state.path !== 'main' || fork.from - state.dist <= FORK_COMMIT)) return decided
  const cruise = BASE_SPEED + Math.trunc(state.flow * FLOW_SPEED / ONE) + (state.rushTicks > 120 ? RUSH_SPEED : 0)
  const fastEnough = Math.min(cruise, state.speed + centimetres(4)) >= millimetres(gate.amplitude) + GATE_SPEED_MARGIN
  const path: Path = fastEnough && state.stumbleTicks === 0 ? 'risk' : 'safe'
  decisions.set(fork.index, path)
  return path
}

// ---------------------------------------------------------------------------
// Lane scoring
// ---------------------------------------------------------------------------

/** What one thing ahead costs (negative: pays) on each candidate lane, and when the courier meets it. */
interface Term {
  ticks: number
  costs: number[]
}

/**
 * Scores the candidate lanes. Everything up to shortly after the next gate or obstacle is
 * scored on the lane the courier steers for now; beyond that it can still change lanes, so
 * the later stretch counts at the cost of its best single lane.
 */
function scoreLanes(tick: Tick, gateShare: number): number[] {
  const terms: Term[] = []
  forkTerms(tick, terms)
  hazardTerms(tick, terms)
  eventTerms(tick, terms)
  gapTerms(tick, terms)
  gateTerms(tick, terms, gateShare)
  const count = tick.slots.length
  const horizon = terms.reduce((nearest, term) => Math.min(nearest, term.ticks), Number.MAX_SAFE_INTEGER) + REPLAN_TICKS
  const near = new Array<number>(count).fill(0)
  const far = new Array<number>(count).fill(0)
  for (const term of terms) {
    const into = term.ticks <= horizon ? near : far
    for (let i = 0; i < count; i++) into[i]! += term.costs[i]!
  }
  const later = Math.min(...far)
  return tick.slots.map((slot, i) => near[i]! + later + COST.CHANGE * Math.abs(slot - tick.state.targetLane) / 2 - ghostReward(tick, slot))
}

function bestSlot(tick: Tick, costs: readonly number[]): number {
  const target = tick.state.targetLane
  const current = tick.slots.indexOf(target)
  let bestIndex = current >= 0 ? current : 0
  for (let i = 0; i < tick.slots.length; i++) {
    const better = costs[i]! < costs[bestIndex]!
    const tieNearerCentre = costs[i] === costs[bestIndex] && bestIndex !== current && Math.abs(tick.slots[i]!) < Math.abs(tick.slots[bestIndex]!)
    if (better || tieNearerCentre) bestIndex = i
  }
  return tick.slots[bestIndex]!
}

function term(tick: Tick, ticks: number, costOn: (index: number) => number): Term {
  return { ticks, costs: tick.slots.map((_, index) => costOn(index)) }
}

function forkTerms(tick: Tick, terms: Term[]): void {
  const { state } = tick
  if (state.path !== 'main') return
  for (const fork of state.track.forks) {
    if (fork.from <= state.dist || fork.from > state.dist + HORIZON) continue
    const lanes = mainLanesAtFork(state.track, fork, 'split')
    const width = segmentAt(state.track, fork.from - 1).laneWidth
    const ticks = arrival(tick, fork.from)
    const wanted = tick.pathFor(fork)
    terms.push(term(tick, ticks, index => (forkPathFor(fork, lanes, width, xAt(tick, index, ticks)) === wanted ? 0 : COST.WRONG_PATH)))
  }
}

function hazardTerms(tick: Tick, terms: Term[]): void {
  const { state } = tick
  const hazards = state.track.hazards
  for (let i = state.hazardIdx; i < hazards.length; i++) {
    const hazard = hazards[i]!
    if (hazard.dist > state.dist + HORIZON) break
    if (hazard.kind === 'gust') continue
    const path = plannedPathAt(tick, hazard.dist)
    if (hazard.path !== activePathAt(state.track, hazard.dist, path)) continue
    const ticks = arrival(tick, hazard.dist)
    if (state.stumbleTicks > ticks) continue
    const layout = laneLayoutAt(state.track, hazard.dist, hazard.path)
    const offset = frameOffset(tick, hazard.dist, hazard.path)
    const collision = hazardCollision(hazard)
    terms.push(term(tick, ticks, index => {
      const clearance = hazardClearance(hazard, layout, state.tick + ticks, xAt(tick, index, ticks) - offset)
      return clearance >= SAFE_CLEARANCE ? 0 : blockCost(state, collision, ticks)
    }))
  }
}

function eventTerms(tick: Tick, terms: Term[]): void {
  const { state } = tick
  for (const event of state.track.events) {
    if (event.dist > state.dist + HORIZON) break
    const span = eventIsSpan(event)
    if (span ? event.dist + event.length <= state.dist : event.dist <= state.dist) continue
    const entry = Math.max(event.dist, state.dist + 1)
    const path = plannedPathAt(tick, entry)
    if (event.path !== activePathAt(state.track, event.dist, path)) continue
    const ticks = arrival(tick, entry)
    if (!span && state.stumbleTicks > ticks) continue
    const age = predictedAge(tick, event.id, event.triggerDist, ticks)
    const collision = eventCollision(event, age)
    if (collision === COLLISION.NONE) continue
    const layout = laneLayoutAt(state.track, event.dist, event.path)
    const offset = frameOffset(tick, entry, event.path)
    terms.push(term(tick, ticks, index => {
      const clearance = eventClearance(event, age, layout, xAt(tick, index, ticks) - offset)
      return clearance >= SAFE_CLEARANCE ? 0 : blockCost(state, collision, ticks)
    }))
  }
}

function predictedAge(tick: Tick, id: number, triggerDist: number, ticks: number): number {
  const triggered = tick.state.eventTicks[id] ?? -1
  const triggerTick = triggered >= 0 ? triggered : tick.state.tick + arrival(tick, triggerDist)
  return tick.state.tick + ticks - triggerTick
}

function blockCost(state: State, collision: CollisionClass, ticks: number): number {
  if (collision === COLLISION.LOW) return canClearLow(state, ticks) ? COST.ACTION : COST.BLOCK
  if (collision === COLLISION.OVERHEAD) return canSlideUnder(state, ticks) ? COST.ACTION : COST.BLOCK
  return COST.BLOCK
}

function grounded(state: State): boolean {
  return state.y === 0 && state.vy === 0
}

function heightAfter(y: number, vy: number, ticks: number): number {
  return y + vy * ticks - Math.trunc(GRAVITY * ticks * (ticks + 1) / 2)
}

function canClearLow(state: State, ticks: number): boolean {
  if (!grounded(state)) return heightAfter(state.y, state.vy, ticks) >= LOW_HAZARD_HEIGHT + centimetres(10)
  if (ticks < MIN_JUMP_TICKS) return false
  return state.stumbleTicks <= Math.max(0, ticks - JUMP_LEAD_TICKS)
}

function canSlideUnder(state: State, ticks: number): boolean {
  if (grounded(state)) return true
  for (let t = 1; t < ticks; t++) if (heightAfter(state.y, state.vy, t) <= 0) return true
  return false
}

/** A gap the courier would ride into on a lane without being airborne. */
function gapTerms(tick: Tick, terms: Term[]): void {
  const { state } = tick
  for (const gap of state.track.gaps) {
    if (gap.from > state.dist + HORIZON) break
    if (gap.to <= state.dist) continue
    const path = plannedPathAt(tick, gap.from)
    if (gap.path !== activePathAt(state.track, gap.from, path)) continue
    const layout = laneLayoutAt(state.track, gap.from, gap.path)
    const offset = frameOffset(tick, gap.from, gap.path)
    const checks = [Math.max(gap.from, state.dist + 1), (gap.from + gap.to) >> 1, gap.to - 1].filter(dist => dist > state.dist)
    if (checks.length === 0) continue
    terms.push(term(tick, arrival(tick, checks[0]!), index => {
      for (const dist of checks) {
        const ticks = arrival(tick, dist)
        if (!zoneCovers(layout, gap, xAt(tick, index, ticks) - offset)) continue
        if (heightOver(tick, index, gap, layout, ticks) < GAP_CLEARANCE) return COST.GAP
      }
      return 0
    }))
  }
}

/** Predicted height `ticks` from now: current air, or the launch off a ramp before the gap. */
function heightOver(tick: Tick, index: number, gap: Zone, layout: LaneLayout, ticks: number): number {
  const { state } = tick
  if (!grounded(state)) return heightAfter(state.y, state.vy, ticks)
  for (const ramp of state.track.ramps) {
    if (ramp.to > gap.from) break
    if (ramp.to <= state.dist || ramp.path !== gap.path || gap.from - ramp.to > 12 * ONE) continue
    const launchTicks = arrival(tick, ramp.to)
    if (!zoneCovers(layout, ramp, xAt(tick, index, launchTicks) - frameOffset(tick, ramp.to, ramp.path))) continue
    const air = ticks - launchTicks
    return air < 0 ? 0 : heightAfter(0, launchVelocity(state, ramp), air)
  }
  return 0
}

function launchVelocity(state: State, ramp: Zone): number {
  const gate = gatingEventFor(state.track, ramp)
  if (!gate) return RAMP_VELOCITY
  return state.speed >= millimetres(gate.amplitude) ? CUT_LAUNCH_VELOCITY : STALL_LAUNCH_VELOCITY
}

/**
 * Gates pay the lane that meets them lit; only the next two gates count, the second at half.
 * A courier with a `gateShare` below 100 only notices that share of the gates.
 */
function gateTerms(tick: Tick, terms: Term[], gateShare: number): void {
  const { state } = tick
  const gates = state.track.gates
  let rank = 0
  for (let i = state.gateIdx; i < gates.length && rank < 2; i++) {
    const gate = gates[i]!
    if (gate.dist > state.dist + HORIZON) break
    if ((Math.trunc(gate.dist / ONE) * 37) % 100 >= gateShare) continue
    const path = plannedPathAt(tick, gate.dist)
    if (gate.path !== activePathAt(state.track, gate.dist, path)) continue
    const ticks = arrival(tick, gate.dist)
    const layout = laneLayoutAt(state.track, gate.dist, gate.path)
    const offset = frameOffset(tick, gate.dist, gate.path)
    const lit = laneCenterX(pulseGateLane(gate, state.tick + ticks), layout.width)
    const value = (gate.kind === 'pulse' ? COST.PULSE_GATE : COST.GOLD_GATE) >> rank
    terms.push(term(tick, ticks, index =>
      (Math.abs(xAt(tick, index, ticks) - offset - lit) <= Math.trunc(layout.width / 2) - centimetres(20) ? -value : 0)))
    rank++
  }
}

// ---------------------------------------------------------------------------
// Ghost drafting
// ---------------------------------------------------------------------------

/** Ghost x (Q16.16, current frame) when the ghost is close enough ahead on this path to draft. */
function draftableGhostX(state: State): number | null {
  const ghostline = state.config.ghostline
  if (!ghostline) return null
  const ghostTick = ghostTickAt(ghostline, state.dist)
  const lead = state.tick - ghostTick
  if (ghostTick < 0 || lead <= 0 || lead > DRAFT_MAX_LEAD_TICKS) return null
  if (ghostPathCodeAt(ghostline, state.dist) !== pathCode(state.path)) return null
  return ghostXAt(ghostline, state.dist)
}

function ghostReward(tick: Tick, slot: number): number {
  const ghostX = draftableGhostX(tick.state)
  if (ghostX === null) return 0
  return Math.abs(ghostX - laneCenterX(slot, tick.layout.width)) <= Math.trunc(tick.layout.width / 2) ? COST.GHOST_LINE : 0
}

function draftNudge(tick: Tick, slot: number): number {
  const ghostX = draftableGhostX(tick.state)
  if (ghostX === null) return 0
  const offset = ghostX - laneCenterX(slot, tick.layout.width)
  if (Math.abs(offset) > NUDGE_RANGE * NUDGE_STEP + centimetres(40)) return 0
  return Math.max(-NUDGE_RANGE, Math.min(NUDGE_RANGE, Math.trunc(offset / NUDGE_STEP)))
}

// ---------------------------------------------------------------------------
// Jumps and slides
// ---------------------------------------------------------------------------

function chooseAction(tick: Tick, index: number): Input['action'] {
  const { state } = tick
  if (!grounded(state)) return 0
  const threat = nearestBlock(tick, index)
  if (!threat) return 0
  if (threat.collision === COLLISION.LOW) {
    const inWindow = threat.ticks <= JUMP_LEAD_TICKS && threat.ticks >= MIN_JUMP_TICKS
    return inWindow && state.stumbleTicks === 0 && landsSafely(tick, index) ? ACTION_JUMP : 0
  }
  if (threat.collision === COLLISION.OVERHEAD) {
    return threat.ticks <= SLIDE_LEAD_TICKS && state.slideTicks <= threat.ticks ? ACTION_SLIDE : 0
  }
  return 0
}

interface Block {
  ticks: number
  collision: CollisionClass
}

/** The nearest hazard or event that would hit the courier on this lane's predicted line. */
function nearestBlock(tick: Tick, index: number): Block | null {
  const { state } = tick
  let found: Block | null = null
  const hazards = state.track.hazards
  for (let i = state.hazardIdx; i < hazards.length; i++) {
    const hazard = hazards[i]!
    if (hazard.dist > state.dist + HORIZON) break
    if (hazard.kind === 'gust') continue
    const path = plannedPathAt(tick, hazard.dist)
    if (hazard.path !== activePathAt(state.track, hazard.dist, path)) continue
    const ticks = arrival(tick, hazard.dist)
    if (state.stumbleTicks > ticks || (found && found.ticks <= ticks)) continue
    const layout = laneLayoutAt(state.track, hazard.dist, hazard.path)
    const x = xAt(tick, index, ticks) - frameOffset(tick, hazard.dist, hazard.path)
    if (hazardClearance(hazard, layout, state.tick + ticks, x) < SAFE_CLEARANCE) found = { ticks, collision: hazardCollision(hazard) }
  }
  for (const event of state.track.events) {
    if (event.dist > state.dist + HORIZON) break
    if (eventIsSpan(event) || event.dist <= state.dist) continue
    const path = plannedPathAt(tick, event.dist)
    if (event.path !== activePathAt(state.track, event.dist, path)) continue
    const ticks = arrival(tick, event.dist)
    if (state.stumbleTicks > ticks || (found && found.ticks <= ticks)) continue
    const age = predictedAge(tick, event.id, event.triggerDist, ticks)
    const collision = eventCollision(event, age)
    if (collision === COLLISION.NONE) continue
    const layout = laneLayoutAt(state.track, event.dist, event.path)
    const x = xAt(tick, index, ticks) - frameOffset(tick, event.dist, event.path)
    if (eventClearance(event, age, layout, x) < SAFE_CLEARANCE) found = { ticks, collision }
  }
  return found
}

/** Never jump over a ramp that has to launch the courier, or into a gap. */
function landsSafely(tick: Tick, index: number): boolean {
  const { state } = tick
  const reach = state.dist + JUMP_AIR_TICKS * tick.progress
  for (const ramp of state.track.ramps) {
    if (ramp.to > reach) break
    if (ramp.to <= state.dist) continue
    const path = plannedPathAt(tick, ramp.to)
    if (ramp.path !== activePathAt(state.track, ramp.to - 1, path)) continue
    const layout = laneLayoutAt(state.track, ramp.to - 1, ramp.path)
    if (zoneCovers(layout, ramp, xAt(tick, index, arrival(tick, ramp.to)) - frameOffset(tick, ramp.to, ramp.path))) return false
  }
  for (const gap of state.track.gaps) {
    if (gap.from > reach) break
    if (gap.to <= reach) continue
    const path = plannedPathAt(tick, reach)
    if (gap.path !== activePathAt(state.track, reach, path)) continue
    const layout = laneLayoutAt(state.track, reach, gap.path)
    if (zoneCovers(layout, gap, xAt(tick, index, JUMP_AIR_TICKS) - frameOffset(tick, reach, gap.path))) return false
  }
  return true
}
