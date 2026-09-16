import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'

/**
 * Presentation geometry for a 1-D route.
 *
 * The simulation only knows progress along the route (`dist`), a lateral offset
 * from the active path centre line (`x`) and height above ground (`y`). This
 * module turns those into world space: it integrates the authored bends into a
 * heading, eases elevation kinks, banks into turns and separates the fork's
 * safe and risk paths. Everything the renderer places on the track goes through
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
/** Share of the fork separation taken by the risk path; the shorter swing reads as the shortcut. */
const RISK_SHARE = 0.42

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export class Route {
  readonly track: relayLeg.Track
  /** Start line in metres (always 0). */
  readonly start = 0
  readonly finish: number
  readonly minDist = -ROUTE_LEAD_IN
  readonly maxDist: number
  readonly fork: { from: number; to: number; riskSide: -1 | 1; separation: number; safeHalfWidth: number; riskHalfWidth: number }

  private readonly px: Float32Array
  private readonly py: Float32Array
  private readonly pz: Float32Array
  private readonly heading: Float32Array
  private readonly pitch: Float32Array
  private readonly bank: Float32Array
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly scratch = createRouteFrame()

  constructor(track: relayLeg.Track) {
    this.track = track
    this.finish = fromQ(track.finishDist)
    this.maxDist = this.finish + ROUTE_RUNOUT
    this.fork = {
      from: fromQ(track.fork.from),
      to: fromQ(track.fork.to),
      riskSide: track.fork.riskSide,
      separation: fromQ(track.fork.separation),
      safeHalfWidth: fromQ(track.fork.safeHalfWidth),
      riskHalfWidth: fromQ(track.fork.riskHalfWidth),
    }

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
    const q = d * Q
    const segments = this.track.segments
    let low = 0
    let high = segments.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (segments[mid]!.from <= q) low = mid
      else high = mid - 1
    }
    return segments[low]!
  }

  /** Unsmoothed simulation ground height, metres. */
  rawGround(d: number): number {
    const clamped = Math.max(0, Math.min(this.finish, d))
    const segment = this.segmentAt(clamped)
    const length = segment.to - segment.from
    const t = length > 0 ? (clamped * Q - segment.from) / length : 0
    return fromQ(segment.elevationFrom + (segment.elevationTo - segment.elevationFrom) * Math.max(0, Math.min(1, t)))
  }

  /** How far the fork paths have separated at `d`, 0..1. */
  forkSplit(d: number): number {
    const { from, to } = this.fork
    if (d <= from || d >= to) return 0
    const u = (d - from) / (to - from)
    return smoothstep(0, 0.3, u) * (1 - smoothstep(0.7, 1, u))
  }

  /** Lateral offset of a path's centre line from the main centre line, metres. */
  pathOffset(path: relayLeg.Path, d: number): number {
    if (path === 'main') return 0
    const split = this.forkSplit(d)
    if (split === 0) return 0
    const { riskSide, separation } = this.fork
    return path === 'risk' ? riskSide * separation * RISK_SHARE * split : -riskSide * separation * (1 - RISK_SHARE) * split
  }

  halfWidth(path: relayLeg.Path, d: number): number {
    if (path === 'safe' && d > this.fork.from && d < this.fork.to) return this.fork.safeHalfWidth
    if (path === 'risk' && d > this.fork.from && d < this.fork.to) return this.fork.riskHalfWidth
    if (d < 0) return fromQ(this.track.segments[0]!.halfWidth)
    if (d > this.finish) return fromQ(this.track.segments[this.track.segments.length - 1]!.halfWidth)
    return fromQ(this.segmentAt(d).halfWidth)
  }

  /** Whether the risk and safe decks are far enough apart to be drawn as two ribbons. */
  forkSeparated(d: number): boolean {
    const offset = Math.abs(this.pathOffset('risk', d) - this.pathOffset('safe', d))
    return offset > this.fork.safeHalfWidth + this.fork.riskHalfWidth
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
