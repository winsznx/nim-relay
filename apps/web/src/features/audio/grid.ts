import { relayLeg } from '@nim-relay/game-engine'

/**
 * The race music clock. The engine runs at 60 Hz and its pulse section beats every 25 ticks
 * (144 BPM) from tick 0, so race audio is a pure function of the tick: loop position =
 * tick / 60 seconds, wrapped into the loop. Everything here is plain math on seconds.
 */

export const TICK_SECONDS = 1 / relayLeg.TICK_RATE
export const BEAT_TICKS = relayLeg.PULSE_PERIOD
export const BEAT_SECONDS = BEAT_TICKS * TICK_SECONDS
export const BAR_SECONDS = 4 * BEAT_SECONDS
export const RACE_BPM = 60 / BEAT_SECONDS

/** Music further than this from the race clock is rescheduled. */
export const DRIFT_TOLERANCE_SECONDS = 0.035
/** Consecutive out-of-tolerance frames before a small drift counts; one late frame is not drift. */
export const DRIFT_STRIKES = 3
/** Drift this large (a stalled simulation, a suspended context) is corrected on the first frame. */
export const DRIFT_IMMEDIATE_SECONDS = 4 * DRIFT_TOLERANCE_SECONDS

export function tickToSeconds(tick: number): number {
  return tick * TICK_SECONDS
}

/** Position inside a loop for a race time. Negative times (a count-in) land in the loop's tail. */
export function loopPosition(seconds: number, loopSeconds: number): number {
  const position = seconds % loopSeconds
  return position < 0 ? position + loopSeconds : position
}

/** Wraps a time difference into [-loopSeconds / 2, loopSeconds / 2). */
export function wrapToLoop(seconds: number, loopSeconds: number): number {
  return loopPosition(seconds + loopSeconds / 2, loopSeconds) - loopSeconds / 2
}

export interface ClockReading {
  /** AudioContext.currentTime: the next audio to be rendered. */
  currentTime: number
  /** Seconds between rendering and the speaker when no output timestamp is available. */
  outputLatency: number
  /** AudioContext.getOutputTimestamp(), when the platform provides a usable one. */
  stamp: { contextTime: number; performanceTime: number } | null
}

/**
 * Context time reaching the speakers at `performanceNow` (ms). Scheduling against what is heard,
 * not what is rendered, keeps a beat on screen and the same beat in the ear together even with
 * Bluetooth-sized output latency.
 */
export function heardTime(reading: ClockReading, performanceNow: number): number {
  const { stamp } = reading
  if (stamp && stamp.performanceTime > 0) {
    const extrapolated = stamp.contextTime + (performanceNow - stamp.performanceTime) / 1000
    return Math.min(extrapolated, reading.currentTime)
  }
  return reading.currentTime - reading.outputLatency
}

/** Context time at which tick 0 is (or was) heard, given what is heard now and the tick shown now. */
export function raceAnchor(heard: number, tick: number): number {
  return heard - tickToSeconds(tick)
}

export interface LoopStart {
  when: number
  offset: number
}

/**
 * Where to start a loop so that its position follows `anchor`: at `earliest`, from the loop
 * position the race has reached by then. A future anchor (count-in) starts in the loop's tail and
 * reaches position 0 exactly on tick 0.
 */
export function planLoopStart(anchor: number, earliest: number, loopSeconds: number): LoopStart {
  return { when: earliest, offset: loopPosition(earliest - anchor, loopSeconds) }
}

/** Seconds the playing loop is ahead of the race (negative: behind), wrapped around the loop. */
export function loopDrift(playingAnchor: number, anchor: number, loopSeconds: number): number {
  return wrapToLoop(anchor - playingAnchor, loopSeconds)
}

export interface DriftVerdict {
  resync: boolean
  strikes: number
}

/** Decides whether measured drift warrants rescheduling, counting consecutive strikes. */
export function judgeDrift(drift: number, strikes: number): DriftVerdict {
  const size = Math.abs(drift)
  if (size >= DRIFT_IMMEDIATE_SECONDS) return { resync: true, strikes: 0 }
  if (size <= DRIFT_TOLERANCE_SECONDS) return { resync: false, strikes: 0 }
  const next = strikes + 1
  return next >= DRIFT_STRIKES ? { resync: true, strikes: 0 } : { resync: false, strikes: next }
}
