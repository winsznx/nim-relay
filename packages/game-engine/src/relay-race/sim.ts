import { ONE, abs, add, clamp, div, mul, sub } from '../fixed-point'
import { buildTrack, BASE_SPEED, BOOST_SPEED, MAX_TICKS, type Track } from './track'

/**
 * Relay Race deterministic sim (engine v3). Distance-based: the run ends when
 * the courier reaches the (line-adjusted) finish, so time is the result. Pure,
 * integer / Q16.16 only, seeded PRNG via the track, no Math.random/Date/libm.
 */

export interface RaceConfig {
  engineVersion: '3'
  challenge: 'relay-race'
  challengeVersion: '3'
  seed: string
}
export interface RaceInput {
  steer: number // -64..64
  boost: 0 | 1 // retained in the trace format; ignored by the sim (flow is automatic)
}
export interface RaceMetrics {
  perfectGates: number
  grazeGates: number
  missedGates: number
  gatesOnLine: number
  hazardsHit: number
  boostTicks: number
  flowSum: number
  beatHits: number
}
export interface RaceState {
  config: Readonly<RaceConfig>
  track: Readonly<Track>
  tick: number
  dist: number
  x: number
  vx: number
  speed: number
  heat: number
  flowPct: number
  boosting: 0 | 1
  forkChoice: -1 | 0 | 1
  onShortcut: 0 | 1
  finished: 0 | 1
  finishTick: number
  gateIdx: number
  hazIdx: number
  metrics: Readonly<RaceMetrics>
}

// forward speed is in Q16.16 units/tick; the route (~49 units) is tuned so a
// clean safe run lands near ~40s and an aggressive shortcut+boost run near ~30s.
const SPEED_LERP = Math.floor(ONE * 10 / 100)
const STEER_AUTH = Math.floor(ONE * 17 / 100)
const DAMPING = Math.floor(ONE * 83 / 100)
const HAZARD_SPEED_MUL = Math.floor(ONE * 45 / 100)
const STEER_UNIT = 1024 // 64 * 1024 == ONE
// flow: clean driving keeps you fast; mistakes cost speed
const FLOW_DECAY = Math.floor(ONE * 9 / 10000)
const FLOW_PERFECT = Math.floor(ONE * 22 / 100)
const FLOW_GRAZE = Math.floor(ONE * 5 / 100)
const FLOW_MISS = Math.floor(ONE * 16 / 100)
const FLOW_BEAT = Math.floor(ONE * 8 / 100)

function laneHalfAt(track: Track, dist: number): number {
  const pts = track.laneAt
  for (let i = 1; i < pts.length; i++) {
    if (dist <= pts[i]!.dist) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const t = div(sub(dist, a.dist) * ONE, Math.max(1, (b.dist - a.dist) * ONE))
      return add(a.half, mul(sub(b.half, a.half), t))
    }
  }
  return pts[pts.length - 1]!.half
}

function osc(tick: number, period: number): number {
  const p = period < 2 ? 2 : period
  const q = ((tick % p) + p) % p
  const half = Math.floor(p / 2)
  const ramp = q < half ? q : p - q
  return clamp(sub(div(ramp * ONE, half === 0 ? 1 : half), Math.floor(ONE / 2)) * 2, -ONE, ONE)
}

export function totalTicks(): number {
  return MAX_TICKS
}

export function validateRaceConfig(config: RaceConfig): void {
  if (config.engineVersion !== '3' || config.challengeVersion !== '3' || config.challenge !== 'relay-race') {
    throw new RangeError('relay-race requires engine/challenge version 3')
  }
  if (typeof config.seed !== 'string' || !config.seed.length || config.seed.length > 128) throw new RangeError('seed 1-128 chars')
}

export function createRaceState(config: RaceConfig): RaceState {
  validateRaceConfig(config)
  const track = buildTrack(config.seed)
  return {
    config: Object.freeze({ ...config }),
    track,
    tick: 0,
    dist: 0,
    x: 0,
    vx: 0,
    speed: BASE_SPEED,
    heat: 0,
    flowPct: 0,
    boosting: 0,
    forkChoice: 0,
    onShortcut: 0,
    finished: 0,
    finishTick: 0,
    gateIdx: 0,
    hazIdx: 0,
    metrics: {
      perfectGates: 0, grazeGates: 0, missedGates: 0, gatesOnLine: 0,
      hazardsHit: 0, boostTicks: 0, flowSum: 0, beatHits: 0,
    },
  }
}

function onMyLine(state: RaceState, x: number, dist: number): boolean {
  const t = state.track
  if (dist <= t.forkDist || dist >= t.forkRejoin) return true
  if (state.forkChoice === 0) return true
  return Math.sign(x) === state.forkChoice || x === 0
}

