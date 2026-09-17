import { BASE_SPEED } from './constants'
import {
  boostPadActive,
  crossEvents,
  crossGaps,
  crossGates,
  crossHazards,
  enterFork,
  launchFromRamps,
  leaveFork,
  resolveLanding,
  rewardBoostPad,
  triggerEvents,
  updateRail,
} from './contact'
import type { Draft } from './flow'
import { groundAt, laneLayoutAt } from './geometry'
import { isValidGhostline } from './ghost-sample'
import {
  acquireLane,
  advance,
  advanceFall,
  advanceTether,
  applyShift,
  countDownTimers,
  integrateVertical,
  moveLaterally,
  resolveAction,
  resolveGrind,
  updateSpeed,
  windOffset,
} from './locomotion'
import { finishTick, settleFlow, updateGhost, updateRush } from './progress'
import { buildTrack } from './track'
import {
  ACTION_JUMP,
  ACTION_SLIDE,
  CHALLENGE,
  ENGINE_VERSION,
  MAX_OPENING_FLOW,
  NUDGE_RANGE,
  WORLDS,
  type Config,
  type Ghostline,
  type Input,
  type State,
} from './types'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function validateConfig(config: Config): void {
  if (config.engineVersion !== ENGINE_VERSION || config.challengeVersion !== ENGINE_VERSION || config.challenge !== CHALLENGE) {
    throw new RangeError('Relay leg version must be 6')
  }
  if (typeof config.seed !== 'string' || config.seed.length === 0 || config.seed.length > 128) throw new RangeError('Invalid seed')
  if (!WORLDS.includes(config.world)) throw new RangeError('Invalid world')
  if (config.tier !== 0 && config.tier !== 1 && config.tier !== 2) throw new RangeError('Invalid tier')
  const flow = config.openingFlow
  if (!Number.isSafeInteger(flow) || flow < 0 || flow > MAX_OPENING_FLOW) throw new RangeError('Invalid opening flow')
  if (config.tetherSaves !== 0 && config.tetherSaves !== 1) throw new RangeError('Invalid tether saves')
  if (config.ghostline !== null && !isValidGhostline(config.ghostline)) throw new RangeError('Invalid ghostline')
}

export function createState(config: Config): State {
  validateConfig(config)
  const track = buildTrack(config)
  return {
    config: canonicalConfig(config),
    track,
    tick: 0,
    dist: 0,
    path: 'main',
    lane: 0,
    targetLane: 0,
    x: 0,
    vx: 0,
    nudge: 0,
    y: 0,
    vy: 0,
    speed: BASE_SPEED,
    flow: config.openingFlow,
    motion: 'riding',
    motionTicks: 0,
    edgeSide: 0,
    tetherSaves: config.tetherSaves,
    rushTicks: 0,
    slideTicks: 0,
    stumbleTicks: 0,
    railing: 0,
    ground: groundAt(track, 0),
    events: 0,
    gateIdx: 0,
    hazardIdx: 0,
    eventTicks: track.events.map(() => -1),
    forkChoices: track.forks.map(() => 0 as const),
    ghostLeadTicks: 0,
    ghostAhead: 0,
    airTicks: 0,
    airCleared: 0,
    riskClean: 0,
    bufferedAction: 0,
    bufferTicks: 0,
    moments: [],
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
      hardLandings: 0,
      slides: 0,
      railTicks: 0,
      boostPadTicks: 0,
      riskRoutes: 0,
      laneChanges: 0,
      cleanLaneChanges: 0,
      edgeGrinds: 0,
      edgeSaves: 0,
      tetherSaves: 0,
      draftTicks: 0,
      overtakes: 0,
      rushes: 0,
      rushTicks: 0,
      flowSum: 0,
      flowPeak: config.openingFlow,
    },
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
    tetherSaves: config.tetherSaves,
    ghostline: config.ghostline === null ? null : canonicalGhostline(config.ghostline),
  })
}

function canonicalGhostline(ghostline: Ghostline): Readonly<Ghostline> {
  return Object.freeze({
    step: ghostline.step,
    path: Object.freeze([...ghostline.path]),
    x: Object.freeze([...ghostline.x]),
    tick: Object.freeze([...ghostline.tick]),
  })
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/** Advances the leg by one tick. Returns a new state and never mutates `state`. */
export function step(state: State, input: Input): State {
  assertInput(input)
  if (state.finished) return state
  const s: Draft = { ...state, metrics: { ...state.metrics }, tick: state.tick + 1, events: 0, nudge: input.nudge }
  if (s.motion === 'falling') advanceFall(s)
  else if (s.motion === 'tethering') advanceTether(s)
  else ride(s, input, state)
  updateGhost(s)
  updateRush(s, state.flow)
  settleFlow(s)
  finishTick(s)
  return s
}

function assertInput(input: Input): void {
  const shiftOk = input.shift === -1 || input.shift === 0 || input.shift === 1
  const nudgeOk = Number.isInteger(input.nudge) && input.nudge >= -NUDGE_RANGE && input.nudge <= NUDGE_RANGE
  const actionOk = input.action === 0 || input.action === ACTION_JUMP || input.action === ACTION_SLIDE
  if (!shiftOk || !nudgeOk || !actionOk) throw new RangeError('Invalid relay leg input')
}

/** Rules below can start a fall mid-tick; a falling courier meets nothing else this tick. */
const isFalling = (s: Draft): boolean => s.motion === 'falling'

/** One tick on the deck: steering, air, speed, progress, then everything the courier meets. */
function ride(s: Draft, input: Input, previous: State): void {
  const fromDist = previous.dist
  countDownTimers(s)
  const here = laneLayoutAt(s.track, fromDist, s.path)
  // A grinding courier's shift is its answer to the rail, never also a lane change.
  if (s.motion === 'grinding') resolveGrind(s, input, here)
  else applyShift(s, input.shift, here)
  if (isFalling(s)) return
  resolveAction(s, input.action)
  const wind = windOffset(s, fromDist)
  moveLaterally(s, here, wind, previous.x)
  if (isFalling(s)) return
  acquireLane(s, here, wind)
  const landedAfter = integrateVertical(s)
  const onPad = boostPadActive(s, fromDist, here)
  updateSpeed(s, onPad, here)
  advance(s)
  leaveFork(s, fromDist)
  enterFork(s, fromDist)
  triggerEvents(s)
  const there = laneLayoutAt(s.track, s.dist, s.path)
  resolveLanding(s, landedAfter, there)
  if (isFalling(s)) return
  launchFromRamps(s, fromDist, there)
  crossGaps(s, fromDist, there)
  if (isFalling(s)) return
  crossHazards(s, there)
  crossEvents(s, fromDist, there)
  crossGates(s, there)
  updateRail(s, previous.railing, there)
  rewardBoostPad(s, onPad)
}
