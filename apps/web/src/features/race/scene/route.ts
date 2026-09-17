import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'

/**
 * Presentation geometry for a 1-D route.
 *
 * The simulation only knows progress along the route (`dist`), a lateral offset
 * from the active path centre line (`x`), lane slots and height above ground
 * (`y`). This module turns those into world space: it integrates the authored
 * bends into a heading, eases elevation kinks, banks into turns, lays out the
 * lanes, shoulders and edges of every path and separates each fork's safe and
 * risk paths. Everything the renderer places on the track goes through
 * `Route.point`, so the courier, hazards, gates and the ribbon always agree.
 */

export const Q = 65536
export const fromQ = (value: number): number => value / Q

/** Metres of straight approach rendered before the start line (arrival camera). */
export const ROUTE_LEAD_IN = 90
/** Metres rendered past the finish for the handoff platform and ceremony. */
export const ROUTE_RUNOUT = 190
const SAMPLE_SPACING = 1
const ELEVATION_SMOOTHING = 8
const BANK_SMOOTHING = 18
const BANK_PER_BEND = 0.00055
const MAX_BANK = 0.11

export interface RouteFrame {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  heading: number
  pitch: number
  bank: number
}

export function createRouteFrame(): RouteFrame {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    heading: 0,
    pitch: 0,
    bank: 0,
  }
}

/** Lane layout of one path at one route distance, in metres. */
export interface PathLanes {
  count: relayLeg.LaneCount
  width: number
  shoulder: number
  left: relayLeg.EdgeKind
  right: relayLeg.EdgeKind
}

export function createPathLanes(): PathLanes {
  return { count: 1, width: 1, shoulder: 0, left: 'rail', right: 'rail' }
}

interface ForkPathSpec {
  count: relayLeg.LaneCount
  left: relayLeg.EdgeKind
  right: relayLeg.EdgeKind
}

/** A fork in metres. */
export interface RouteFork {
  index: number
  from: number
  to: number
  riskSide: -1 | 1
  separation: number
  label: relayLeg.Fork['label']
  safe: ForkPathSpec
  risk: ForkPathSpec
}

export class Route {
  readonly track: relayLeg.Track
  /** Start line in metres (always 0). */
  readonly start = 0
  readonly finish: number
  readonly minDist = -ROUTE_LEAD_IN
  readonly maxDist: number
  readonly forks: readonly RouteFork[]

  private readonly px: Float32Array
  private readonly py: Float32Array
  private readonly pz: Float32Array
  private readonly heading: Float32Array
  private readonly pitch: Float32Array
  private readonly bank: Float32Array
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly scratch = createRouteFrame()
  private readonly lanesScratch = createPathLanes()

  constructor(track: relayLeg.Track) {
    this.track = track
    this.finish = fromQ(track.finishDist)
    this.maxDist = this.finish + ROUTE_RUNOUT
    this.forks = track.forks.map(fork => ({
      index: fork.index,
      from: fromQ(fork.from),
      to: fromQ(fork.to),
      riskSide: fork.riskSide,
      separation: fromQ(fork.separation),
      label: fork.label,
      safe: { count: fork.safeLanes, left: fork.safeEdges.left, right: fork.safeEdges.right },
      risk: { count: fork.riskLanes, left: fork.riskEdges.left, right: fork.riskEdges.right },
    }))

    const count = Math.ceil((this.maxDist - this.minDist) / SAMPLE_SPACING) + 1
    const rawElevation = new Float32Array(count)
    const bend = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const d = this.minDist + i * SAMPLE_SPACING
      rawElevation[i] = this.rawGround(d)
      const segment = this.segmentAt(d)
      bend[i] = d < 0 || d > this.finish ? 0 : segment.bend
    }

    this.py = boxBlur(rawElevation, ELEVATION_SMOOTHING)
    const smoothBend = boxBlur(bend, BANK_SMOOTHING)
    this.px = new Float32Array(count)
    this.pz = new Float32Array(count)
    this.heading = new Float32Array(count)
    this.pitch = new Float32Array(count)
    this.bank = new Float32Array(count)

