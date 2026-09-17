import {
  CLEAN_LANDING_AIR_TICKS,
  CUT_LAUNCH_VELOCITY,
  FLOW,
  GAP_CLEARANCE,
  HARD_LANDING_SPEED,
  HIT_DEFLECT_SPEED,
  RAMP_VELOCITY,
  STALL_LAUNCH_VELOCITY,
  STUMBLE_SPEED,
  STUMBLE_TICKS,
} from './constants'
import {
  COLLISION,
  OUTCOME,
  collisionOutcome,
  eventAge,
  eventClearance,
  eventCollision,
  eventIsSpan,
  eventPhase,
  gatingEventFor,
  hazardClearance,
  hazardCollision,
  onBeat,
  pulseGateLane,
  type HazardOutcome,
} from './dynamics'
import { addMoment, breakFlow, gainFlow, loseFlow, type Draft } from './flow'
import {
  activePathAt,
  forkAt,
  forkOffsetSlots,
  forkPathFor,
  forkPathSide,
  laneCenterX,
  laneEdgeOf,
  laneSlots,
  mainLanesAtFork,
  segmentAt,
  type LaneLayout,
} from './geometry'
import { fall } from './locomotion'
import { EVENT, type Fork, type Gate, type LaneCount, type Zone } from './types'
import { millimetres } from './units'

// ---------------------------------------------------------------------------
// Forks
// ---------------------------------------------------------------------------

/** At a fork's split the lane nearest the courier picks the path; lanes carry straight on. */
export function enterFork(s: Draft, fromDist: number): void {
  if (s.path !== 'main') return
  const forks = s.track.forks
  for (let i = 0; i < forks.length; i++) {
    const fork = forks[i]!
    if (fromDist >= fork.from || s.dist < fork.from) continue
    const mainLanes = mainLanesAtFork(s.track, fork, 'split')
    const width = segmentAt(s.track, fork.from - 1).laneWidth
    const path = forkPathFor(fork, mainLanes, width, s.x)
    const pathLanes = path === 'risk' ? fork.riskLanes : fork.safeLanes
    transferLanes(s, forkOffsetSlots(fork, mainLanes, path), width, mainLanes, pathLanes, forkPathSide(fork, path))
    s.path = path
    s.riskClean = path === 'risk' ? 1 : 0
    s.events |= path === 'risk' ? EVENT.FORK_RISK : EVENT.FORK_SAFE
    const choices = s.forkChoices.slice()
    choices[fork.index] = path === 'risk' ? 2 : 1
    s.forkChoices = choices
    return
  }
}

/** At the rejoin the path's lanes merge back into the main lanes they line up with. */
export function leaveFork(s: Draft, fromDist: number): void {
  if (s.path === 'main') return
  const fork = forkAt(s.track, fromDist)
  if (!fork || s.dist < fork.to) return
  const path = s.path
  const mainLanes = mainLanesAtFork(s.track, fork, 'rejoin')
  const width = segmentAt(s.track, fork.to).laneWidth
  const pathLanes = path === 'risk' ? fork.riskLanes : fork.safeLanes
  transferLanes(s, -forkOffsetSlots(fork, mainLanes, path), width, pathLanes, mainLanes, forkPathSide(fork, path))
  if (path === 'risk') {
    s.metrics.riskRoutes++
    if (s.riskClean === 1) clearRisk(s, fork)
  }
  s.path = 'main'
  s.riskClean = 0
}

function clearRisk(s: Draft, fork: Readonly<Fork>): void {
  s.events |= EVENT.RISK_CLEAR
  if (fork.label === 'relay-cut') {
    gainFlow(s, FLOW.RELAY_CUT)
    addMoment(s, 'relay-cut')
  } else {
    gainFlow(s, FLOW.RISK_CLEAR)
  }
}

/**
 * Re-expresses the courier in the next path's frame. `offset` is the old centre line's slot
 * in the new frame's units, negated: new slot = old slot - offset. Shoulder and edge targets
 * on the path's outer side stay shoulder and edge targets; anything else clamps to a lane.
 */
