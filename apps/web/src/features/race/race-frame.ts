import { relayLeg } from '@nim-relay/game-engine'
import { TICK_MS, type RenderSnapshot } from './controller'

/**
 * The race clock as it is on screen this frame, for systems that follow the race
 * in real time (music sync, ambience, live progress). The scene reuses one object
 * per mount, so copy any field that must outlive the callback.
 */
export interface RaceFrame {
  /** Race tick on screen. Negative through the opening, counting up to 0 at the start. */
  tick: number
  /** 0..1 progress from `tick` towards the next tick. */
  alpha: number
  /** The clock is advancing: the opening count-in or the race. False while paused and after the finish. */
  running: boolean
  /** 0..1 */
  flow: number
  /** Forward speed on screen, 0 at stumble speed or standing still, 1 at the engine's top speed. */
  speed01: number
  /** The courier is grinding a rail. */
  railing: boolean
  /** Route position of the simulation state behind this frame (Q16.16 metres), with its finish and the path it is on. */
  dist: number
  finishDist: number
  path: relayLeg.Path
  /** Seconds the ghost is ahead at the courier's position, negative when the courier leads; null without a ghost. */
  ghostDelta: number | null
}

const Q = 65536
const STUMBLE_MPS = (relayLeg.STUMBLE_SPEED / Q) * relayLeg.TICK_RATE
const TOP_MPS = ((relayLeg.BASE_SPEED + relayLeg.FLOW_SPEED + relayLeg.RAIL_SPEED + relayLeg.PAD_SPEED) / Q) * relayLeg.TICK_RATE

export function createRaceFrame(): RaceFrame {
  return { tick: 0, alpha: 0, running: false, flow: 0, speed01: 0, railing: false, dist: 0, finishDist: 0, path: 'main', ghostDelta: null }
}

/** Maps metres per second onto the engine's stumble..top speed range. */
export function normalizedSpeed(metresPerSecond: number): number {
  return Math.max(0, Math.min(1, (metresPerSecond - STUMBLE_MPS) / (TOP_MPS - STUMBLE_MPS)))
}

/** `speedMps` is the courier's on-screen forward speed, which glides to rest after the finish. */
export function writeRaceFrame(out: RaceFrame, snapshot: RenderSnapshot, speedMps: number): RaceFrame {
  const paused = snapshot.phase === 'paused'
  const phase = snapshot.activePhase
  const { state, previous } = snapshot
  if (phase === 'arrival' || phase === 'catch') {
    const clock = (snapshot.openingElapsedMs - snapshot.openingMs - snapshot.catchMs) / TICK_MS
    const tick = Math.floor(clock)
    out.tick = tick
    out.alpha = clock - tick
  } else {
    out.tick = state.tick
    out.alpha = phase === 'racing' ? snapshot.alpha : 0
  }
  const alpha = phase === 'racing' ? snapshot.alpha : 1
  out.running = !paused && phase !== 'finished'
  out.flow = (previous.flow + (state.flow - previous.flow) * alpha) / Q
  out.speed01 = paused ? 0 : normalizedSpeed(speedMps)
  out.railing = !paused && phase === 'racing' && state.railing === 1
  out.dist = state.dist
  out.finishDist = state.track.finishDist
  out.path = state.path
  out.ghostDelta = snapshot.ghostDelta
  return out
}