    let heading = 0
    let x = 0
    let z = 0
    const startIndex = Math.round(-this.minDist / SAMPLE_SPACING)
    for (let i = startIndex; i < count; i++) {
      this.heading[i] = heading
      this.px[i] = x
      this.pz[i] = z
      heading += bend[i]! * 1e-5 * SAMPLE_SPACING
      x += Math.sin(heading) * SAMPLE_SPACING
      z -= Math.cos(heading) * SAMPLE_SPACING
    }
    for (let i = startIndex - 1; i >= 0; i--) {
      this.heading[i] = 0
      this.px[i] = 0
      this.pz[i] = this.pz[i + 1]! + SAMPLE_SPACING
    }
    for (let i = 0; i < count; i++) {
      const ahead = this.py[Math.min(count - 1, i + 1)]!
      const behind = this.py[Math.max(0, i - 1)]!
      const span = (Math.min(count - 1, i + 1) - Math.max(0, i - 1)) * SAMPLE_SPACING
      this.pitch[i] = Math.atan2(ahead - behind, span)
      this.bank[i] = -Math.max(-MAX_BANK, Math.min(MAX_BANK, smoothBend[i]! * BANK_PER_BEND))
    }
  }

  segmentAt(d: number): relayLeg.Segment {
    return relayLeg.segmentAt(this.track, Math.round(Math.max(0, Math.min(this.finish, d)) * Q))
  }

  /** Unsmoothed simulation ground height, metres. */
  rawGround(d: number): number {
    const clamped = Math.max(0, Math.min(this.finish, d))
    const segment = this.segmentAt(clamped)
    const length = segment.to - segment.from
    const t = length > 0 ? (clamped * Q - segment.from) / length : 0
    return fromQ(segment.elevationFrom + (segment.elevationTo - segment.elevationFrom) * Math.max(0, Math.min(1, t)))
  }

  /** The fork whose span contains `d`, or null on the main road. */
  forkAt(d: number): RouteFork | null {
    const fork = relayLeg.forkAt(this.track, Math.round(d * Q))
    return fork ? this.forks[fork.index] ?? null : null
  }

  /** The path a courier travelling on `path` physically occupies at `d`. */
  activePath(path: relayLeg.Path, d: number): relayLeg.Path {
    return relayLeg.activePathAt(this.track, Math.round(d * Q), path)
  }

  /** Lateral offset of a path's centre line from the main centre line, metres. Lane-aligned where a fork splits and rejoins. */
  pathOffset(path: relayLeg.Path, d: number): number {
    return path === 'main' ? 0 : fromQ(relayLeg.pathOffsetAt(this.track, Math.round(d * Q), path))
  }

  /** Lanes, shoulders and edge kinds of `path` at `d`. Pass `out` from per-frame code. */
  lanes(path: relayLeg.Path, d: number, out: PathLanes = createPathLanes()): PathLanes {
    const segment = this.segmentAt(d)
    out.width = fromQ(segment.laneWidth)
    out.shoulder = fromQ(segment.shoulder)
    const fork = path === 'main' ? null : this.forkAt(d)
    if (fork && path !== 'main') {
      const spec = fork[path]
      out.count = spec.count
      out.left = spec.left
      out.right = spec.right
    } else {
      out.count = segment.laneCount
      out.left = segment.leftEdge
      out.right = segment.rightEdge
    }
    return out
  }

  /** Distance from a path's centre line to its edge line (lanes plus shoulder), metres. */
  halfWidth(path: relayLeg.Path, d: number): number {
    const lanes = this.lanes(path, d, this.lanesScratch)
    return (lanes.count * lanes.width) / 2 + lanes.shoulder
  }

  /** Half of the paved lane area of a path, without shoulders, metres. */
  laneSpan(path: relayLeg.Path, d: number): number {
    const lanes = this.lanes(path, d, this.lanesScratch)
    return (lanes.count * lanes.width) / 2
  }

  /** Lateral position of a lane slot's centre from the main centre line, metres. */
  slotLateral(path: relayLeg.Path, slot: number, d: number): number {
    const lanes = this.lanes(path, d, this.lanesScratch)
    return this.pathOffset(path, d) + fromQ(relayLeg.laneCenterX(slot, Math.round(lanes.width * Q)))
  }

  /** Whether a fork's decks are far enough apart at `d` to be drawn as two ribbons. */
  forkSeparated(fork: RouteFork, d: number): boolean {
    const offset = Math.abs(this.pathOffset('risk', d) - this.pathOffset('safe', d))
    return offset > this.halfWidth('safe', d) + this.halfWidth('risk', d)
  }

  /** Whether a fork's lane areas have parted at `d`, leaving deck between them. */
  forkLanesParted(fork: RouteFork, d: number): boolean {
    const offset = Math.abs(this.pathOffset('risk', d) - this.pathOffset('safe', d))
    return offset > this.laneSpan('safe', d) + this.laneSpan('risk', d)
  }

  frame(d: number, out: RouteFrame): RouteFrame {
    const position = (Math.max(this.minDist, Math.min(this.maxDist, d)) - this.minDist) / SAMPLE_SPACING
    const index = Math.min(this.px.length - 2, Math.floor(position))
    const t = position - index
    const lerp = (values: Float32Array): number => values[index]! + (values[index + 1]! - values[index]!) * t
    out.position.set(lerp(this.px), lerp(this.py), lerp(this.pz))
    out.heading = lerp(this.heading)
    out.pitch = lerp(this.pitch)
    out.bank = lerp(this.bank)
    this.euler.set(out.pitch, -out.heading, out.bank, 'YXZ')
    out.quaternion.setFromEuler(this.euler)
    out.forward.set(0, 0, -1).applyQuaternion(out.quaternion)
    out.right.set(1, 0, 0).applyQuaternion(out.quaternion)
    out.up.set(0, 1, 0).applyQuaternion(out.quaternion)
    return out
  }

  /** World position at route distance `d`, lateral offset from the main centre line, height above the deck. */
  point(d: number, lateral: number, height: number, out: THREE.Vector3): THREE.Vector3 {
    const frame = this.frame(d, this.scratch)
    return out
      .copy(frame.position)
      .addScaledVector(frame.right, lateral)
      .addScaledVector(frame.up, height)
  }

  /** Ground-plane point ignoring bank and pitch, for world props placed beside the route. */
  flatPoint(d: number, lateral: number, out: THREE.Vector3): THREE.Vector3 {
    const frame = this.frame(d, this.scratch)
    const heading = frame.heading
    return out.set(frame.position.x + Math.cos(heading) * lateral, frame.position.y, frame.position.z + Math.sin(heading) * lateral)
  }

  headingAt(d: number): number {
    return this.frame(d, this.scratch).heading
  }
}

function boxBlur(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length)
  let sum = 0
  let count = 0
  let low = 0
  let high = -1
  for (let i = 0; i < values.length; i++) {
    const wantLow = Math.max(0, i - radius)
    const wantHigh = Math.min(values.length - 1, i + radius)
    while (high < wantHigh) {
      high++
      sum += values[high]!
      count++
    }
    while (low < wantLow) {
      sum -= values[low]!
      count--
      low++
    }
    out[i] = sum / count
  }
  return out
}
