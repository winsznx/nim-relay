import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { MeshBuilder } from './mesh-builder'
import { fromQ, type Route } from './route'
import { DECK_THICKNESS } from './track-edges'
import { Points, chevron, deckQuad, overlaps, strips, transverse, wall, type Lateral } from './track-geometry'
import { gapHoles, pathIntervals, spansAt, zoneCoversLateral, zoneExtents } from './track-spans'
import { DANGER, GOLD, type TrackStyle } from './track-style'

/**
 * Gameplay zones drawn onto the deck: ramps, grind rails, boost pads, gap
 * warnings and pulse lights. Zones cover lane slots; every lateral position
 * comes from the zone's own lanes through `Route`, so what the courier meets is
 * exactly what is drawn.
 */

export const RAMP_HEIGHT = 0.95
export const RAIL_HEIGHT = 0.14
/** Visual lift of a courier locked into a rail channel. */
export const RAIL_RIDE_LIFT = 0.22
const LIFT = 0.025
const RAIL_CHANNEL = new THREE.Color(0.1, 0.05, 0.01)
const RAIL_METAL = new THREE.Color(0.36, 0.33, 0.3)
const PULSE_POST = new THREE.Color(2.2, 1.45, 0.62)
const STRIP = 1.25

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

/** Height of the ramp surface under a lateral position, 0 when off the ramp. Used to lift couriers visually. */
export function rampSurfaceHeight(route: Route, d: number, lateral: number, path: relayLeg.Path): number {
  const q = d * 65536
  for (const ramp of route.track.ramps) {
    if (ramp.from > q) break
    if (q >= ramp.to) continue
    if (ramp.path !== route.activePath(path, d)) continue
    if (!zoneCoversLateral(route, ramp.path, ramp.lanes, d, lateral)) continue
    return rampProfile((q - ramp.from) / (ramp.to - ramp.from))
  }
  return 0
}

function rampProfile(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return RAMP_HEIGHT * (0.2 * clamped + 0.8 * clamped * clamped)
}

/** Lateral bounds, as functions of distance, of each run of lanes a zone covers. */
function zoneLaterals(route: Route, zone: relayLeg.Zone): { left: Lateral; right: Lateral }[] {
  const d = fromQ(zone.from)
  return zoneExtents(route, zone.path, zone.lanes, d).map((_, run) => ({
    left: (at: number) => zoneExtents(route, zone.path, zone.lanes, at)[run]?.left ?? 0,
    right: (at: number) => zoneExtents(route, zone.path, zone.lanes, at)[run]?.right ?? 0,
  }))
}

export function buildRamps(context: FeatureContext): void {
  const { route, from, to, deck, glow, style } = context
  const points = new Points(route)
  const top = style.shoulder.clone().lerp(GOLD.deep, 0.35)
  for (const ramp of route.track.ramps) {
    const rampFrom = fromQ(ramp.from)
    const rampTo = fromQ(ramp.to)
    if (!overlaps(rampFrom, rampTo, from, to) || rampFrom < from) continue
    for (const { left, right } of zoneLaterals(route, ramp)) {
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
      const lipDepth = 0.22 / (rampTo - rampFrom)
      glow.quad(
        points.at(rampTo - 0.22, lipLeft, rampProfile(1 - lipDepth) + 0.012),
        points.at(rampTo - 0.22, lipRight, rampProfile(1 - lipDepth) + 0.012),
        points.at(rampTo, lipRight, RAMP_HEIGHT + 0.012),
        points.at(rampTo, lipLeft, RAMP_HEIGHT + 0.012),
        GOLD.bright,
      )
      for (let c = 0; c < 3; c++) {
        const d = rampFrom + (rampTo - rampFrom) * (0.22 + c * 0.24)
        const h = rampProfile((d - rampFrom) / (rampTo - rampFrom)) + 0.015
        const width = Math.min(1.6, (right(d) - left(d)) * 0.3)
        chevron(glow, points, d, (left(d) + right(d)) / 2, width, h, GOLD.line)
      }
    }
  }
}

export function buildRails(context: FeatureContext): void {
  const { route, from, to, deck, glow } = context
  const points = new Points(route)
  for (const rail of route.track.rails) {
    const railFrom = fromQ(rail.from)
    const railTo = fromQ(rail.to)
    if (!overlaps(railFrom, railTo, from, to)) continue
    for (const lanes of zoneLaterals(route, rail)) {
      const centre: Lateral = d => (lanes.left(d) + lanes.right(d)) / 2
      const half = Math.min(1.1, (lanes.right(railFrom) - lanes.left(railFrom)) / 2 - 0.35)
      const cuts = strips(Math.max(railFrom, from), Math.min(railTo, to), STRIP)
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i]!
        const b = cuts[i + 1]!
        for (const side of [-1, 1] as const) {
          const outer: Lateral = d => centre(d) + side * half
          const inner: Lateral = d => outer(d) - side * 0.09
          const low = side === 1 ? inner : outer
          const high = side === 1 ? outer : inner
          deckQuad(deck, points, a, b, low, high, RAIL_HEIGHT, RAIL_METAL)
          wall(deck, points, a, b, low, 0, RAIL_HEIGHT, -1, RAIL_METAL)
          wall(deck, points, a, b, high, 0, RAIL_HEIGHT, 1, RAIL_METAL)
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
}

export function buildBoostPads(context: FeatureContext): void {
  const { route, from, to, boost } = context
  const points = new Points(route)
  for (const pad of route.track.boostPads) {
    const padFrom = fromQ(pad.from)
    const padTo = fromQ(pad.to)
    if (!overlaps(padFrom, padTo, from, to)) continue
    for (const lanes of zoneLaterals(route, pad)) {
      const left: Lateral = d => lanes.left(d) + 0.18
      const right: Lateral = d => lanes.right(d) - 0.18
      const width = right(padFrom) - left(padFrom)
      const cuts = strips(Math.max(padFrom, from), Math.min(padTo, to), STRIP)
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i]!
        const b = cuts[i + 1]!
        deckQuad(boost, points, a, b, left, right, LIFT, GOLD.line, [0, (a - padFrom) / width, 1, (b - padFrom) / width])
      }
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
      for (const hole of gapHoles(route, inside, pathIntervals(route, inside))) {
        transverse(deck, points, edge, hole.left, hole.right, -DECK_THICKNESS - 1.4, 0, facing, style.skirt)
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
  const start = Math.ceil(Math.max(pulseFrom, from) / 6) * 6
  for (let d = start; d < Math.min(pulseTo, to); d += 6) {
    const spans = spansAt(route, d)
    if (spans.length === 0) continue
    const left = spans[0]!.left - 0.55
    const right = spans[spans.length - 1]!.right + 0.55
    for (const lateral of [left, right]) {
      pulse.quad(points.at(d, lateral, 0.05), points.at(d + 0.14, lateral, 0.05), points.at(d + 0.14, lateral, 1.45), points.at(d, lateral, 1.45), PULSE_POST)
      pulse.quad(points.at(d + 0.14, lateral, 0.05), points.at(d, lateral, 0.05), points.at(d, lateral, 1.45), points.at(d + 0.14, lateral, 1.45), PULSE_POST)
    }
    if (d % 18 === 0) {
      for (const interval of pathIntervals(route, d)) {
        pulse.quad(points.at(d, interval.laneLeft + 0.3, LIFT), points.at(d, interval.laneRight - 0.3, LIFT), points.at(d + 0.18, interval.laneRight - 0.3, LIFT), points.at(d + 0.18, interval.laneLeft + 0.3, LIFT), PULSE_POST)
      }
    }
  }
}
