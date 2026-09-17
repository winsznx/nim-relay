import { EDGE_OVERSHOOT, LANE_WIDTH, SHOULDER_LINE } from './constants'
import type { Checkpoint, EdgeKind, Fork, LaneCount, Path, Segment, Track } from './types'

/**
 * Pure road geometry shared by the simulation, renderers, bots and the Worker.
 * Lateral positions are Q16.16 metres from the active path's centre line.
 */

export interface LaneLayout {
  count: LaneCount
  /** Lane width, Q16.16 m. */
  width: number
  /** Shoulder width outside the outer lanes, Q16.16 m. */
  shoulder: number
  leftEdge: EdgeKind
  rightEdge: EdgeKind
  /** Distance from the centre line to the road edge: `count * width / 2 + shoulder`. */
  halfWidth: number
}

const LANE_SLOTS: Readonly<Record<LaneCount, readonly number[]>> = {
  1: Object.freeze([0]),
  2: Object.freeze([-1, 1]),
  3: Object.freeze([-2, 0, 2]),
  4: Object.freeze([-3, -1, 1, 3]),
}

const PATH_CODES: Readonly<Record<Path, 0 | 1 | 2>> = { main: 0, safe: 1, risk: 2 }
const CODE_PATHS: readonly Path[] = ['main', 'safe', 'risk']

export const pathCode = (path: Path): 0 | 1 | 2 => PATH_CODES[path]
export const pathFromCode = (code: 0 | 1 | 2): Path => CODE_PATHS[code]!

/** Lane slots of a path with `count` lanes, left to right, in half-lane units. */
export function laneSlots(count: LaneCount): readonly number[] {
  return LANE_SLOTS[count]
}

/** Centre of lane `slot` (Q16.16 m). */
export function laneCenterX(slot: number, laneWidth: number = LANE_WIDTH): number {
  return Math.trunc(slot * laneWidth / 2)
}

export function isLaneSlot(count: LaneCount, slot: number): boolean {
  return Number.isInteger(slot) && Math.abs(slot) <= count - 1 && (slot + count - 1) % 2 === 0
}

/** Distance from the centre line to the outer edge of the outer lanes (Q16.16 m). */
export function laneEdgeOf(layout: Readonly<LaneLayout>): number {
  return Math.trunc(layout.count * layout.width / 2)
}

/**
 * Where the courier steers for a target slot. Real lanes steer to their centre.
 * Slot `±count` is shoulder mode (just outside the outer lane) and `±(count + 1)`
 * steers past the road edge, which is what shifting outward from the shoulder does.
 */
export function slotTargetX(layout: Readonly<LaneLayout>, slot: number): number {
  const reach = Math.abs(slot)
  if (reach <= layout.count - 1) return laneCenterX(slot, layout.width)
  const side = slot < 0 ? -1 : 1
  if (reach === layout.count) return side * (laneEdgeOf(layout) + SHOULDER_LINE)
  return side * (layout.halfWidth + EDGE_OVERSHOOT)
}

/** The real lane nearest `x`; ties go to the lane nearer the centre line. */
export function nearestLane(count: LaneCount, width: number, x: number): number {
  const slots = LANE_SLOTS[count]
  let best = slots[0]!
  let bestDistance = Math.abs(x - laneCenterX(best, width))
  for (let i = 1; i < slots.length; i++) {
    const slot = slots[i]!
    const distance = Math.abs(x - laneCenterX(slot, width))
    if (distance < bestDistance || (distance === bestDistance && Math.abs(slot) < Math.abs(best))) {
      best = slot
      bestDistance = distance
    }
  }
  return best
}

export function edgeOnSide(layout: Readonly<LaneLayout>, side: -1 | 1): EdgeKind {
  return side < 0 ? layout.leftEdge : layout.rightEdge
}

// ---------------------------------------------------------------------------
// Track queries
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

/** The fork whose span contains `dist`, or null. */
export function forkAt(track: Readonly<Track>, dist: number): Fork | null {
  const forks = track.forks
  for (let i = 0; i < forks.length; i++) {
    const fork = forks[i]!
    if (dist < fork.from) return null
    if (dist < fork.to) return fork
  }
  return null
}

/** The physical path a courier travelling on `plannedPath` occupies at `dist`. */
export function activePathAt(track: Readonly<Track>, dist: number, plannedPath: Path): Path {
  return forkAt(track, dist) ? plannedPath : 'main'
}

export function laneLayoutAt(track: Readonly<Track>, dist: number, path: Path): LaneLayout {
  const segment = segmentAt(track, dist)
  const fork = path === 'main' ? null : forkAt(track, dist)
  if (!fork) return layoutOf(segment.laneCount, segment, segment.leftEdge, segment.rightEdge)
  const edges = path === 'safe' ? fork.safeEdges : fork.riskEdges
  return layoutOf(path === 'safe' ? fork.safeLanes : fork.riskLanes, segment, edges.left, edges.right)
}

