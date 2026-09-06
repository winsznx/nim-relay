import { ONE, HALF, abs, add, clamp, div, mul, sub } from '../fixed-point'
import {
  composeRoute,
  deriveCarryState,
  NEUTRAL_CARRY,
  routeTotalTicks,
  type CarryState,
  type PrevLegSummary,
  type RouteModule,
} from './route'

/**
 * Relay Run composite deterministic sim (engine v2). One fixed-60Hz tick loop;
 * Catch -> traversal (gates, fork, turbulence, pulse, Redline heat) -> Sling.
 * Pure: integer / Q16.16 only, seeded PRNG via route composition, no
 * DOM/Math.random/Date/IO. `Math.floor`/`min`/`max`/`abs` only (IEEE-754 safe).
 * See docs/RELAY_GAME_V2.md.
 */

export interface RelayRunConfig {
  engineVersion: '2'
  challenge: 'relay-run'
  challengeVersion: '2'
  seed: string
  legNumber: number
  sourceRegionId: string
  destRegionId: string
  prevLeg?: PrevLegSummary | null
}

export interface RelayInput {
  steer: number // -64..64
  pressed: 0 | 1
}

export interface RelayMetrics {
  centerHits: number
  grazes: number
  misses: number
  totalGates: number
  cleanGateRatioNorm: number
  stabilizeIn: number
  stabilizeOut: number
  turbulenceScoreNorm: number
  pulseOnBeat: number
  pulseCombo: number
  overheats: number
  greedyTicks: number
  comboMax: number
  rawScore: number
}

export interface RelayState {
  config: Readonly<RelayRunConfig>
  carry: Readonly<CarryState>
  mods: readonly RouteModule[]
  tick: number
  phase: RouteModule['kind']
  x: number
  vx: number
  heat: number
  overheatTicks: number
  combo: number
  lastPressed: 0 | 1
  caught: 0 | 1
  catchQuality: number
  forkChoice: -1 | 0 | 1
  forkTight: 0 | 1
  slingCharging: 0 | 1
  slingReleased: 0 | 1
  slingPower: number
  slingAngle: number
  slingAccuracy: number
  metrics: Readonly<RelayMetrics>
}

// ── tuning constants (Q16.16 unless noted) ──
const STEER_UNIT = 1024 // 64 * 1024 == ONE
const STEER_ACCEL = Math.floor(ONE * 14 / 100)
const DAMPING = Math.floor(ONE * 82 / 100)
const TURB_AUTH_CUT = Math.floor(ONE * 55 / 100)
const TURB_INERTIA = Math.floor(ONE * 14 / 100)
const TURB_DRIFT = Math.floor(ONE * 9 / 100)
const OVERHEAT_AUTH = Math.floor(ONE * 30 / 100)
const HEAT_MAX = ONE
const GREEDY_ZONE = Math.floor(ONE * 78 / 100)
const TIGHT_HEAT = Math.floor(ONE * 9 / 1000)
const COMBO_HEAT = Math.floor(ONE * 6 / 1000)
const OVERDRIVE_HEAT = Math.floor(ONE * 12 / 1000)
const HEAT_COOL = Math.floor(ONE * 11 / 1000)
const COMBO_HEAT_THRESH = 6
const CATCH_PERIOD = 120
const SLING_SWEEP_PERIOD = 84
const SLING_POWER_RATE = Math.floor(ONE * 22 / 1000)
const CENTER_PTS = 900
const GRAZE_PTS = 220
const GREEDY_BONUS_NUM = 3 // ×1.5 == ×(3/2)
const PULSE_BONUS_NUM = 4 // ×2 for on-beat pulse

/** signed triangle oscillator in [-ONE, ONE], integer only. */
function osc(tick: number, period: number): number {
  const p = period < 2 ? 2 : period
  const q = ((tick % p) + p) % p
  const half = Math.floor(p / 2)
  const ramp = q < half ? q : p - q // 0..half
  return clamp(sub(div(ramp * ONE, half === 0 ? 1 : half), HALF) * 2, -ONE, ONE)
}

function steerToFixed(q: number): number {
  return clamp(q * STEER_UNIT, -ONE, ONE)
}

export function totalTicks(config: RelayRunConfig): number {
  return routeTotalTicks(composeRoute(config.seed, config.legNumber, carryFor(config)))
}

function carryFor(config: RelayRunConfig): CarryState {
  return config.prevLeg ? deriveCarryState(config.prevLeg) : NEUTRAL_CARRY
}