function transferLanes(s: Draft, offset: number, width: number, fromLanes: LaneCount, toLanes: LaneCount, outerSide: -1 | 1): void {
  s.x -= Math.trunc(offset * width / 2)
  s.lane = clampLane(s.lane - offset, toLanes)
  const reach = Math.abs(s.targetLane)
  const side = s.targetLane < 0 ? -1 : 1
  s.targetLane = reach >= fromLanes && side === outerSide
    ? outerSide * (toLanes + reach - fromLanes)
    : clampLane(s.targetLane - offset, toLanes)
}

function clampLane(slot: number, count: LaneCount): number {
  return Math.max(1 - count, Math.min(count - 1, slot))
}

// ---------------------------------------------------------------------------
// World event triggers
// ---------------------------------------------------------------------------

/** Events start when the courier's route distance reaches their trigger, so every courier gets the same telegraph. */
export function triggerEvents(s: Draft): void {
  const events = s.track.events
  let ticks: number[] | null = null
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    if (event.triggerDist > s.dist) continue
    if ((ticks ?? s.eventTicks)[event.id]! >= 0) continue
    ticks ??= s.eventTicks.slice()
    ticks[event.id] = s.tick
    s.events |= EVENT.EVENT_TRIGGERED
  }
  if (ticks) s.eventTicks = ticks
}

// ---------------------------------------------------------------------------
// Zones: landings, ramps, gaps, rails, pads
// ---------------------------------------------------------------------------

/** True when `zone` covers lateral position `x`; a zone over every lane covers the shoulders too. */
export function zoneCovers(layout: Readonly<LaneLayout>, zone: Readonly<Zone>, x: number): boolean {
  if (zone.lanes.length >= layout.count) return Math.abs(x) <= layout.halfWidth
  const half = Math.trunc(layout.width / 2)
  for (let i = 0; i < zone.lanes.length; i++) {
    if (Math.abs(x - laneCenterX(zone.lanes[i]!, layout.width)) <= half) return true
  }
  return false
}

function zoneUnder(s: Draft, zones: readonly Zone[], layout: Readonly<LaneLayout>): Zone | null {
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!
    if (zone.from > s.dist) break
    if (s.dist >= zone.to || zone.path !== activePathAt(s.track, s.dist, s.path)) continue
    if (zoneCovers(layout, zone, s.x)) return zone
  }
  return null
}

const grounded = (s: Draft): boolean => s.y === 0 && s.vy === 0

export function resolveLanding(s: Draft, airTicks: number, layout: Readonly<LaneLayout>): void {
  if (airTicks === 0) return
  if (zoneUnder(s, s.track.gaps, layout)) {
    fall(s)
    return
  }
  s.events |= EVENT.LAND
  const rough = Math.abs(s.vx) >= HARD_LANDING_SPEED || Math.abs(s.x) > laneEdgeOf(layout)
  if (rough) {
    s.events |= EVENT.HARD_LANDING
    s.metrics.hardLandings++
    loseFlow(s, FLOW.HARD_LANDING)
  } else if (s.stumbleTicks === 0 && s.airCleared === 1 && airTicks >= CLEAN_LANDING_AIR_TICKS) {
    s.events |= EVENT.CLEAN_LAND
    s.metrics.cleanLandings++
    gainFlow(s, FLOW.CLEAN_LANDING)
  }
  s.airCleared = 0
}

/**
 * A grounded courier crossing the end of a ramp in its lanes launches. Ramps inside a
 * rising-bridge or bridge-break span are speed-gated: at or above the event's threshold the
 * launch carries the gap, below it the deck gives way after a short hop.
 */
export function launchFromRamps(s: Draft, fromDist: number, layout: Readonly<LaneLayout>): void {
  if (!grounded(s)) return
  const ramps = s.track.ramps
  for (let i = 0; i < ramps.length; i++) {
    const ramp = ramps[i]!
    if (ramp.from > s.dist) break
    if (fromDist >= ramp.to || s.dist < ramp.to) continue
    if (ramp.path !== activePathAt(s.track, ramp.to - 1, s.path) || !zoneCovers(layout, ramp, s.x)) continue
    launch(s, launchVelocity(s, ramp))
    return
  }
}

function launchVelocity(s: Draft, ramp: Readonly<Zone>): number {
  const gate = gatingEventFor(s.track, ramp)
  if (!gate) return RAMP_VELOCITY
  const live = eventPhase(gate, eventAge(gate, s.eventTicks, s.tick)) === 'active'
  return live && s.speed >= millimetres(gate.amplitude) ? CUT_LAUNCH_VELOCITY : STALL_LAUNCH_VELOCITY
}

