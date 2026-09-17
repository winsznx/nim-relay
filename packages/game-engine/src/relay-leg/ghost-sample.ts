import { ONE } from '../fixed-point'
import { GHOSTLINE_STEP } from './constants'
import { pathFromCode } from './geometry'
import { MAX_TICKS, type Ghostline, type Path } from './types'

/** Longest ghostline accepted: 4 km of samples. */
export const MAX_GHOSTLINE_SAMPLES = 1001
/** Ghost lateral positions stay within 20 m of their path's centre line. */
export const MAX_GHOST_X_CENTIMETRES = 2000

export interface GhostSample {
  /** Lateral position, Q16.16 m from the centre line of `path`. */
  x: number
  path: Path
  /** Tick at which the ghost passed the distance (interpolated). */
  tick: number
}

/** True when `value` is a structurally valid ghostline. Never throws. */
export function isValidGhostline(value: unknown): value is Ghostline {
  if (value === null || typeof value !== 'object') return false
  const { step, path, x, tick } = value as Record<string, unknown>
  if (step !== GHOSTLINE_STEP || !Array.isArray(path) || !Array.isArray(x) || !Array.isArray(tick)) return false
  const length = path.length
  if (length === 0 || length > MAX_GHOSTLINE_SAMPLES || x.length !== length || tick.length !== length) return false
  let previousTick = 0
  for (let i = 0; i < length; i++) {
    const code: unknown = path[i]
    const lateral: unknown = x[i]
    const at: unknown = tick[i]
    if (code !== 0 && code !== 1 && code !== 2) return false
    if (!Number.isSafeInteger(lateral) || Math.abs(lateral as number) > MAX_GHOST_X_CENTIMETRES) return false
    if (!Number.isSafeInteger(at) || (at as number) < previousTick || (at as number) > MAX_TICKS) return false
    previousTick = at as number
  }
  return true
}

/**
 * Tick at which the ghost passed route distance `dist`, interpolated between samples and
 * extrapolated for up to one step past the last sample; -1 beyond that.
 */
export function ghostTickAt(ghostline: Readonly<Ghostline>, dist: number): number {
  const index = sampleIndex(ghostline, dist)
  if (index < 0) return -1
  const ticks = ghostline.tick
  const within = Math.max(dist, 0) - index * ghostline.step
  if (index + 1 < ticks.length) return ticks[index]! + Math.trunc((ticks[index + 1]! - ticks[index]!) * within / ghostline.step)
  const interval = index > 0 ? ticks[index]! - ticks[index - 1]! : 0
  return ticks[index]! + Math.trunc(interval * within / ghostline.step)
}

/** Ghost lateral position (Q16.16 m) at `dist`, interpolated while both samples share a path. */
export function ghostXAt(ghostline: Readonly<Ghostline>, dist: number): number {
  const index = sampleIndex(ghostline, dist)
  if (index < 0) return 0
  const x = ghostline.x
  const here = x[index]!
  const within = Math.max(dist, 0) - index * ghostline.step
  const blended = index + 1 < x.length && ghostline.path[index + 1] === ghostline.path[index]
    ? here * ghostline.step + (x[index + 1]! - here) * within
    : here * ghostline.step
  return Math.trunc(blended * ONE / (100 * ghostline.step))
}

export function ghostPathCodeAt(ghostline: Readonly<Ghostline>, dist: number): 0 | 1 | 2 | -1 {
  const index = sampleIndex(ghostline, dist)
  return index < 0 ? -1 : ghostline.path[index]!
}

/** Ghost position and passing tick at route distance `dist`, or null past the end of its line. */
export function ghostlineAt(ghostline: Readonly<Ghostline>, dist: number): GhostSample | null {
  const code = ghostPathCodeAt(ghostline, dist)
  if (code < 0) return null
  return { x: ghostXAt(ghostline, dist), path: pathFromCode(code as 0 | 1 | 2), tick: ghostTickAt(ghostline, dist) }
}

function sampleIndex(ghostline: Readonly<Ghostline>, dist: number): number {
  const index = Math.trunc(Math.max(dist, 0) / ghostline.step)
  return index < ghostline.tick.length ? index : -1
}

/** Centimetres, truncated toward zero, for ghostline samples. */
export function toCentimetres(value: number): number {
  return Math.trunc(value * 100 / ONE)
}
