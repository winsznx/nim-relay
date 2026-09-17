import { ONE } from '../fixed-point'
import { buildTrack } from './track'
import {
  ACTION_JUMP,
  ACTION_SLIDE,
  CHALLENGE,
  ENGINE_VERSION,
  EVENT,
  MAX_OPENING_FLOW,
  MAX_TICKS,
  WORLDS,
  type Config,
  type Gate,
  type Hazard,
  type Input,
  type Metrics,
  type Path,
  type Segment,
  type State,
  type Track,
  type Zone,
} from './types'

const centimetres = (cm: number): number => Math.trunc(cm * ONE / 100)
const percent = (p: number): number => Math.trunc(p * ONE / 100)

// Forward motion, metres per tick (Q16.16). 0.46 m/tick is 27.6 m/s.
export const BASE_SPEED = centimetres(46)
export const FLOW_SPEED = centimetres(33)
export const STUMBLE_SPEED = centimetres(24)
export const RAIL_SPEED = centimetres(5)
export const PAD_SPEED = centimetres(20)
/** Speed closes 1/16 of the gap to its target each tick. */
export const SPEED_SMOOTHING = 16
/** Lateral position closes 1/6 of the gap to the steer target each tick. */
export const STEER_SMOOTHING = 6

// Vertical motion, metres per tick (Q16.16).
export const GRAVITY = 475
/** ~0.7 s of air, ~1.5 m apex. */
export const JUMP_VELOCITY = 9975
/** ~1.1 s of air, ~3.9 m apex. */
export const RAMP_VELOCITY = 15675

export const SLIDE_TICKS = 36
export const STUMBLE_TICKS = 48
export const FALL_STUMBLE_TICKS = 72
export const ACTION_BUFFER_TICKS = 8
export const CLEAN_LANDING_AIR_TICKS = 24

// Collision envelopes (Q16.16 m).
export const LOW_HAZARD_HEIGHT = centimetres(90)
export const DRONE_HEIGHT = centimetres(160)
export const TRAIN_HEIGHT = centimetres(200)
export const GAP_CLEARANCE = centimetres(25)
export const NEAR_MISS_MARGIN = centimetres(60)

/** FLOW changes, Q16.16 fractions of full FLOW. */
export const FLOW = {
  PERFECT_GATE: percent(5),
  PULSE_GATE: percent(9),
  NEAR_MISS: percent(4),
  CLEAN_LANDING: percent(3),
  RAIL_TICK: 66,
  PAD_TICK: 98,
  RISK_CLEAR: percent(12),
  HIT: percent(35),
  FALL: percent(45),
  MISSED_GATE: percent(4),
  /** ~1.5% per second. */
  DECAY_TICK: 16,
} as const

const STEER_RANGE = 64

type Draft = Omit<State, 'metrics'> & { metrics: Metrics }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function validateConfig(config: Config): void {
  if (config.engineVersion !== ENGINE_VERSION || config.challengeVersion !== ENGINE_VERSION || config.challenge !== CHALLENGE) {
    throw new RangeError('Relay leg version must be 5')
  }
  if (typeof config.seed !== 'string' || config.seed.length === 0 || config.seed.length > 128) throw new RangeError('Invalid seed')
  if (!WORLDS.includes(config.world)) throw new RangeError('Invalid world')
  if (config.tier !== 0 && config.tier !== 1 && config.tier !== 2) throw new RangeError('Invalid tier')
  const flow = config.openingFlow
  if (!Number.isSafeInteger(flow) || flow < 0 || flow > MAX_OPENING_FLOW) throw new RangeError('Invalid opening flow')
}

export function createState(config: Config): State {
  validateConfig(config)
  const track = buildTrack(config)
  return {
    config: canonicalConfig(config),
    track,
    tick: 0,
    dist: 0,
    x: 0,
    y: 0,
    vy: 0,
    speed: BASE_SPEED,
    flow: config.openingFlow,
    path: 'main',
    slideTicks: 0,
    stumbleTicks: 0,
    railing: 0,
    ground: groundAt(track, 0),
    events: 0,
    gateIdx: 0,
    hazardIdx: 0,
    finished: 0,
    metrics: {
      perfectGates: 0,
      totalGates: 0,
      pulseHits: 0,
      nearMisses: 0,
      hits: 0,
      falls: 0,
      jumps: 0,
      cleanLandings: 0,
      slides: 0,
      railTicks: 0,
      boostPadTicks: 0,
      riskRoutes: 0,
      flowSum: 0,
      flowPeak: config.openingFlow,
    },
    airTicks: 0,
    airCleared: 0,
    riskClean: 0,
    bufferedAction: 0,
    bufferTicks: 0,
  }
}