function launch(s: Draft, velocity: number): void {
  s.vy = velocity
  s.airTicks = 0
  s.airCleared = velocity === STALL_LAUNCH_VELOCITY ? 0 : 1
  s.slideTicks = 0
  s.metrics.jumps++
  s.events |= EVENT.JUMP
}

/**
 * Riding over a gap without enough height is a fall; clearing one in the air counts toward a
 * clean landing, and carrying a relay cut's gap is the relay cut itself.
 */
export function crossGaps(s: Draft, fromDist: number, layout: Readonly<LaneLayout>): void {
  if (s.y < GAP_CLEARANCE && zoneUnder(s, s.track.gaps, layout)) {
    fall(s)
    return
  }
  const gaps = s.track.gaps
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i]!
    if (gap.from > s.dist) break
    if (gap.path !== activePathAt(s.track, gap.from, s.path) || !zoneCovers(layout, gap, s.x)) continue
    if (fromDist < gap.from && s.dist >= gap.from) s.airCleared = 1
    if (fromDist < gap.to && s.dist >= gap.to) clearGap(s, gap)
  }
}

function clearGap(s: Draft, gap: Readonly<Zone>): void {
  const fork = s.path === 'risk' ? forkAt(s.track, gap.from) : null
  if (!fork || fork.label !== 'relay-cut' || s.riskClean !== 1) return
  clearRisk(s, fork)
  s.riskClean = 0
}

export function updateRail(s: Draft, wasRailing: 0 | 1, layout: Readonly<LaneLayout>): void {
  const railing: 0 | 1 = s.motion === 'riding' && grounded(s) && zoneUnder(s, s.track.rails, layout) ? 1 : 0
  if (railing === 1 && wasRailing === 0) s.events |= EVENT.RAIL_ON
  if (railing === 0 && wasRailing === 1) s.events |= EVENT.RAIL_OFF
  if (railing === 1) {
    s.metrics.railTicks++
    gainFlow(s, FLOW.RAIL_TICK)
  }
  s.railing = railing
}

export function boostPadActive(s: Draft, fromDist: number, layout: Readonly<LaneLayout>): boolean {
  if (!grounded(s) || s.motion !== 'riding') return false
  const pads = s.track.boostPads
  let on = false
  for (let i = 0; i < pads.length && !on; i++) {
    const pad = pads[i]!
    if (pad.from > fromDist) break
    on = fromDist < pad.to && pad.path === activePathAt(s.track, fromDist, s.path) && zoneCovers(layout, pad, s.x)
  }
  if (!on) return false
  const pulse = s.track.pulse
  const inPulse = fromDist >= pulse.from && fromDist < pulse.to
  return !inPulse || onBeat(s.track, s.tick)
}

export function rewardBoostPad(s: Draft, onPad: boolean): void {
  if (!onPad) return
  s.events |= EVENT.BOOST_PAD
  s.metrics.boostPadTicks++
  gainFlow(s, FLOW.PAD_TICK)
}

// ---------------------------------------------------------------------------
// Hazards and world events
// ---------------------------------------------------------------------------

export function crossHazards(s: Draft, layout: Readonly<LaneLayout>): void {
  const hazards = s.track.hazards
  while (s.hazardIdx < hazards.length && hazards[s.hazardIdx]!.dist <= s.dist) {
    const hazard = hazards[s.hazardIdx]!
    s.hazardIdx++
    if (hazard.kind === 'gust' || s.stumbleTicks > 0) continue
    if (hazard.path !== activePathAt(s.track, hazard.dist, s.path)) continue
    const clearanceAt = (x: number): number => hazardClearance(hazard, layout, s.tick, x)
    const outcome = collisionOutcome(hazardCollision(hazard), clearanceAt(s.x), s.y, s.slideTicks)
    resolveOutcome(s, layout, outcome, clearanceAt, false)
  }
}

/**
 * Line events resolve when the courier crosses their distance. A lane closure also hits a
 * courier who steers into a closed lane anywhere along its span.
 */
