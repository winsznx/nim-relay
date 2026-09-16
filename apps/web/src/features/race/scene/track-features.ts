import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { MeshBuilder } from './mesh-builder'
import { fromQ, type Route } from './route'
import { gapHoles, pathIntervals } from './track-spans'
import { DANGER, GOLD, type TrackStyle } from './track-style'

/**
 * Gameplay features drawn onto the deck: ramps, rail channels, boost pads, gap
 * warnings, pulse lights, lane lines and the gold racing line. Every lateral
 * position goes through `Route.point` with the simulation's own zone data, so
 * what the courier collides with is exactly what is drawn.
 */

export const RAMP_HEIGHT = 0.95
export const RAIL_HEIGHT = 0.14
/** Visual lift of a courier locked into a rail channel. */
export const RAIL_RIDE_LIFT = 0.22
const LIFT = 0.025
const RACING_LINE = new THREE.Color(1.1, 0.56, 0.09)
const RAIL_CHANNEL = new THREE.Color(0.1, 0.05, 0.01)
const STRIP = 1.25
const RACING_LINE_SPACING = 3

/** Height of the ramp surface under a lateral position, 0 when off the ramp. Used to lift couriers visually. */
export function rampSurfaceHeight(route: Route, d: number, lateral: number, path: relayLeg.Path): number {
  const q = d * 65536
  for (const ramp of route.track.ramps) {
    if (ramp.from > q) break
    if (q >= ramp.to) continue
    if (ramp.path !== path && ramp.path !== 'main') continue
    const centre = route.pathOffset(ramp.path, d) + fromQ(ramp.x)
    if (Math.abs(lateral - centre) > fromQ(ramp.half)) continue
    return rampProfile((q - ramp.from) / (ramp.to - ramp.from))
  }
  return 0
}

function rampProfile(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return RAMP_HEIGHT * (0.2 * clamped + 0.8 * clamped * clamped)
}

/** Scratch vectors so building a chunk allocates only its output arrays. */
class Points {
  private readonly pool = Array.from({ length: 12 }, () => new THREE.Vector3())
  private cursor = 0
  constructor(private readonly route: Route) {}
  at(d: number, lateral: number, height: number): THREE.Vector3 {
    const point = this.pool[this.cursor]!
    this.cursor = (this.cursor + 1) % this.pool.length
    return this.route.point(d, lateral, height, point)
  }
}

export interface FeatureContext {
  route: Route
  from: number
  to: number
  deck: MeshBuilder
  glow: MeshBuilder
  boost: MeshBuilder
  pulse: MeshBuilder
  style: TrackStyle
}

function overlaps(zoneFrom: number, zoneTo: number, from: number, to: number): boolean {
  return zoneTo > from && zoneFrom < to
}

function strips(from: number, to: number, step: number): number[] {
  const count = Math.max(1, Math.ceil((to - from) / step))
  return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count)
}

/** Flat quad on the deck between distances a..b and laterals l..r (lateral may vary with d via callbacks). */
function deckQuad(
  builder: MeshBuilder,
  points: Points,
  a: number,
  b: number,
  left: (d: number) => number,
  right: (d: number) => number,
  lift: number,
  color: THREE.Color,
  uv: readonly [number, number, number, number] = [0, 0, 1, 1],
): void {
  builder.quad(points.at(a, left(a), lift), points.at(a, right(a), lift), points.at(b, right(b), lift), points.at(b, left(b), lift), color, uv)
}

/**
 * Vertical wall along the route at a lateral line, from `bottom` to `top`.
 * `facing` -1 faces towards negative lateral (left), 1 towards positive.
 */
function wall(
  builder: MeshBuilder,
  points: Points,
  a: number,
  b: number,
  lateral: (d: number) => number,
  bottom: number,
  top: number,
  facing: -1 | 1,
  color: THREE.Color,
): void {
  if (facing === -1) {
    builder.quad(points.at(a, lateral(a), bottom), points.at(a, lateral(a), top), points.at(b, lateral(b), top), points.at(b, lateral(b), bottom), color)
  } else {
    builder.quad(points.at(a, lateral(a), bottom), points.at(b, lateral(b), bottom), points.at(b, lateral(b), top), points.at(a, lateral(a), top), color)
  }
}

/**
 * Vertical face across the route at distance `d`. `facing` 1 faces down the
 * route (forward), -1 faces back towards an approaching courier.
 */