export function validateRelayRunConfig(config: RelayRunConfig): void {
  if (config.engineVersion !== '2' || config.challengeVersion !== '2' || config.challenge !== 'relay-run') {
    throw new RangeError('relay-run requires engine/challenge version 2')
  }
  if (typeof config.seed !== 'string' || !config.seed.length || config.seed.length > 128) throw new RangeError('seed 1-128 chars')
  if (!Number.isInteger(config.legNumber) || config.legNumber < 1 || config.legNumber > 500) throw new RangeError('legNumber 1-500')
}

export function createRelayState(config: RelayRunConfig): RelayState {
  validateRelayRunConfig(config)
  const carry = carryFor(config)
  const mods = composeRoute(config.seed, config.legNumber, carry)
  return {
    config: Object.freeze({ ...config, prevLeg: config.prevLeg ?? null }),
    carry: Object.freeze(carry),
    mods,
    tick: 0,
    phase: 'catch',
    x: clamp(carry.incomingTrajectory, -ONE, ONE),
    vx: 0,
    heat: 0,
    overheatTicks: 0,
    combo: 0,
    lastPressed: 0,
    caught: 0,
    catchQuality: 0,
    forkChoice: 0,
    forkTight: 0,
    slingCharging: 0,
    slingReleased: 0,
    slingPower: 0,
    slingAngle: 0,
    slingAccuracy: 0,
    metrics: {
      centerHits: 0, grazes: 0, misses: 0, totalGates: 0, cleanGateRatioNorm: 0,
      stabilizeIn: 0, stabilizeOut: 0, turbulenceScoreNorm: 0, pulseOnBeat: 0, pulseCombo: 0,
      overheats: 0, greedyTicks: 0, comboMax: 0, rawScore: 0,
    },
  }
}

function moduleAt(mods: readonly RouteModule[], tick: number): RouteModule {
  for (const m of mods) if (tick >= m.startTick && tick < m.endTick) return m
  return mods[mods.length - 1]!
}

