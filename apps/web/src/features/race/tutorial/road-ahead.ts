import { relayLeg } from '@nim-relay/game-engine'

/**
 * What the courier is riding into, read from the simulation state with the engine's own geometry and
 * collision rules, so a prompt asks for exactly what the simulation will resolve. Presentation only:
 * nothing here writes state.
 */

const ONE = 65536
/** Where the Ghostline is read, metres ahead of the courier: where the line is lit on screen, past its fade under the board. */
const GHOSTLINE_READ_METRES = 20

/** How the courier's line gets past a blocking obstacle: over it, under it, or only by leaving its lane. */
export type ObstacleAnswer = 'jump' | 'slide' | 'dodge'

export interface ObstacleAhead {
  /** Identity within the leg, e.g. `hazard:4` or `event:2`. */
  key: string
  answer: ObstacleAnswer
  /** Route distance (Q16.16 m) where the courier meets it. */
  dist: number
  /** Ticks until the courier meets it at its current speed. */
  ticks: number
}

export interface EdgeDanger {
  /** -1 the left edge, 1 the right edge. */
  side: -1 | 1
  grinding: boolean
  edge: relayLeg.EdgeKind
}

/** Route metres per tick (Q16.16) at the courier's current speed, on a shortcut's shorter path too. */
function routeStep(state: relayLeg.State): number {
  const fork = state.path === 'risk' ? relayLeg.forkAt(state.track, state.dist) : null
  return Math.max(1, fork ? Math.trunc((state.speed * fork.riskProgress) / ONE) : state.speed)
}

/**
 * Route distance where the courier's lateral frame changes: the next fork split on the main road, the
 * rejoin on a fork path. Lane positions beyond it are measured from another centre line.
 */
function frameEnd(state: relayLeg.State): number {
  const { track } = state
  if (state.path !== 'main') return relayLeg.forkAt(track, state.dist)?.to ?? track.finishDist
  return track.forks.find(fork => fork.from > state.dist)?.from ?? track.finishDist
}

function layoutHere(state: relayLeg.State): relayLeg.LaneLayout {
  return relayLeg.laneLayoutAt(state.track, state.dist, relayLeg.activePathAt(state.track, state.dist, state.path))
}

/** Where the courier's line crosses the road ahead: the lane (or shoulder) it steers for, plus the held nudge. */
function lineX(state: relayLeg.State): number {
  return relayLeg.slotTargetX(layoutHere(state), state.targetLane) + state.nudge * relayLeg.NUDGE_STEP
}

function arrival(ahead: number, step: number): number {
  return ahead <= 0 ? 1 : Math.trunc((ahead + step - 1) / step)
}

function answerFor(collision: relayLeg.CollisionClass): ObstacleAnswer {
  if (collision === relayLeg.COLLISION.LOW) return 'jump'
  if (collision === relayLeg.COLLISION.OVERHEAD) return 'slide'
  return 'dodge'
}

/**
 * The nearest hazard or world event within `horizonTicks` that would hit the courier on the line it is
 * steering for, with how to get past it. Ramps and gaps never block: a ramp launches the courier over its
 * gap by itself, and jumping before one would skip the launch.
 */
export function obstacleAhead(state: relayLeg.State, horizonTicks: number): ObstacleAhead | null {
  if (state.motion !== 'riding') return null
  const step = routeStep(state)
  const reach = Math.min(state.dist + step * horizonTicks, frameEnd(state))
  const x = lineX(state)
  const hazard = hazardAhead(state, reach, step, x)
  const event = eventAhead(state, reach, step, x)
  if (!hazard || !event) return hazard ?? event
  return event.ticks < hazard.ticks ? event : hazard
}

function hazardAhead(state: relayLeg.State, reach: number, step: number, x: number): ObstacleAhead | null {
  const { track } = state
  for (let i = state.hazardIdx; i < track.hazards.length; i++) {
    const hazard = track.hazards[i]!
    if (hazard.dist > reach) return null
    if (hazard.kind === 'gust' || hazard.dist <= state.dist || hazard.path !== state.path) continue
    const ticks = arrival(hazard.dist - state.dist, step)
    // A courier still stumbling when it gets there passes through untouched.
    if (state.stumbleTicks > ticks) continue
    const layout = relayLeg.laneLayoutAt(track, hazard.dist, hazard.path)
    if (relayLeg.hazardClearance(hazard, layout, state.tick + ticks, x) >= 0) continue
    return { key: `hazard:${i}`, answer: answerFor(relayLeg.hazardCollision(hazard)), dist: hazard.dist, ticks }
  }
  return null
}