function transverse(
  builder: MeshBuilder,
  points: Points,
  d: number,
  left: number,
  right: number,
  bottom: number,
  top: number,
  facing: -1 | 1,
  color: THREE.Color,
): void {
  if (facing === -1) {
    builder.quad(points.at(d, left, top), points.at(d, left, bottom), points.at(d, right, bottom), points.at(d, right, top), color)
  } else {
    builder.quad(points.at(d, left, bottom), points.at(d, left, top), points.at(d, right, top), points.at(d, right, bottom), color)
  }
}

export function buildRamps(context: FeatureContext): void {
  const { route, from, to, deck, glow, style } = context
  const points = new Points(route)
  const top = style.shoulder.clone().lerp(GOLD.deep, 0.35)
  for (const ramp of route.track.ramps) {
    const rampFrom = fromQ(ramp.from)
    const rampTo = fromQ(ramp.to)
    if (!overlaps(rampFrom, rampTo, from, to) || rampFrom < from) continue
    const centre = (d: number): number => route.pathOffset(ramp.path, d) + fromQ(ramp.x)
    const half = fromQ(ramp.half)
    const pathHalf = route.halfWidth(ramp.path, rampFrom)
    const left = (d: number): number => Math.max(centre(d) - half, route.pathOffset(ramp.path, d) - pathHalf)
    const right = (d: number): number => Math.min(centre(d) + half, route.pathOffset(ramp.path, d) + pathHalf)
    const cuts = strips(rampFrom, rampTo, 0.75)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]!
      const b = cuts[i + 1]!
      const ha = rampProfile((a - rampFrom) / (rampTo - rampFrom))
      const hb = rampProfile((b - rampFrom) / (rampTo - rampFrom))
      deck.quad(points.at(a, left(a), ha), points.at(a, right(a), ha), points.at(b, right(b), hb), points.at(b, left(b), hb), top, [0.5, 0.5, 0.5, 0.5])
      deck.quad(points.at(a, left(a), 0), points.at(a, left(a), ha), points.at(b, left(b), hb), points.at(b, left(b), 0), style.skirt)
      deck.quad(points.at(a, right(a), 0), points.at(b, right(b), 0), points.at(b, right(b), hb), points.at(a, right(a), ha), style.skirt)
      glow.quad(
        points.at(a, left(a) + 0.02, ha + 0.01), points.at(a, left(a) + 0.12, ha + 0.01),
        points.at(b, left(b) + 0.12, hb + 0.01), points.at(b, left(b) + 0.02, hb + 0.01), GOLD.line,
      )
      glow.quad(
        points.at(a, right(a) - 0.12, ha + 0.01), points.at(a, right(a) - 0.02, ha + 0.01),
        points.at(b, right(b) - 0.02, hb + 0.01), points.at(b, right(b) - 0.12, hb + 0.01), GOLD.line,
      )
    }
    const lipLeft = left(rampTo)
    const lipRight = right(rampTo)
    deck.quad(points.at(rampTo, lipLeft, 0), points.at(rampTo, lipLeft, RAMP_HEIGHT), points.at(rampTo, lipRight, RAMP_HEIGHT), points.at(rampTo, lipRight, 0), style.skirt)
    glow.quad(
      points.at(rampTo - 0.22, lipLeft, rampProfile(1 - 0.22 / (rampTo - rampFrom)) + 0.012),
      points.at(rampTo - 0.22, lipRight, rampProfile(1 - 0.22 / (rampTo - rampFrom)) + 0.012),
      points.at(rampTo, lipRight, RAMP_HEIGHT + 0.012),
      points.at(rampTo, lipLeft, RAMP_HEIGHT + 0.012),
      GOLD.bright,
    )
    for (let c = 0; c < 3; c++) {
      const d = rampFrom + (rampTo - rampFrom) * (0.22 + c * 0.24)
      const h = rampProfile((d - rampFrom) / (rampTo - rampFrom)) + 0.015
      const mid = centre(d)
      const width = Math.min(half, pathHalf) * 0.55
      chevron(glow, points, d, mid, width, h, GOLD.line)
    }
  }
}

/** Forward-pointing chevron flat on a surface at height `h`. */
function chevron(builder: MeshBuilder, points: Points, d: number, centre: number, halfSpan: number, h: number, color: THREE.Color, thickness = 0.16): void {
  const depth = halfSpan * 0.45
  builder.quad(
    points.at(d - depth, centre - halfSpan, h), points.at(d, centre, h),
    points.at(d + thickness, centre, h), points.at(d - depth + thickness, centre - halfSpan, h), color,
  )
  builder.quad(
    points.at(d, centre, h), points.at(d - depth, centre + halfSpan, h),
    points.at(d - depth + thickness, centre + halfSpan, h), points.at(d + thickness, centre, h), color,
  )
}