export function stepRelay(state: RelayState, input: RelayInput, tick = state.tick): RelayState {
  if (!Number.isInteger(tick) || tick !== state.tick) throw new RangeError('relay step tick mismatch')
  const q = Math.max(-64, Math.min(64, Math.trunc(input.steer)))
  const pressed: 0 | 1 = input.pressed === 1 ? 1 : 0
  const total = routeTotalTicks(state.mods)
  if (tick >= total) return state

  const mod = moduleAt(state.mods, tick)
  const m: RelayMetrics = { ...state.metrics }
  let { x, vx, heat, overheatTicks, combo, caught, catchQuality, forkChoice, forkTight } = state
  let { slingCharging, slingReleased, slingPower, slingAngle, slingAccuracy } = state
  const press = pressed === 1 && state.lastPressed === 0
  const release = pressed === 0 && state.lastPressed === 1

  // ── turbulence parameters ──
  let turb = 0
  let corridorHW = ONE
  if (mod.kind === 'turbulence') {
    turb = mod.turbIntensity
    const prog = div((tick - mod.startTick) * ONE, mod.endTick - mod.startTick) // 0..ONE
    corridorHW = add(mul(sub(Math.floor(ONE * 42 / 100), mod.corridorEnd), sub(ONE, prog)), mod.corridorEnd)
  }

  // ── steering physics ──
  let authority = mul(STEER_ACCEL, sub(ONE, mul(turb, TURB_AUTH_CUT)))
  if (overheatTicks > 0) authority = mul(authority, OVERHEAT_AUTH)
  let damping = sub(DAMPING, mul(turb, TURB_INERTIA))
  if (tick < 600) damping = clamp(mul(damping, state.carry.incomingStability), Math.floor(ONE * 60 / 100), Math.floor(ONE * 95 / 100))
  const target = steerToFixed(q)
  const drift = turb > 0 ? mul(turb, mul(TURB_DRIFT, osc(tick, 96))) : 0
  vx = mul(add(vx, add(mul(sub(target, x), authority), drift)), damping)
  x = clamp(add(x, vx), -ONE, ONE)
  if (x === -ONE || x === ONE) vx = 0

  // ── Catch ──
  if (mod.kind === 'catch') {
    const retX = mul(osc(tick, CATCH_PERIOD), Math.floor(ONE * 62 / 100))
    if (press && caught === 0) {
      caught = 1
      const err = abs(sub(x, retX))
      const window = mul(Math.floor(ONE * 30 / 100), state.carry.catchWindowScale)
      catchQuality = clamp(sub(ONE, div(err, window === 0 ? 1 : window)), 0, ONE)
      if (catchQuality > Math.floor(ONE * 75 / 100)) combo = 1
    }
    if (tick === mod.endTick - 1 && caught === 0) { caught = 1; catchQuality = 0 }
  }

  // ── Fork commit ──
  if (mod.kind === 'fork') {
    const entry = mod.startTick + 60
    if (tick === entry && forkChoice === 0) {
      forkChoice = x >= 0 ? 1 : -1
      forkTight = forkChoice === mod.tightSide ? 1 : 0
    }
    if (forkTight === 1 && ((forkChoice === 1 && x < 0) || (forkChoice === -1 && x >= 0))) {
      vx = add(vx, forkChoice === 1 ? Math.floor(ONE * 3 / 100) : -Math.floor(ONE * 3 / 100)) // wall nudge
    }
  }

  // ── Gates (this tick) ──
  const forkMult = forkTight === 1 ? 8 : 5 // ×1.6 vs ×1.0 via /5
  for (const g of mod.gates) {
    if (g.tick !== tick) continue
    m.totalGates++
    const err = abs(sub(x, g.x))
    const beatPhase = g.beat > 0 ? osc(tick, g.beat) : ONE
    const effRadius = g.beat > 0 ? (beatPhase > 0 ? g.radius : Math.floor(g.radius / 3)) : g.radius
    const onBeat = g.beat > 0 && beatPhase > Math.floor(ONE * 55 / 100)
    let pts = 0
    if (err <= g.core) {
      pts = CENTER_PTS
      combo++
      if (g.beat > 0) { if (onBeat) { m.pulseOnBeat++; m.pulseCombo++ } }
      else m.centerHits++
    } else if (err <= effRadius) {
      pts = GRAZE_PTS
      m.grazes++
    } else {
      m.misses++
      combo = 0
      if (g.beat > 0) m.pulseCombo = 0
      vx = add(vx, x >= g.x ? Math.floor(ONE * 4 / 100) : -Math.floor(ONE * 4 / 100)) // stumble
    }
    if (pts > 0) {
      let scaled = Math.floor((pts * forkMult) / 5)
      if (heat >= GREEDY_ZONE) scaled = Math.floor((scaled * GREEDY_BONUS_NUM) / 2)
      if (g.beat > 0 && onBeat && m.pulseCombo > 0) scaled = Math.floor((scaled * PULSE_BONUS_NUM * Math.min(4, m.pulseCombo)) / 4)
      m.rawScore += scaled
    }
  }

  // ── Turbulence corridor tracking ──
  if (mod.kind === 'turbulence') {
    if (abs(x) <= corridorHW) m.stabilizeIn++
    else m.stabilizeOut++
  }

  // ── Redline heat ──
  if (mod.kind !== 'catch' && mod.kind !== 'sling') {
    let gain = 0
    if (forkTight === 1) gain += TIGHT_HEAT
    if (combo >= COMBO_HEAT_THRESH) gain += COMBO_HEAT
    if (pressed === 1) gain += OVERDRIVE_HEAT
    heat = gain > 0 ? clamp(add(heat, gain), 0, HEAT_MAX) : clamp(sub(heat, HEAT_COOL), 0, HEAT_MAX)
    if (heat >= GREEDY_ZONE) m.greedyTicks++
    if (heat >= HEAT_MAX) { overheatTicks = 60; combo = 0; heat = 0; m.overheats++ }
  }
  if (overheatTicks > 0) overheatTicks--

  // ── Sling ──
  if (mod.kind === 'sling') {
    if (pressed === 1 && slingReleased === 0) { slingCharging = 1; slingPower = clamp(add(slingPower, SLING_POWER_RATE), 0, ONE) }
    slingAngle = mul(osc(tick, SLING_SWEEP_PERIOD), Math.floor(ONE * 70 / 100))
    if ((release || tick === mod.endTick - 1) && slingReleased === 0) {
      slingReleased = 1
      slingCharging = 0
      const angleErr = abs(slingAngle) // want centre
      const powerErr = abs(sub(slingPower, Math.floor(ONE * 72 / 100)))
      slingAccuracy = clamp(sub(ONE, div(add(angleErr, powerErr), 2 * ONE)), 0, ONE)
    }
  }

  if (combo > m.comboMax) m.comboMax = combo
  if (m.totalGates > 0) m.cleanGateRatioNorm = div((m.centerHits + m.grazes) * ONE, m.totalGates)
  const turbTotal = m.stabilizeIn + m.stabilizeOut
  if (turbTotal > 0) m.turbulenceScoreNorm = div(m.stabilizeIn * ONE, turbTotal)

  return {
    ...state,
    tick: tick + 1,
    phase: mod.kind,
    x, vx, heat, overheatTicks, combo,
    lastPressed: pressed,
    caught, catchQuality, forkChoice, forkTight,
    slingCharging, slingReleased, slingPower, slingAngle, slingAccuracy,
    metrics: m,
  }
}