function eventAhead(state: relayLeg.State, reach: number, step: number, x: number): ObstacleAhead | null {
  const { track } = state
  let nearest: ObstacleAhead | null = null
  for (const event of track.events) {
    if (event.dist > reach) break
    if (event.path !== state.path) continue
    const span = relayLeg.eventIsSpan(event)
    if ((span ? event.dist + event.length : event.dist) <= state.dist) continue
    const dist = Math.max(event.dist, state.dist + 1)
    const ticks = arrival(dist - state.dist, step)
    if ((!span && state.stumbleTicks > ticks) || (nearest && nearest.ticks <= ticks)) continue
    const age = ageOnArrival(state, event, ticks, step)
    const collision = relayLeg.eventCollision(event, age)
    if (collision === relayLeg.COLLISION.NONE) continue
    const layout = relayLeg.laneLayoutAt(track, event.dist, event.path)
    if (relayLeg.eventClearance(event, Math.max(age, 0), layout, x) >= 0) continue
    // A closed lane stays closed along its whole span, so landing a jump inside it still hits.
    nearest = { key: `event:${event.id}`, answer: span ? 'dodge' : answerFor(collision), dist, ticks }
  }
  return nearest
}

/** Ticks since the event triggered, as it will be when the courier arrives `ticks` from now. */
function ageOnArrival(state: relayLeg.State, event: relayLeg.WorldEvent, ticks: number, step: number): number {
  const triggered = state.eventTicks[event.id] ?? -1
  const triggerTick = triggered >= 0 ? triggered : state.tick + arrival(event.triggerDist - state.dist, step)
  return state.tick + ticks - triggerTick
}

/**
 * A calm stretch: riding level and steady with nothing to meet on the courier's path within
 * `horizonTicks`, in any lane: no hazard, world event, ramp or gap, and no fork to choose at.
 */
export function roadClearAhead(state: relayLeg.State, horizonTicks: number): boolean {
  if (state.motion !== 'riding' || state.y !== 0 || state.vy !== 0 || state.stumbleTicks > 0) return false
  const { track } = state
  const reach = state.dist + routeStep(state) * horizonTicks
  if (reach >= frameEnd(state)) return false
  const overlaps = (path: relayLeg.Path, from: number, to: number): boolean => path === state.path && to > state.dist && from <= reach
  for (let i = state.hazardIdx; i < track.hazards.length; i++) {
    const hazard = track.hazards[i]!
    if (hazard.dist > reach) break
    if (overlaps(hazard.path, hazard.dist, hazard.dist + hazard.length)) return false
  }
  if (track.events.some(event => overlaps(event.path, event.triggerDist, event.dist + event.length))) return false
  const zoneAhead = (zone: relayLeg.Zone): boolean => overlaps(zone.path, zone.from, zone.to)
  return !track.ramps.some(zoneAhead) && !track.gaps.some(zoneAhead)
}

/**
 * The previous runner's Ghostline runs on the courier's road just ahead: there is one, it hasn't ended, and
 * the ghost took the path the courier is on. Which side of the courier it looks to be on depends on bends and
 * the chase camera, so only the road knows it is there.
 */
export function ghostlineAhead(state: relayLeg.State): boolean {
  const ghostline = state.config.ghostline
  if (!ghostline || state.motion !== 'riding') return false
  const sample = relayLeg.ghostlineAt(ghostline, state.dist + GHOSTLINE_READ_METRES * ONE)
  return sample !== null && sample.path === state.path
}

/** The ghost is ahead by no more than drafting reaches, so riding its line builds FLOW. */
export function ghostDraftable(state: relayLeg.State): boolean {
  return state.config.ghostline !== null && state.ghostLeadTicks > 0 && state.ghostLeadTicks <= relayLeg.DRAFT_MAX_LEAD_TICKS
}

/** The courier grinding a road edge, or riding the shoulder beyond its outer lane toward one. */
export function edgeDanger(state: relayLeg.State): EdgeDanger | null {
  const layout = layoutHere(state)
  if (state.motion === 'grinding') {
    const side = state.edgeSide < 0 ? -1 : 1
    return { side, grinding: true, edge: relayLeg.edgeOnSide(layout, side) }
  }
  if (state.motion !== 'riding' || Math.abs(state.x) <= relayLeg.laneEdgeOf(layout)) return null
  const side = state.x < 0 ? -1 : 1
  return { side, grinding: false, edge: relayLeg.edgeOnSide(layout, side) }
}

/** A jump the courier made from the deck on this tick's input. A ramp launch leaves the deck only on the tick after. */
export function isOwnJump(state: relayLeg.State): boolean {
  return (state.events & relayLeg.EVENT.JUMP) !== 0 && state.y > 0
}
