import { relayLeg } from '@nim-relay/game-engine'

/**
 * A deterministic lookahead courier for dev captures and tests. It reads the
 * track the way a player reads the screen: follow the gold line, jump red walls
 * and gaps, slide under beams and drones, take the open side of doors and
 * trains, lean into gusts. `lag` adds reaction delay so ghosts differ from runs.
 */

export interface BotOptions {
  fork: 'safe' | 'risk'
  /** Ticks of hesitation before reacting to hazards (0 = sharp). */
  lag?: number
  /** Lateral bias in percent of half-width, so two bots do not overlap exactly. */
  bias?: number
}

const ONE = 65536
const GATE_LOOKAHEAD = 60 * ONE
const HAZARD_LOOKAHEAD = 40 * ONE
const RAMP_LOOKAHEAD = 45 * ONE
const FORK_LOOKAHEAD = 50 * ONE
const JUMP_LEAD_TICKS = 20
const SLIDE_LEAD_TICKS = 24
const GAP_LEAD_TICKS = 3
const DODGE_MARGIN = Math.trunc((ONE * 3) / 10)

type State = relayLeg.State
type Path = relayLeg.Path

export function createBot(options: BotOptions): (state: State) => relayLeg.Input {
  const lag = options.lag ?? 0
  const bias = options.bias ?? 0
  return state => {
    const halfWidth = relayLeg.halfWidthAt(state.track, state.dist, state.path)
    const target = steerTarget(state, options.fork, lag) + Math.trunc((halfWidth * bias) / 100)
    const steer = Math.max(-64, Math.min(64, Math.trunc((target * 64) / halfWidth)))
    return { steer, action: chooseAction(state, options.fork, target, lag) }
  }
}

/** Plays a whole leg headless and returns the canonical trace and result. */
export function playBotLeg(config: relayLeg.Config, options: BotOptions): { trace: relayLeg.Sample[]; result: relayLeg.Result } {
  const bot = createBot(options)
  let state = relayLeg.createState(config)
  const trace: relayLeg.Sample[] = []
  let lastTick = 0
  while (!state.finished) {
    const input = bot(state)
    const previous = trace.at(-1)
    if (!previous || previous[1] !== input.steer || input.action !== 0 || state.tick - lastTick >= 24) {
      trace.push([state.tick - lastTick, input.steer, input.action])
      lastTick = state.tick
    }
    state = relayLeg.step(state, input)
  }
  return { trace, result: relayLeg.finalize(state, trace) }
}

function plannedPath(state: State, dist: number, plan: 'safe' | 'risk'): Path {
  const fork = state.track.fork
  if (dist < fork.from || dist >= fork.to) return 'main'
  return state.path === 'main' ? plan : state.path
}

function ticksUntil(state: State, dist: number): number {
  const speed = Math.max(state.speed, 1)
  const progress = state.path === 'risk' ? Math.trunc((speed * state.track.fork.riskProgress) / ONE) : speed
  return Math.trunc((dist - state.dist) / Math.max(progress, 1))
}

function steerTarget(state: State, plan: 'safe' | 'risk', lag: number): number {
  const fork = state.track.fork
  let target = nextGateX(state, plan) ?? 0
  const ramp = nextZone(state, state.track.ramps, plan, RAMP_LOOKAHEAD)
  if (ramp) target = ramp.x
  if (state.path === 'main' && state.dist < fork.from && fork.from - state.dist <= FORK_LOOKAHEAD) {
    const side = plan === 'risk' ? fork.riskSide : -fork.riskSide
    target = side * Math.trunc(relayLeg.halfWidthAt(state.track, state.dist, 'main') / 2)
  }
  const hazard = nextHazard(state, plan)
  if (hazard && ticksUntil(state, hazard.dist) > lag) target = dodgeTarget(state, hazard, target)
  return target - gustDrift(state)
}

