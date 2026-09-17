import { ONE } from '../fixed-point'
import { GRAVITY, LOW_HAZARD_HEIGHT, createState, doorOpenSide, halfWidthAt, hazardLateral, pulseGateLateral, step, trainBlockedSide } from './sim'
import { ACTION_JUMP, ACTION_SLIDE, type Config, type Gate, type Hazard, type Input, type Path, type Sample, type State, type Zone } from './types'

/**
 * Deterministic, integer-only couriers for the tests and the golden corpus.
 * The package index doesn't export them.
 */

export type ForkPlan = 'safe' | 'risk'
export type Policy = (state: State) => Input

const METRE = ONE
const GATE_LOOKAHEAD = 60 * METRE
const HAZARD_LOOKAHEAD = 40 * METRE
const RAMP_LOOKAHEAD = 45 * METRE
const FORK_LOOKAHEAD = 50 * METRE
const JUMP_LEAD_TICKS = 20
const SLIDE_LEAD_TICKS = 24
const GAP_LEAD_TICKS = 3
const DODGE_MARGIN = Math.trunc(ONE * 3 / 10)
const DODGE_CLEARANCE = Math.trunc(ONE * 9 / 10)
/** A jump needs this many ticks to climb above barrier height. */
const MIN_JUMP_TICKS = 9
const SLOPPY_STEER_STEP = 24

export const idleBot: Policy = () => ({ steer: 0, action: 0 })

/** The good bot with coarse thumbs: steer snaps to five positions and every third hazard goes unanswered. */
export function sloppyBot(plan: ForkPlan): Policy {
  const good = goodBot(plan)
  return state => {
    const input = good(state)
    const steer = Math.trunc(input.steer / SLOPPY_STEER_STEP) * SLOPPY_STEER_STEP
    return { steer, action: state.hazardIdx % 3 === 1 ? 0 : input.action }
  }
}

/** Ignores the track: weaves across it and jumps and slides on a fixed rhythm. */
export function weaveBot(offset: number): Policy {
  return state => {
    const phase = Math.trunc(state.tick / 40) * 23 + offset
    const steer = (phase % 129) - 64
    const action = state.tick % 173 === 0 ? ACTION_JUMP : state.tick % 97 === 0 ? ACTION_SLIDE : 0
    return { steer, action }
  }
}

export function goodBot(plan: ForkPlan): Policy {
  return state => {
    const target = steerTarget(state, plan)
    const halfWidth = halfWidthAt(state.track, state.dist, state.path)
    const steer = Math.max(-64, Math.min(64, Math.trunc(target * 64 / halfWidth)))
    return { steer, action: chooseAction(state, plan, target) }
  }
}

/** Runs a policy to the end, recording a compact trace (a sample whenever the input changes). */
export function playLeg(config: Config, policy: Policy): { state: State; trace: Sample[] } {
  let state = createState(config)
  const trace: Sample[] = []
  let lastTick = 0
  while (!state.finished) {
    const input = policy(state)
    const previous = trace.at(-1)
    if (!previous || previous[1] !== input.steer || input.action !== 0) {
      trace.push([state.tick - lastTick, input.steer, input.action])
      lastTick = state.tick
    }
    state = step(state, input)
  }
  return { state, trace }
}

function plannedPathAt(state: State, dist: number, plan: ForkPlan): Path {
  const fork = state.track.fork
  if (dist < fork.from || dist >= fork.to) return 'main'
  return state.path === 'main' ? plan : state.path
}

function ticksUntil(state: State, dist: number): number {
  const speed = Math.max(state.speed, 1)
  const progress = state.path === 'risk' ? Math.trunc(speed * state.track.fork.riskProgress / ONE) : speed
  return Math.trunc((dist - state.dist) / Math.max(progress, 1))
}

function steerTarget(state: State, plan: ForkPlan): number {
  const fork = state.track.fork
  const gate = nextGate(state, plan)
  let target = gate ? interceptX(state, gate) : 0
  const ramp = nextZone(state, state.track.ramps, plan, RAMP_LOOKAHEAD)
  if (ramp) target = ramp.x
  if (state.path === 'main' && state.dist < fork.from && fork.from - state.dist <= FORK_LOOKAHEAD) {
    const side = plan === 'risk' ? fork.riskSide : -fork.riskSide
    target = side * Math.trunc(halfWidthAt(state.track, state.dist, 'main') / 2)
  }
  const hazard = nextHazard(state, plan)
  // Pulse gates keep 25 m clear of hazards, so meeting the lit lane first still leaves time to dodge.
  const pulseGateFirst = gate !== null && gate.kind === 'pulse' && (hazard === null || gate.dist < hazard.dist)
  if (hazard && !pulseGateFirst) target = dodgeTarget(state, hazard, target)
  return target - gustDrift(state, plan)
}

function nextGate(state: State, plan: ForkPlan): Gate | null {
  const gates = state.track.gates
  for (let i = state.gateIdx; i < gates.length; i++) {
    const gate = gates[i]!
    if (gate.dist - state.dist > GATE_LOOKAHEAD) return null
    if (gate.path === plannedPathAt(state, gate.dist, plan)) return gate
  }
  return null
}