/** Only contract fields, in contract order: extra request fields never reach the result hash. */
function canonicalConfig(config: Config): Readonly<Config> {
  return Object.freeze({
    engineVersion: config.engineVersion,
    challenge: config.challenge,
    challengeVersion: config.challengeVersion,
    seed: config.seed,
    world: config.world,
    tier: config.tier,
    openingFlow: config.openingFlow,
  })
}

// ---------------------------------------------------------------------------
// Track queries (shared with renderers)
// ---------------------------------------------------------------------------

export function segmentAt(track: Readonly<Track>, dist: number): Segment {
  const segments = track.segments
  let low = 0
  let high = segments.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (segments[mid]!.from <= dist) low = mid
    else high = mid - 1
  }
  return segments[low]!
}

/** Ground height (Q16.16 m) at route distance `dist`, linear inside each segment. */
export function groundAt(track: Readonly<Track>, dist: number): number {
  const segment = segmentAt(track, dist)
  const span = segment.to - segment.from
  const offset = Math.min(Math.max(dist - segment.from, 0), span)
  return segment.elevationFrom + Math.trunc((segment.elevationTo - segment.elevationFrom) * offset / span)
}

/** Half-width (Q16.16 m) of `path` at `dist`. Fork paths use the fork's widths. */
export function halfWidthAt(track: Readonly<Track>, dist: number, path: Path): number {
  if (path === 'safe') return track.fork.safeHalfWidth
  if (path === 'risk') return track.fork.riskHalfWidth
  return segmentAt(track, dist).halfWidth
}

/** The physical path a courier travelling on `travelPath` occupies at `dist`. */
export function activePathAt(track: Readonly<Track>, dist: number, travelPath: Path): Path {
  return dist >= track.fork.from && dist < track.fork.to ? travelPath : 'main'
}

/** Integer triangle wave in [-amplitude, amplitude] with the hazard's period and phase. */
export function hazardLateral(hazard: Readonly<Hazard>, tick: number): number {
  if ((hazard.kind !== 'sweeper' && hazard.kind !== 'drone') || hazard.period <= 0) return hazard.x
  const cycle = (tick + hazard.phase) % hazard.period
  const rising = cycle * 2 < hazard.period ? cycle : hazard.period - cycle
  return hazard.x - hazard.amplitude + Math.trunc(rising * 4 * hazard.amplitude / hazard.period)
}

/** Side of the divider that is open (-1 left, 1 right). The open side flips every half period. */
export function doorOpenSide(hazard: Readonly<Hazard>, tick: number): -1 | 1 {
  if (hazard.period <= 0) return -1
  return ((tick + hazard.phase) % hazard.period) * 2 < hazard.period ? -1 : 1
}

/** Half of the track the train occupies (-1 left, 1 right). It switches every half period. */
export function trainBlockedSide(hazard: Readonly<Hazard>, tick: number): -1 | 1 {
  if (hazard.period <= 0) return 1
  return ((tick + hazard.phase) % hazard.period) * 2 < hazard.period ? 1 : -1
}

/**
 * Centre of the lit lane of a gate at `tick`. A pulse gate lights `x` on even
 * beats and `-x` on odd beats, swapping exactly on the beat, so one lane is
 * always lit. Gold gates never move. Pass `state.tick`.
 */
export function pulseGateLateral(gate: Readonly<Gate>, tick: number): number {
  if (gate.kind !== 'pulse' || gate.period <= 0) return gate.x
  return Math.trunc(tick / gate.period) % 2 === 0 ? gate.x : -gate.x
}

/**
 * True on the beat window of the pulse section. With `dist` it also requires
 * being inside the section, which is what boost pads use; without it the
 * answer is the pure beat phase for music-synced presentation.
 * Pass `state.tick`: every time-based rule resolves against the tick of the
 * state it produces.
 */