export function buildRails(context: FeatureContext): void {
  const { route, from, to, deck, glow } = context
  const points = new Points(route)
  const railColor = new THREE.Color(0.36, 0.33, 0.3)
  for (const rail of route.track.rails) {
    const railFrom = fromQ(rail.from)
    const railTo = fromQ(rail.to)
    if (!overlaps(railFrom, railTo, from, to)) continue
    const a0 = Math.max(railFrom, from)
    const b0 = Math.min(railTo, to)
    const centre = (d: number): number => route.pathOffset(rail.path, d) + fromQ(rail.x)
    const half = fromQ(rail.half)
    const cuts = strips(a0, b0, STRIP)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]!
      const b = cuts[i + 1]!
      for (const side of [-1, 1] as const) {
        const outer = (d: number): number => centre(d) + side * half
        const inner = (d: number): number => outer(d) - side * 0.09
        const low = side === 1 ? inner : outer
        const high = side === 1 ? outer : inner
        deckQuad(deck, points, a, b, low, high, RAIL_HEIGHT, railColor)
        wall(deck, points, a, b, low, 0, RAIL_HEIGHT, -1, railColor)
        wall(deck, points, a, b, high, 0, RAIL_HEIGHT, 1, railColor)
        const face = side === 1 ? low : high
        wall(glow, points, a, b, d => face(d) - side * 0.006, RAIL_HEIGHT * 0.5, RAIL_HEIGHT * 0.85, -side as -1 | 1, GOLD.line)
      }
      deckQuad(glow, points, a, b, d => centre(d) - half + 0.1, d => centre(d) + half - 0.1, LIFT, RAIL_CHANNEL)
    }
    if (railFrom >= from && railFrom < to) {
      for (let c = 0; c < 2; c++) chevron(glow, points, railFrom + 0.6 + c * 0.9, centre(railFrom), half * 0.6, LIFT + 0.005, GOLD.bright)
    }
  }
}

export function buildBoostPads(context: FeatureContext): void {
  const { route, from, to, boost } = context
  const points = new Points(route)
  for (const pad of route.track.boostPads) {
    const padFrom = fromQ(pad.from)
    const padTo = fromQ(pad.to)
    if (!overlaps(padFrom, padTo, from, to)) continue
    const centre = (d: number): number => route.pathOffset(pad.path, d) + fromQ(pad.x)
    const half = fromQ(pad.half)
    const cuts = strips(Math.max(padFrom, from), Math.min(padTo, to), STRIP)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i]!
      const b = cuts[i + 1]!
      const va = (a - padFrom) / (half * 2)
      const vb = (b - padFrom) / (half * 2)
      deckQuad(boost, points, a, b, d => centre(d) - half, d => centre(d) + half, LIFT, GOLD.line, [0, va, 1, vb])
    }
  }
}

export function buildGapWarnings(context: FeatureContext): void {
  const { route, from, to, deck, glow, style } = context
  const points = new Points(route)
  for (const gap of route.track.gaps) {
    const gapFrom = fromQ(gap.from)
    const gapTo = fromQ(gap.to)
    for (const [edge, facing] of [[gapFrom, 1], [gapTo, -1]] as const) {
      if (edge < from || edge >= to) continue
      const inside = edge + facing * 0.05
      const holes = gapHoles(route, inside, pathIntervals(route, inside))
      for (const hole of holes) {
        transverse(deck, points, edge, hole.left, hole.right, -0.55, 0, facing, style.skirt)
        const band = facing === 1 ? [edge - 1.6, edge] : [edge, edge + 0.9]
        const stripeCount = Math.max(2, Math.round((hole.right - hole.left) / 0.7))
        const width = (hole.right - hole.left) / stripeCount
        for (let s = 0; s < stripeCount; s += 1) {
          const l = hole.left + s * width
          const color = s % 2 === 0 ? DANGER.red : DANGER.stripeDark
          glow.quad(
            points.at(band[0]!, l, LIFT), points.at(band[0]!, l + width * 0.55, LIFT),
            points.at(band[1]!, l + width, LIFT), points.at(band[1]!, l + width * 0.45, LIFT), color,
          )
        }
        transverse(glow, points, edge + facing * 0.004, hole.left, hole.right, -0.16, -0.03, facing, DANGER.red)
      }
    }
  }
}