export function crossEvents(s: Draft, fromDist: number, layout: Readonly<LaneLayout>): void {
  if (s.stumbleTicks > 0 || s.motion !== 'riding') return
  const events = s.track.events
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!
    if (event.dist > s.dist) break
    const age = eventAge(event, s.eventTicks, s.tick)
    const collision = eventCollision(event, age)
    if (collision === COLLISION.NONE || event.path !== activePathAt(s.track, event.dist, s.path)) continue
    const crossed = fromDist < event.dist
    const inside = eventIsSpan(event) ? s.dist < event.dist + event.length : crossed
    if (!inside) continue
    const clearanceAt = (x: number): number => eventClearance(event, age, layout, x)
    const outcome = collisionOutcome(collision, clearanceAt(s.x), s.y, s.slideTicks)
    if (crossed || outcome === OUTCOME.HIT) resolveOutcome(s, layout, outcome, clearanceAt, eventIsSpan(event))
  }
}

/** `retarget`: the obstacle runs on along the lane, so the courier is knocked into the free lane for good. */
function resolveOutcome(s: Draft, layout: Readonly<LaneLayout>, outcome: HazardOutcome, clearanceAt: (x: number) => number, retarget: boolean): void {
  if (outcome === OUTCOME.HIT) {
    hit(s, layout, clearanceAt, retarget)
  } else if (outcome === OUTCOME.NEAR) {
    s.events |= EVENT.NEAR_MISS
    s.metrics.nearMisses++
    gainFlow(s, FLOW.NEAR_MISS)
    if (s.y > 0) s.airCleared = 1
  }
}

/**
 * A hit: FLOW -30%, Relay Rush over, a stumble, and a lateral shove toward the nearest free
 * lane. Past a line obstacle the courier's own lane is safe again, so only a lane that stays
 * blocked (a closure) takes the courier's target lane with it.
 */
function hit(s: Draft, layout: Readonly<LaneLayout>, clearanceAt: (x: number) => number, retarget: boolean): void {
  s.events |= EVENT.HIT
  s.metrics.hits++
  breakFlow(s, FLOW.HIT)
  s.stumbleTicks = STUMBLE_TICKS
  s.slideTicks = 0
  s.speed = Math.min(s.speed, STUMBLE_SPEED)
  s.riskClean = 0
  deflect(s, layout, clearanceAt, retarget)
}

function deflect(s: Draft, layout: Readonly<LaneLayout>, clearanceAt: (x: number) => number, retarget: boolean): void {
  const slots = laneSlots(layout.count)
  let best: number | null = null
  let bestDistance = 0
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!
    const centre = laneCenterX(slot, layout.width)
    if (clearanceAt(centre) < 0) continue
    const distance = Math.abs(centre - s.x)
    if (best === null || distance < bestDistance || (distance === bestDistance && Math.abs(slot) < Math.abs(best))) {
      best = slot
      bestDistance = distance
    }
  }
  if (best === null) return
  if (retarget) s.targetLane = best
  const centre = laneCenterX(best, layout.width)
  if (centre !== s.x) s.vx += centre > s.x ? HIT_DEFLECT_SPEED : -HIT_DEFLECT_SPEED
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export function crossGates(s: Draft, layout: Readonly<LaneLayout>): void {
  const gates = s.track.gates
  while (s.gateIdx < gates.length && gates[s.gateIdx]!.dist <= s.dist) {
    const gate = gates[s.gateIdx]!
    s.gateIdx++
    if (gate.path !== activePathAt(s.track, gate.dist, s.path)) continue
    resolveGate(s, gate, layout)
  }
}

/** A pulse gate passed in its lit lane is both a perfect gate and a PULSE_HIT; any other lane is a miss. */
function resolveGate(s: Draft, gate: Readonly<Gate>, layout: Readonly<LaneLayout>): void {
  s.metrics.totalGates++
  const lit = pulseGateLane(gate, s.tick)
  if (Math.abs(s.x - laneCenterX(lit, layout.width)) > Math.trunc(layout.width / 2)) {
    s.events |= EVENT.MISSED_GATE
    loseFlow(s, FLOW.MISSED_GATE)
    return
  }
  s.events |= EVENT.PERFECT_GATE
  s.metrics.perfectGates++
  if (gate.kind === 'pulse') {
    s.events |= EVENT.PULSE_HIT
    s.metrics.pulseHits++
    gainFlow(s, FLOW.PULSE_GATE)
  } else {
    gainFlow(s, FLOW.PERFECT_GATE)
  }
}