export function onBeat(track: Readonly<Track>, tick: number, dist?: number): boolean {
  const pulse = track.pulse
  if (dist !== undefined && (dist < pulse.from || dist >= pulse.to)) return false
  return tick % pulse.period < pulse.window
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export function step(state: State, input: Input): State {
  assertInput(input)
  if (state.finished) return state
  const s: Draft = { ...state, metrics: { ...state.metrics }, tick: state.tick + 1, events: 0 }
  const fromDist = state.dist
  const flowBefore = state.flow

  countDownTimers(s)
  steerLaterally(s, input.steer, fromDist)
  resolveAction(s, input.action)
  const landedAfter = integrateVertical(s)
  const onPad = boostPadActive(s, fromDist)
  updateSpeed(s, onPad)
  advance(s)
  enterFork(s, fromDist)
  resolveLanding(s, landedAfter)
  launchFromRamps(s, fromDist)
  crossGaps(s, fromDist)
  crossHazards(s)
  crossGates(s)
  updateRail(s, state.railing)
  rewardBoostPad(s, onPad)
  leaveFork(s)
  settleFlow(s, flowBefore)
  finishTick(s)
  return s
}

function assertInput(input: Input): void {
  const steerOk = Number.isInteger(input.steer) && input.steer >= -STEER_RANGE && input.steer <= STEER_RANGE
  const actionOk = input.action === 0 || input.action === ACTION_JUMP || input.action === ACTION_SLIDE
  if (!steerOk || !actionOk) throw new RangeError('Invalid relay leg input')
}

function countDownTimers(s: Draft): void {
  if (s.stumbleTicks > 0) s.stumbleTicks--
  if (s.slideTicks > 0) s.slideTicks--
  // FLOW drains first so gains earned this tick can still reach full FLOW.
  s.flow = Math.max(0, s.flow - FLOW.DECAY_TICK)
}

function steerLaterally(s: Draft, steer: number, fromDist: number): void {
  const halfWidth = halfWidthAt(s.track, fromDist, s.path)
  const target = Math.trunc(steer * halfWidth / STEER_RANGE)
  let x = s.x + Math.trunc((target - s.x) / STEER_SMOOTHING)
  x += gustPush(s.track, fromDist, s.path)
  s.x = Math.max(-halfWidth, Math.min(halfWidth, x))
}

function gustPush(track: Readonly<Track>, dist: number, travelPath: Path): number {
  const hazards = track.hazards
  let push = 0
  for (let i = 0; i < hazards.length; i++) {
    const hazard = hazards[i]!
    if (hazard.dist > dist) break
    if (hazard.kind !== 'gust' || dist >= hazard.dist + hazard.length) continue
    if (hazard.path === activePathAt(track, dist, travelPath)) push += hazard.amplitude
  }
  return push
}

function resolveAction(s: Draft, pressed: Input['action']): void {
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
  if (!grounded) return false
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
function integrateVertical(s: Draft): number {
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

function boostPadActive(s: Draft, fromDist: number): boolean {
  if (s.y !== 0 || s.vy !== 0) return false
  if (!zoneContains(s.track, s.track.boostPads, fromDist, s.x, s.path)) return false
  const inPulse = fromDist >= s.track.pulse.from && fromDist < s.track.pulse.to
  return !inPulse || onBeat(s.track, s.tick)
}

function updateSpeed(s: Draft, onPad: boolean): void {
  let target = STUMBLE_SPEED
  if (s.stumbleTicks === 0) {
    target = BASE_SPEED + Math.trunc(s.flow * FLOW_SPEED / ONE)
    if (s.railing) target += RAIL_SPEED
    if (onPad) target += PAD_SPEED
  }
  s.speed += Math.trunc((target - s.speed) / SPEED_SMOOTHING)
}

function advance(s: Draft): void {
  const progress = s.path === 'risk' ? Math.trunc(s.speed * s.track.fork.riskProgress / ONE) : s.speed
  s.dist = Math.min(s.track.finishDist, s.dist + progress)
}

function enterFork(s: Draft, fromDist: number): void {
  const fork = s.track.fork
  if (s.path !== 'main' || fromDist >= fork.from || s.dist < fork.from) return
  if (s.x * fork.riskSide > 0) {
    s.path = 'risk'
    s.riskClean = 1
    s.events |= EVENT.FORK_RISK
  } else {
    s.path = 'safe'
    s.events |= EVENT.FORK_SAFE
  }
}

function resolveLanding(s: Draft, airTicks: number): void {
  if (airTicks === 0) return
  if (s.stumbleTicks === 0 && zoneContains(s.track, s.track.gaps, s.dist, s.x, s.path)) {
    fall(s)
    return
  }
  s.events |= EVENT.LAND
  if (s.stumbleTicks === 0 && s.airCleared === 1 && airTicks >= CLEAN_LANDING_AIR_TICKS) {
    s.events |= EVENT.CLEAN_LAND
    s.metrics.cleanLandings++
    gainFlow(s, FLOW.CLEAN_LANDING)
  }
  s.airCleared = 0
}

function launchFromRamps(s: Draft, fromDist: number): void {
  if (s.y !== 0 || s.vy !== 0) return
  const ramp = crossedZone(s, s.track.ramps, fromDist, zoneEnd)
  if (!ramp) return
  s.vy = RAMP_VELOCITY
  s.airTicks = 0
  s.airCleared = 1
  s.slideTicks = 0
  s.metrics.jumps++
  s.events |= EVENT.JUMP
}

function crossGaps(s: Draft, fromDist: number): void {
  const gap = crossedZone(s, s.track.gaps, fromDist, zoneStart)
  if (!gap) return
  if (s.y >= GAP_CLEARANCE) s.airCleared = 1
  else if (s.stumbleTicks === 0) fall(s)
}

const zoneStart = (zone: Readonly<Zone>): number => zone.from
const zoneEnd = (zone: Readonly<Zone>): number => zone.to

/** First zone whose edge was crossed this tick, on the active path, inside its lateral window. */
function crossedZone(s: Draft, zones: readonly Zone[], fromDist: number, edge: (zone: Readonly<Zone>) => number): Zone | null {
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!
    if (zone.from > s.dist) break
    const at = edge(zone)
    if (fromDist >= at || s.dist < at) continue
    if (zone.path !== activePathAt(s.track, at, s.path)) continue
    if (Math.abs(s.x - zone.x) <= zone.half) return zone
  }
  return null
}

function zoneContains(track: Readonly<Track>, zones: readonly Zone[], dist: number, x: number, travelPath: Path): boolean {
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i]!
    if (zone.from > dist) break
    if (dist >= zone.to || zone.path !== activePathAt(track, dist, travelPath)) continue
    if (Math.abs(x - zone.x) <= zone.half) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

/** How a courier fares against one hazard: untouched, a near miss or a hit. */
export const OUTCOME = { CLEAR: 0, NEAR: 1, HIT: 2 } as const
export type HazardOutcome = (typeof OUTCOME)[keyof typeof OUTCOME]

function crossHazards(s: Draft): void {
  const hazards = s.track.hazards
  while (s.hazardIdx < hazards.length && hazards[s.hazardIdx]!.dist <= s.dist) {
    const hazard = hazards[s.hazardIdx]!
    s.hazardIdx++
    if (hazard.kind === 'gust' || s.stumbleTicks > 0) continue
    if (hazard.path !== activePathAt(s.track, hazard.dist, s.path)) continue
    resolveHazard(s, hazard)
  }
}

function resolveHazard(s: Draft, hazard: Hazard): void {
  const outcome = hazardOutcome(hazard, s.x, s.y, s.slideTicks, s.tick)
  if (outcome === OUTCOME.HIT) {
    hit(s)
  } else if (outcome === OUTCOME.NEAR) {
    s.events |= EVENT.NEAR_MISS
    s.metrics.nearMisses++
    gainFlow(s, FLOW.NEAR_MISS)
    if (s.y > 0) s.airCleared = 1
  }
}

/** The collision rule for one hazard at one instant, without side effects. */
export function hazardOutcome(hazard: Readonly<Hazard>, x: number, y: number, slideTicks: number, tick: number): HazardOutcome {
  switch (hazard.kind) {
    case 'barrier':
      return lateralOutcome(x - hazard.x, hazard.half, y < LOW_HAZARD_HEIGHT)
    case 'sweeper':
      return lateralOutcome(x - hazardLateral(hazard, tick), hazard.half, y < LOW_HAZARD_HEIGHT)
    case 'drone':
      return lateralOutcome(x - hazardLateral(hazard, tick), hazard.half, slideTicks === 0 && y < DRONE_HEIGHT)
    case 'beam':
      return slideTicks > 0 ? OUTCOME.NEAR : OUTCOME.HIT
    case 'door':
      return sideOutcome(x - hazard.x, hazard.half, doorOpenSide(hazard, tick), true)
    case 'train':
      return sideOutcome(x - hazard.x, 0, trainBlockedSide(hazard, tick) === 1 ? -1 : 1, y < TRAIN_HEIGHT)
    case 'gust':
      return OUTCOME.CLEAR
  }
}

function lateralOutcome(offset: number, half: number, vulnerable: boolean): HazardOutcome {
  const distance = Math.abs(offset)
  if (distance <= half) return vulnerable ? OUTCOME.HIT : OUTCOME.NEAR
  return distance <= half + NEAR_MISS_MARGIN ? OUTCOME.NEAR : OUTCOME.CLEAR
}

/** Door and train: the courier must be past the divider (`post` half-width) on the open side. */
function sideOutcome(offset: number, post: number, openSide: -1 | 1, vulnerable: boolean): HazardOutcome {
  const intoOpenSide = offset * openSide
  if (intoOpenSide <= post) return vulnerable ? OUTCOME.HIT : OUTCOME.NEAR
  return intoOpenSide <= post + NEAR_MISS_MARGIN ? OUTCOME.NEAR : OUTCOME.CLEAR
}

function hit(s: Draft): void {
  s.events |= EVENT.HIT
  s.metrics.hits++
  loseFlow(s, FLOW.HIT)
  stumble(s, STUMBLE_TICKS)
}

function fall(s: Draft): void {
  s.events |= EVENT.FALL
  s.metrics.falls++
  loseFlow(s, FLOW.FALL)
  stumble(s, FALL_STUMBLE_TICKS)
  s.y = 0
  s.vy = 0
  s.airTicks = 0
  s.airCleared = 0
}

function stumble(s: Draft, ticks: number): void {
  s.stumbleTicks = ticks
  s.slideTicks = 0
  s.speed = Math.min(s.speed, STUMBLE_SPEED)
  s.riskClean = 0
}

// ---------------------------------------------------------------------------
// Gates, rails, pads, fork exit, FLOW
// ---------------------------------------------------------------------------

function crossGates(s: Draft): void {
  const gates = s.track.gates
  while (s.gateIdx < gates.length && gates[s.gateIdx]!.dist <= s.dist) {
    const gate = gates[s.gateIdx]!
    s.gateIdx++
    if (gate.path !== activePathAt(s.track, gate.dist, s.path)) continue
    resolveGate(s, gate)
  }
}

/** A pulse gate passed in its lit lane is both a perfect gate and a PULSE_HIT; the dark lane is a miss. */
function resolveGate(s: Draft, gate: Gate): void {
  s.metrics.totalGates++
  if (Math.abs(s.x - pulseGateLateral(gate, s.tick)) > gate.half) {
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

function updateRail(s: Draft, wasRailing: 0 | 1): void {
  const grounded = s.y === 0 && s.vy === 0
  const railing: 0 | 1 = grounded && zoneContains(s.track, s.track.rails, s.dist, s.x, s.path) ? 1 : 0
  if (railing === 1 && wasRailing === 0) s.events |= EVENT.RAIL_ON
  if (railing === 0 && wasRailing === 1) s.events |= EVENT.RAIL_OFF
  if (railing === 1) {
    s.metrics.railTicks++
    gainFlow(s, FLOW.RAIL_TICK)
  }
  s.railing = railing
}

function rewardBoostPad(s: Draft, onPad: boolean): void {
  if (!onPad) return
  s.events |= EVENT.BOOST_PAD
  s.metrics.boostPadTicks++
  gainFlow(s, FLOW.PAD_TICK)
}

function leaveFork(s: Draft): void {
  if (s.path === 'main' || s.dist < s.track.fork.to) return
  if (s.path === 'risk') {
    s.metrics.riskRoutes++
    if (s.riskClean === 1) {
      s.events |= EVENT.RISK_CLEAR
      gainFlow(s, FLOW.RISK_CLEAR)
    }
  }
  s.path = 'main'
  s.riskClean = 0
}

function gainFlow(s: Draft, amount: number): void {
  s.flow = Math.min(ONE, s.flow + amount)
}

function loseFlow(s: Draft, amount: number): void {
  s.flow = Math.max(0, s.flow - amount)
}

function settleFlow(s: Draft, flowBefore: number): void {
  if (s.flow === ONE && flowBefore < ONE) s.events |= EVENT.FLOW_MAX
  s.metrics.flowSum += s.flow
  if (s.flow > s.metrics.flowPeak) s.metrics.flowPeak = s.flow
}

function finishTick(s: Draft): void {
  s.ground = groundAt(s.track, s.dist)
  const arrived = s.dist >= s.track.finishDist
  if (arrived) s.events |= EVENT.FINISH
  if (arrived || s.tick >= MAX_TICKS) s.finished = 1
}