function nextGateX(state: State, plan: 'safe' | 'risk'): number | null {
  const gates = state.track.gates
  for (let i = state.gateIdx; i < gates.length; i++) {
    const gate = gates[i]!
    if (gate.dist - state.dist > GATE_LOOKAHEAD) return null
    if (gate.path === plannedPath(state, gate.dist, plan)) return relayLeg.pulseGateLateral(gate, state.tick + ticksUntil(state, gate.dist) + 1)
  }
  return null
}

function nextZone(state: State, zones: readonly relayLeg.Zone[], plan: 'safe' | 'risk', lookahead: number): relayLeg.Zone | null {
  for (const zone of zones) {
    if (zone.to <= state.dist) continue
    if (zone.from - state.dist > lookahead) return null
    if (zone.path === plannedPath(state, zone.to, plan)) return zone
  }
  return null
}

function nextHazard(state: State, plan: 'safe' | 'risk'): relayLeg.Hazard | null {
  const hazards = state.track.hazards
  for (let i = state.hazardIdx; i < hazards.length; i++) {
    const hazard = hazards[i]!
    if (hazard.dist - state.dist > HAZARD_LOOKAHEAD) return null
    if (hazard.kind === 'gust') continue
    if (hazard.path === plannedPath(state, hazard.dist, plan)) return hazard
  }
  return null
}

function dodgeTarget(state: State, hazard: relayLeg.Hazard, target: number): number {
  const arrival = state.tick + ticksUntil(state, hazard.dist) + 1
  const path = plannedPath(state, hazard.dist, state.path === 'risk' ? 'risk' : 'safe')
  const halfWidth = relayLeg.halfWidthAt(state.track, hazard.dist, path)
  if (hazard.kind === 'door') return hazard.x + relayLeg.doorOpenSide(hazard, arrival) * Math.trunc(halfWidth / 2)
  if (hazard.kind === 'train') return hazard.x - relayLeg.trainBlockedSide(hazard, arrival) * Math.trunc(halfWidth / 2)
  return target
}

function gustDrift(state: State): number {
  let drift = 0
  for (const hazard of state.track.hazards) {
    if (hazard.dist > state.dist) break
    if (hazard.kind === 'gust' && state.dist < hazard.dist + hazard.length) drift += hazard.amplitude * 6
  }
  return drift
}

function chooseAction(state: State, plan: 'safe' | 'risk', target: number, lag: number): relayLeg.Input['action'] {
  if (state.y !== 0 || state.vy !== 0) return 0
  const hazard = nextHazard(state, plan)
  if (hazard) {
    const action = hazardAction(state, hazard, target, lag)
    if (action !== 0) return action
  }
  return gapAction(state, plan)
}

function hazardAction(state: State, hazard: relayLeg.Hazard, target: number, lag: number): relayLeg.Input['action'] {
  const ticks = ticksUntil(state, hazard.dist)
  const arrival = state.tick + ticks + 1
  switch (hazard.kind) {
    case 'barrier':
    case 'sweeper': {
      const lateral = relayLeg.hazardLateral(hazard, arrival)
      const reach = hazard.half + DODGE_MARGIN
      const inLine = Math.abs(target - lateral) <= reach || Math.abs(state.x - lateral) <= reach
      return inLine && ticks <= JUMP_LEAD_TICKS - lag && state.stumbleTicks === 0 ? relayLeg.ACTION_JUMP : 0
    }
    case 'beam':
    case 'drone':
      return ticks <= SLIDE_LEAD_TICKS - lag && state.slideTicks <= ticks + 1 ? relayLeg.ACTION_SLIDE : 0
    default:
      return 0
  }
}

function gapAction(state: State, plan: 'safe' | 'risk'): relayLeg.Input['action'] {
  for (const gap of state.track.gaps) {
    if (gap.from <= state.dist) continue
    if (gap.path !== plannedPath(state, gap.from, plan)) continue
    const ticks = ticksUntil(state, gap.from)
    if (ticks > GAP_LEAD_TICKS) return 0
    return Math.abs(state.x - gap.x) <= gap.half && state.stumbleTicks === 0 ? relayLeg.ACTION_JUMP : 0
  }
  return 0
}