export function buildPulseLights(context: FeatureContext): void {
  const { route, from, to, pulse } = context
  const pulseFrom = fromQ(route.track.pulse.from)
  const pulseTo = fromQ(route.track.pulse.to)
  if (!overlaps(pulseFrom, pulseTo, from, to)) return
  const points = new Points(route)
  const color = new THREE.Color(2.2, 1.45, 0.62)
  const start = Math.ceil(Math.max(pulseFrom, from) / 6) * 6
  for (let d = start; d < Math.min(pulseTo, to); d += 6) {
    const intervals = pathIntervals(route, d)
    const left = Math.min(...intervals.map(interval => interval.left)) - 0.55
    const right = Math.max(...intervals.map(interval => interval.right)) + 0.55
    for (const lateral of [left, right]) {
      pulse.quad(points.at(d, lateral, 0.05), points.at(d + 0.14, lateral, 0.05), points.at(d + 0.14, lateral, 1.45), points.at(d, lateral, 1.45), color)
      pulse.quad(points.at(d + 0.14, lateral, 0.05), points.at(d, lateral, 0.05), points.at(d, lateral, 1.45), points.at(d + 0.14, lateral, 1.45), color)
    }
    if (d % 18 === 0) {
      for (const interval of intervals) {
        pulse.quad(points.at(d, interval.left + 0.3, LIFT), points.at(d, interval.right - 0.3, LIFT), points.at(d + 0.18, interval.right - 0.3, LIFT), points.at(d + 0.18, interval.left + 0.3, LIFT), color)
      }
    }
  }
}

export function buildLaneLines(context: FeatureContext): void {
  const { route, from, to, glow, style } = context
  const points = new Points(route)
  const start = Math.ceil(from / 6) * 6
  for (let d = start; d < to; d += 6) {
    if (d < route.minDist + 2 || d > route.maxDist - 4) continue
    for (const interval of pathIntervals(route, d)) {
      if (interval.path === 'risk') continue
      const half = (interval.right - interval.left) / 2
      for (const offset of [-half / 3, half / 3]) {
        const lateral = (x: number): number => route.pathOffset(interval.path, x) + offset
        if (holeAt(route, d, lateral(d)) || holeAt(route, d + 2.4, lateral(d + 2.4))) continue
        deckQuad(glow, points, d, d + 2.4, x => lateral(x) - 0.035, x => lateral(x) + 0.035, LIFT, style.laneLight)
      }
    }
  }
}

function holeAt(route: Route, d: number, lateral: number): boolean {
  return gapHoles(route, d, pathIntervals(route, d)).some(hole => lateral >= hole.left && lateral <= hole.right)
}

interface LineGate {
  d: number
  x: number
  path: relayLeg.Path
}

/** Small gold chevrons that connect consecutive gates on each path: the racing line. */
export function buildRacingLine(context: FeatureContext): void {
  const { route, from, to, glow } = context
  const points = new Points(route)
  const gates: LineGate[] = route.track.gates.map(gate => ({ d: fromQ(gate.dist), x: fromQ(gate.x), path: gate.path }))
  for (const plan of ['safe', 'risk'] as const) {
    const sequence = gates.filter(gate => gate.path === 'main' || gate.path === plan)
    for (let i = 1; i < sequence.length; i++) {
      const previous = sequence[i - 1]!
      const next = sequence[i]!
      if (next.d <= from || previous.d >= to) continue
      if (plan === 'risk' && previous.path === 'main' && next.path === 'main') continue
      const length = next.d - previous.d
      if (length > 40) continue
      for (let d = previous.d + 2.6; d < next.d - 1.8; d += RACING_LINE_SPACING) {
        if (d < from || d >= to) continue
        const t = (d - previous.d) / length
        const eased = t * t * (3 - 2 * t)
        const path = d > route.fork.from && d < route.fork.to ? (next.path === 'main' ? previous.path : next.path) : 'main'
        if (path === 'main' && plan === 'risk') continue
        const lateral = route.pathOffset(path, d) + previous.x + (next.x - previous.x) * eased
        if (holeAt(route, d, lateral)) continue
        chevron(glow, points, d, lateral, 0.24, LIFT, RACING_LINE, 0.085)
      }
    }
  }
}