export function stepRace(state: RaceState, input: RaceInput, tick = state.tick): RaceState {
  if (!Number.isInteger(tick) || tick !== state.tick) throw new RangeError('relay-race step tick mismatch')
  if (state.finished === 1) return state
  const t = state.track
  const q = Math.max(-64, Math.min(64, Math.trunc(input.steer)))
  const boost: 0 | 1 = input.boost === 1 ? 1 : 0
  const m: RaceMetrics = { ...state.metrics }

  let { dist, x, vx, speed, heat, forkChoice, onShortcut } = state

  // turbulence
  let drift = 0
  let turbSlow = ONE
  for (const tb of t.turbulence) {
    if (dist >= tb.from && dist <= tb.to) {
      drift = mul(tb.drift, osc(tick, 70))
      turbSlow = Math.floor(ONE * 90 / 100)
    }
  }

  // FLOW — automatic. Builds on clean gate passes, decays slowly, dumps on a
  // hazard hit. `heat` holds it (0..ONE). The only input is steering.
  void boost
  heat = clamp(sub(heat, FLOW_DECAY), 0, ONE)
  m.boostTicks += heat > Math.floor(ONE * 60 / 100) ? 1 : 0
  m.flowSum += heat

  // speed = base .. boost, scaled by flow, minus turbulence slow
  let targetSpeed = add(BASE_SPEED, mul(sub(BOOST_SPEED, BASE_SPEED), heat))
  targetSpeed = mul(targetSpeed, turbSlow)
  speed = add(speed, mul(sub(targetSpeed, speed), SPEED_LERP))

  // steering
  const lane = laneHalfAt(t, dist)
  const targetX = clamp(q * STEER_UNIT, -lane, lane)
  vx = mul(add(vx, add(mul(sub(targetX, x), STEER_AUTH), drift)), DAMPING)
  x = clamp(add(x, vx), -lane, lane)
  if (x === -lane || x === lane) vx = 0

  // advance
  dist = add(dist, speed)

  // fork commit
  if (forkChoice === 0 && dist >= t.forkDist) {
    forkChoice = x >= 0 ? 1 : -1
    onShortcut = forkChoice === t.shortcutSide ? 1 : 0
  }

  const onBeat = dist >= t.liveFrom && dist <= t.liveTo && osc(tick, t.beatPeriod) > Math.floor(ONE * 5 / 10)

  // gates — clean passes build flow
  let gi = state.gateIdx
  while (gi < t.gates.length && t.gates[gi]!.dist <= dist) {
    const g = t.gates[gi]!
    gi++
    if (!onMyLine(state, g.x, g.dist)) continue
    m.gatesOnLine++
    const err = abs(sub(x, g.x))
    if (err <= g.core) {
      m.perfectGates++
      heat = clamp(add(heat, FLOW_PERFECT), 0, ONE)
      if (g.kind === 'beat' && onBeat) { heat = clamp(add(heat, FLOW_BEAT), 0, ONE); m.beatHits++ }
    } else if (err <= g.half) {
      m.grazeGates++
      heat = clamp(add(heat, FLOW_GRAZE), 0, ONE)
    } else {
      m.missedGates++
      heat = clamp(sub(heat, FLOW_MISS), 0, ONE)
    }
  }

  // hazards — a hit dumps most of your flow and knocks your line
  let hi = state.hazIdx
  while (hi < t.hazards.length && t.hazards[hi]!.dist <= dist) {
    const hz = t.hazards[hi]!
    hi++
    if (!onMyLine(state, hz.x, hz.dist)) continue
    if (abs(sub(x, hz.x)) <= hz.half) {
      m.hazardsHit++
      speed = mul(speed, HAZARD_SPEED_MUL)
      heat = Math.floor(heat / 5)
      vx = add(vx, x >= hz.x ? Math.floor(ONE * 6 / 100) : -Math.floor(ONE * 6 / 100))
    }
  }

  const effectiveFinish = onShortcut === 1 ? sub(t.finishDist, t.shortcutSaving) : t.finishDist
  let finished: 0 | 1 = 0
  let finishTick = state.finishTick
  if (dist >= effectiveFinish || tick + 1 >= MAX_TICKS) {
    finished = 1
    finishTick = tick + 1
  }

  return {
    ...state,
    tick: tick + 1,
    dist, x, vx, speed, heat,
    flowPct: Math.floor((heat * 100) / ONE),
    boosting: heat > Math.floor(ONE * 55 / 100) ? 1 : 0,
    forkChoice, onShortcut,
    finished, finishTick,
    gateIdx: gi,
    hazIdx: hi,
    metrics: m,
  }
}