/** Where the gate will be lit when the courier gets there: pulse gates swap lanes on the beat. */
function interceptX(state: State, gate: Gate): number {
  const arrival = state.tick + ticksUntil(state, gate.dist) + 1
  return pulseGateLateral(gate, arrival)
}

function nextZone(state: State, zones: readonly Zone[], plan: ForkPlan, lookahead: number): Zone | null {
  for (const zone of zones) {
    if (zone.to <= state.dist) continue
    if (zone.from - state.dist > lookahead) return null
    if (zone.path === plannedPathAt(state, zone.to, plan)) return zone
  }
  return null
}

function nextHazard(state: State, plan: ForkPlan): Hazard | null {
  const hazards = state.track.hazards
  for (let i = state.hazardIdx; i < hazards.length; i++) {
    const hazard = hazards[i]!
    if (hazard.dist - state.dist > HAZARD_LOOKAHEAD) return null
    if (hazard.kind === 'gust') continue
    if (hazard.path === plannedPathAt(state, hazard.dist, plan)) return hazard
  }
  return null
}

function dodgeTarget(state: State, hazard: Hazard, target: number): number {
  const ticks = ticksUntil(state, hazard.dist)
  const arrival = state.tick + ticks + 1
  const halfWidth = halfWidthAt(state.track, hazard.dist, hazard.path)
  switch (hazard.kind) {
    case 'door':
      return hazard.x + doorOpenSide(hazard, arrival) * Math.trunc(halfWidth / 2)
    case 'train':
      return hazard.x - trainBlockedSide(hazard, arrival) * Math.trunc(halfWidth / 2)
    case 'barrier':
    case 'sweeper':
      return canClearByJump(state, ticks) ? target : steerAround(state, hazardLateral(hazard, arrival), hazard.half, halfWidth)
    case 'drone':
      return state.y === 0 && state.vy === 0 ? target : steerAround(state, hazardLateral(hazard, arrival), hazard.half, halfWidth)
    default:
      return target
  }
}

/** Grounded with time to reach barrier height, or airborne and still high when the hazard arrives. */
function canClearByJump(state: State, ticks: number): boolean {
  if (state.y === 0 && state.vy === 0) return ticks >= MIN_JUMP_TICKS
  return heightAfter(state, ticks + 1) >= LOW_HAZARD_HEIGHT + DODGE_MARGIN
}

function heightAfter(state: State, ticks: number): number {
  return state.y + state.vy * ticks - Math.trunc(GRAVITY * ticks * (ticks + 1) / 2)
}

function steerAround(state: State, lateral: number, half: number, halfWidth: number): number {
  const clearance = half + DODGE_CLEARANCE
  const preferred = state.x >= lateral ? 1 : -1
  const first = lateral + preferred * clearance
  if (Math.abs(first) <= halfWidth) return first
  return lateral - preferred * clearance
}

/** Steering holds x six times the per-tick push away from the target, so aim upwind by that much. */
function gustDrift(state: State, plan: ForkPlan): number {
  const path = plannedPathAt(state, state.dist, plan)
  let drift = 0
  for (const hazard of state.track.hazards) {
    if (hazard.dist > state.dist) break
    if (hazard.kind !== 'gust' || hazard.path !== path) continue
    if (state.dist < hazard.dist + hazard.length) drift += hazard.amplitude * 6
  }
  return drift
}

function chooseAction(state: State, plan: ForkPlan, target: number): Input['action'] {
  if (state.y !== 0 || state.vy !== 0) return 0
  const hazard = nextHazard(state, plan)
  if (hazard) {
    const action = hazardAction(state, hazard, target)
    if (action !== 0) return action
  }
  return gapAction(state, plan)
}

function hazardAction(state: State, hazard: Hazard, target: number): Input['action'] {
  const ticks = ticksUntil(state, hazard.dist)
  const arrival = state.tick + ticks + 1
  switch (hazard.kind) {
    case 'barrier':
    case 'sweeper': {
      const lateral = hazardLateral(hazard, arrival)
      const reach = hazard.half + DODGE_MARGIN
      const inLine = Math.abs(target - lateral) <= reach || Math.abs(state.x - lateral) <= reach
      return inLine && ticks <= JUMP_LEAD_TICKS && state.stumbleTicks === 0 ? ACTION_JUMP : 0
    }
    case 'beam':
    case 'drone':
      return ticks <= SLIDE_LEAD_TICKS && state.slideTicks <= ticks + 1 ? ACTION_SLIDE : 0
    default:
      return 0
  }
}

function gapAction(state: State, plan: ForkPlan): Input['action'] {
  for (const gap of state.track.gaps) {
    if (gap.from <= state.dist) continue
    if (gap.path !== plannedPathAt(state, gap.from, plan)) continue
    const ticks = ticksUntil(state, gap.from)
    if (ticks > GAP_LEAD_TICKS) return 0
    return Math.abs(state.x - gap.x) <= gap.half && state.stumbleTicks === 0 ? ACTION_JUMP : 0
  }
  return 0
}
