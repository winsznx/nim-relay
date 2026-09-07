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
  boost: 0 | 1
}
export interface RaceMetrics {
  perfectGates: number
  grazeGates: number
  missedGates: number
  gatesOnLine: number
  hazardsHit: number
  boostTicks: number
  overheatEvents: number
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
  overheatTicks: number
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
const HEAT_RISE = Math.floor(ONE * 4 / 1000)
const HEAT_FALL = Math.floor(ONE * 8 / 1000)
const STEER_AUTH = Math.floor(ONE * 16 / 100)
const DAMPING = Math.floor(ONE * 80 / 100)
const OVERHEAT_TICKS = 48
const GATE_SPEED_BONUS = Math.floor(ONE * 22 / 10000)
const BEAT_BONUS = Math.floor(ONE * 45 / 10000)
const HAZARD_SPEED_MUL = Math.floor(ONE * 45 / 100)
const OVERHEAT_SPEED_MUL = Math.floor(ONE * 52 / 100)
const STEER_UNIT = 1024 // 64 * 1024 == ONE

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
    overheatTicks: 0,
    boosting: 0,
    forkChoice: 0,
    onShortcut: 0,
    finished: 0,
    finishTick: 0,
    gateIdx: 0,
    hazIdx: 0,
    metrics: {
      perfectGates: 0, grazeGates: 0, missedGates: 0, gatesOnLine: 0,
      hazardsHit: 0, boostTicks: 0, overheatEvents: 0, beatHits: 0,
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

  let { dist, x, vx, speed, heat, overheatTicks, forkChoice, onShortcut } = state

  // turbulence
  let drift = 0
  let turbSlow = ONE
  for (const tb of t.turbulence) {
    if (dist >= tb.from && dist <= tb.to) {
      drift = mul(tb.drift, osc(tick, 70))
      turbSlow = Math.floor(ONE * 90 / 100)
    }
  }

  // speed
  const boostable = boost === 1 && overheatTicks === 0
  let targetSpeed = boostable ? BOOST_SPEED : BASE_SPEED
  if (overheatTicks > 0) targetSpeed = mul(targetSpeed, OVERHEAT_SPEED_MUL)
  targetSpeed = mul(targetSpeed, turbSlow)
  speed = add(speed, mul(sub(targetSpeed, speed), SPEED_LERP))

  // heat
  if (boostable) {
    m.boostTicks++
    heat = clamp(add(heat, HEAT_RISE), 0, ONE)
    if (heat >= ONE) { overheatTicks = OVERHEAT_TICKS; heat = 0; m.overheatEvents++ }
  } else {
    heat = clamp(sub(heat, HEAT_FALL), 0, ONE)
  }
  if (overheatTicks > 0) overheatTicks--

  // steering
  const lane = laneHalfAt(t, dist)
  const targetX = clamp(q * STEER_UNIT, -lane, lane)
  let authority = STEER_AUTH
  if (overheatTicks > 0) authority = Math.floor(authority / 2)
  vx = mul(add(vx, add(mul(sub(targetX, x), authority), drift)), DAMPING)
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

  // gates
  let gi = state.gateIdx
  while (gi < t.gates.length && t.gates[gi]!.dist <= dist) {
    const g = t.gates[gi]!
    gi++
    if (!onMyLine(state, g.x, g.dist)) continue
    m.gatesOnLine++
    const err = abs(sub(x, g.x))
    if (err <= g.core) {
      m.perfectGates++
      speed = add(speed, GATE_SPEED_BONUS)
      if (g.kind === 'beat' && (onBeat || boostable)) { speed = add(speed, BEAT_BONUS); m.beatHits++ }
    } else if (err <= g.half) {
      m.grazeGates++
      speed = add(speed, Math.floor(GATE_SPEED_BONUS / 3))
    } else {
      m.missedGates++
    }
  }

  // hazards
  let hi = state.hazIdx
  while (hi < t.hazards.length && t.hazards[hi]!.dist <= dist) {
    const hz = t.hazards[hi]!
    hi++
    if (!onMyLine(state, hz.x, hz.dist)) continue
    if (abs(sub(x, hz.x)) <= hz.half) {
      m.hazardsHit++
      speed = mul(speed, HAZARD_SPEED_MUL)
      heat = clamp(add(heat, Math.floor(ONE * 3 / 10)), 0, ONE)
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
    dist, x, vx, speed, heat, overheatTicks,
    boosting: boost,
    forkChoice, onShortcut,
    finished, finishTick,
    gateIdx: gi,
    hazIdx: hi,
    metrics: m,
  }
}