function layoutOf(count: LaneCount, segment: Segment, leftEdge: EdgeKind, rightEdge: EdgeKind): LaneLayout {
  return {
    count,
    width: segment.laneWidth,
    shoulder: segment.shoulder,
    leftEdge,
    rightEdge,
    halfWidth: Math.trunc(count * segment.laneWidth / 2) + segment.shoulder,
  }
}

/** Half-width of `path` at `dist` from the centre line to the road edge (Q16.16 m). */
export function halfWidthAt(track: Readonly<Track>, dist: number, path: Path): number {
  return laneLayoutAt(track, dist, path).halfWidth
}

// ---------------------------------------------------------------------------
// Forks
// ---------------------------------------------------------------------------

/** Side a fork path peels off toward: the risk path to `riskSide`, the safe path away from it. */
export function forkPathSide(fork: Readonly<Fork>, path: 'safe' | 'risk'): -1 | 1 {
  return path === 'risk' ? fork.riskSide : fork.riskSide === 1 ? -1 : 1
}

/** Main lanes where the fork splits (`at = 'split'`) or rejoins (`at = 'rejoin'`). */
export function mainLanesAtFork(track: Readonly<Track>, fork: Readonly<Fork>, at: 'split' | 'rejoin'): LaneCount {
  return segmentAt(track, at === 'split' ? fork.from - 1 : fork.to).laneCount
}

/**
 * Offset, in half-lane units, of a fork path's centre line from the main centre line
 * where `mainLanes` meet it. The main lanes on the risk side of centre become the risk
 * path's inner lanes and the rest the safe path's, so lanes line up across the split:
 * a main slot `s` continues as path slot `s - offset`.
 */
export function forkOffsetSlots(fork: Readonly<Fork>, mainLanes: LaneCount, path: 'safe' | 'risk'): number {
  const odd = mainLanes % 2 === 1
  if (path === 'risk') return fork.riskSide * ((odd ? 2 : 1) + fork.riskLanes - 1)
  return -fork.riskSide * ((odd ? 0 : 1) + fork.safeLanes - 1)
}

/** Path chosen at a fork's split by the lane nearest the courier. */
export function forkPathFor(fork: Readonly<Fork>, mainLanes: LaneCount, laneWidth: number, x: number): 'safe' | 'risk' {
  return nearestLane(mainLanes, laneWidth, x) * fork.riskSide > 0 ? 'risk' : 'safe'
}

/** Presentation share of the fork separation each path swings out by. */
const RISK_SWING_PERCENT = 42

/**
 * Presentation: lateral offset (Q16.16 m) of `path`'s centre line from the main centre line
 * at `dist`. It equals the lane-aligned offsets at the split and the rejoin, so a courier's
 * `x + pathOffsetAt(...)` is continuous across both, and swings the paths apart in between.
 */
export function pathOffsetAt(track: Readonly<Track>, dist: number, path: Path): number {
  const fork = path === 'main' ? null : forkAt(track, dist)
  if (!fork || path === 'main') return 0
  const width = segmentAt(track, fork.from).laneWidth
  const split = Math.trunc(forkOffsetSlots(fork, mainLanesAtFork(track, fork, 'split'), path) * width / 2)
  const rejoin = Math.trunc(forkOffsetSlots(fork, mainLanesAtFork(track, fork, 'rejoin'), path) * width / 2)
  const span = fork.to - fork.from
  const along = dist - fork.from
  const share = path === 'risk' ? RISK_SWING_PERCENT : 100 - RISK_SWING_PERCENT
  const peak = forkPathSide(fork, path) * Math.trunc(fork.separation * share / 100)
  const swing = Math.trunc(Math.trunc(peak * along / span) * 4 * (span - along) / span)
  return split + Math.trunc((rejoin - split) * along / span) + swing
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/**
 * The respawn point for a courier that fell at `dist` on `path`: the last checkpoint at or
 * behind `dist` that the courier can reach from there. Main checkpoints always qualify; a
 * fork path checkpoint only inside the same fork on the same path.
 */
export function checkpointBefore(track: Readonly<Track>, dist: number, path: Path): Checkpoint {
  const fork = path === 'main' ? null : forkAt(track, dist)
  const checkpoints = track.checkpoints
  let found = checkpoints[0]!
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i]!
    if (checkpoint.dist > dist) break
    const reachable = checkpoint.path === 'main'
      || (fork !== null && checkpoint.path === path && checkpoint.dist >= fork.from)
    if (reachable) found = checkpoint
  }
  return found
}
