import * as THREE from 'three'
import type { MeshBuilder } from './mesh-builder'
import type { Route } from './route'
import { Points, stripes, transverse, wall, type Lateral } from './track-geometry'
import type { SideKind } from './track-spans'
import { DANGER, type TrackStyle } from './track-style'

/**
 * The three edges a courier can meet, each with its own unmistakable build:
 *
 * rail  a curb, a guard rail with a bright scrape line, warm studs
 * open  no rail at all, a red and white lip, red studs and a sheer drop
 * wall  a concrete barrier wall with a cool light strip
 *
 * The edge line itself is where the simulation's edge is; everything here sits
 * on or outside it.
 */

export const DECK_THICKNESS = 0.55
export const CURB_WIDTH = 0.26
export const CURB_HEIGHT = 0.09
const RAIL_INSET = 0.14
const RAIL_PLATE_BOTTOM = 0.42
const RAIL_PLATE_TOP = 0.8
const RAIL_PLATE_HALF = 0.035
const POST_SPACING = 2
const POST_HALF = 0.04
const STUD_SPACING = 5
const LIP_WIDTH = 0.34
const LIP_SKIRT = 0.1
const WALL_HEIGHT = 1.15
const WALL_THICKNESS = 0.32
const WALL_LIGHT = 0.92
const LIP_LIGHT = new THREE.Color(0.95, 0.9, 0.84)

/** Horizontal room an edge build takes outside the edge line. */
export function edgeOverhang(kind: SideKind): number {
  if (kind === 'rail') return CURB_WIDTH
  if (kind === 'wall') return WALL_THICKNESS
  return 0
}

export class TrackEdges {
  private readonly points: Points
  private readonly curbLight: THREE.Color
  private readonly scrape: THREE.Color
  private readonly railPlate: THREE.Color
  private readonly post: THREE.Color
  private readonly wallFace: THREE.Color
  private readonly wallLight: THREE.Color
  private readonly dropFade: THREE.Color

  constructor(
    route: Route,
    private readonly style: TrackStyle,
    private readonly deck: MeshBuilder,
    private readonly glow: MeshBuilder,
  ) {
    this.points = new Points(route)
    this.curbLight = style.edgeLight.clone().multiplyScalar(0.45)
    this.scrape = style.edgeLight.clone().multiplyScalar(1.05)
    this.railPlate = style.curb.clone().multiplyScalar(1.15)
    this.post = style.support.clone().lerp(style.curb, 0.4)
    this.wallFace = style.curb.clone().lerp(style.shoulder, 0.55)
    this.wallLight = style.edgeLight.clone().multiplyScalar(0.7)
    this.dropFade = style.underside.clone().multiplyScalar(0.35)
  }

  /** Everything along one side of a deck strip from `a` to `b`. `edge` gives the edge line's lateral position. */
  side(a: number, b: number, edge: Lateral, side: -1 | 1, kind: SideKind): void {
    switch (kind) {
      case 'rail':
        this.railEdge(a, b, edge, side)
        break
      case 'open':
        this.openEdge(a, b, edge, side)
        break
      case 'wall':
        this.wallEdge(a, b, edge, side)
        break
      case 'gap':
        wall(this.deck, this.points, a, b, edge, -DECK_THICKNESS, 0, side, this.style.skirt)
        break
    }
    this.studs(a, b, edge, side, kind)
  }

  private railEdge(a: number, b: number, edge: Lateral, side: -1 | 1): void {
    const { deck, glow, points, style } = this
    const outer: Lateral = d => edge(d) + side * CURB_WIDTH
    const low = side === -1 ? outer : edge
    const high = side === -1 ? edge : outer
    deck.quad(points.at(a, low(a), CURB_HEIGHT), points.at(a, high(a), CURB_HEIGHT), points.at(b, high(b), CURB_HEIGHT), points.at(b, low(b), CURB_HEIGHT), style.curb)
    wall(deck, points, a, b, edge, 0, CURB_HEIGHT, -side as -1 | 1, style.curb)
    wall(deck, points, a, b, outer, -DECK_THICKNESS, CURB_HEIGHT, side, style.skirt)
    const lightInner: Lateral = d => edge(d) + side * 0.12
    const lightOuter: Lateral = d => edge(d) + side * 0.2
    const lightLow = side === -1 ? lightOuter : lightInner
    const lightHigh = side === -1 ? lightInner : lightOuter
    glow.quad(
      points.at(a, lightLow(a), CURB_HEIGHT + 0.004), points.at(a, lightHigh(a), CURB_HEIGHT + 0.004),
      points.at(b, lightHigh(b), CURB_HEIGHT + 0.004), points.at(b, lightLow(b), CURB_HEIGHT + 0.004), this.curbLight,
    )
    this.guardRail(a, b, d => edge(d) + side * RAIL_INSET, side)
  }

  /** A pressed-steel plate facing the road, a bright scrape line along its top, posts behind it. */
  private guardRail(a: number, b: number, centre: Lateral, side: -1 | 1): void {
    const { deck, glow, points } = this
    const inner: Lateral = d => centre(d) - side * RAIL_PLATE_HALF
    const outer: Lateral = d => centre(d) + side * RAIL_PLATE_HALF
    wall(deck, points, a, b, inner, RAIL_PLATE_BOTTOM, RAIL_PLATE_TOP, -side as -1 | 1, this.railPlate)
    wall(deck, points, a, b, outer, RAIL_PLATE_BOTTOM, RAIL_PLATE_TOP, side, this.post)
    const topLow = side === -1 ? outer : inner
    const topHigh = side === -1 ? inner : outer
    deck.quad(points.at(a, topLow(a), RAIL_PLATE_TOP), points.at(a, topHigh(a), RAIL_PLATE_TOP), points.at(b, topHigh(b), RAIL_PLATE_TOP), points.at(b, topLow(b), RAIL_PLATE_TOP), this.railPlate)
    const face: Lateral = d => inner(d) - side * 0.004
    wall(glow, points, a, b, face, RAIL_PLATE_TOP - 0.05, RAIL_PLATE_TOP - 0.012, -side as -1 | 1, this.scrape)
    wall(glow, points, a, b, face, RAIL_PLATE_BOTTOM + 0.1, RAIL_PLATE_BOTTOM + 0.125, -side as -1 | 1, this.curbLight)
    for (let d = Math.ceil(a / POST_SPACING) * POST_SPACING; d < b; d += POST_SPACING) {
      const c = centre(d) + side * (RAIL_PLATE_HALF + POST_HALF)
      transverse(deck, points, d - POST_HALF, c - POST_HALF, c + POST_HALF, 0, RAIL_PLATE_TOP - 0.02, -1, this.post)
      transverse(deck, points, d + POST_HALF, c - POST_HALF, c + POST_HALF, 0, RAIL_PLATE_TOP - 0.02, 1, this.post)
      wall(deck, points, d - POST_HALF, d + POST_HALF, () => c + side * POST_HALF, 0, RAIL_PLATE_TOP - 0.02, side, this.post)
    }
  }

  /** No rail: a striped lip on the shoulder's last metre, a lit edge line and a skirt that fades into the drop. */
  private openEdge(a: number, b: number, edge: Lateral, side: -1 | 1): void {
    const { deck, glow, points, style } = this
    const inner: Lateral = d => edge(d) - side * LIP_WIDTH
    const low = side === -1 ? edge : inner
    const high = side === -1 ? inner : edge
    stripes(glow, points, a, b, low, high, 0.012, LIP_LIGHT, DANGER.body, 1.1, 0.5 * side)
    const line: Lateral = d => edge(d) - side * 0.05
    const lineLow = side === -1 ? edge : line
    const lineHigh = side === -1 ? line : edge
    glow.quad(
      points.at(a, lineLow(a), 0.016), points.at(a, lineHigh(a), 0.016),
      points.at(b, lineHigh(b), 0.016), points.at(b, lineLow(b), 0.016), DANGER.red,
    )
    wall(glow, points, a, b, d => edge(d) + side * 0.002, -LIP_SKIRT, 0.012, side, DANGER.soft)
    wall(deck, points, a, b, edge, -DECK_THICKNESS - 0.6, -LIP_SKIRT, side, this.dropFade, style.skirt)
  }

  private wallEdge(a: number, b: number, edge: Lateral, side: -1 | 1): void {
    const { deck, glow, points, style } = this
    const outer: Lateral = d => edge(d) + side * WALL_THICKNESS
    wall(deck, points, a, b, edge, 0, WALL_HEIGHT, -side as -1 | 1, this.wallFace)
    wall(deck, points, a, b, outer, -DECK_THICKNESS, WALL_HEIGHT, side, style.skirt)
    const low = side === -1 ? outer : edge
    const high = side === -1 ? edge : outer
    deck.quad(points.at(a, low(a), WALL_HEIGHT), points.at(a, high(a), WALL_HEIGHT), points.at(b, high(b), WALL_HEIGHT), points.at(b, low(b), WALL_HEIGHT), style.curb)
    wall(glow, points, a, b, d => edge(d) - side * 0.004, WALL_LIGHT, WALL_LIGHT + 0.05, -side as -1 | 1, this.wallLight)
  }

  /** Light studs strobing past at speed: warm on rails, red on open drops, none on walls. */
  private studs(a: number, b: number, edge: Lateral, side: -1 | 1, kind: SideKind): void {
    if (kind !== 'rail' && kind !== 'open') return
    const { glow, points } = this
    const length = 0.9
    for (let d = Math.ceil(a / STUD_SPACING) * STUD_SPACING; d < b; d += STUD_SPACING) {
      const end = Math.min(b, d + length)
      if (kind === 'rail') {
        const lateral = edge(d) - side * 0.004
        if (side === -1) {
          glow.quad(points.at(d, lateral, 0.02), points.at(end, lateral, 0.02), points.at(end, lateral, 0.075), points.at(d, lateral, 0.075), this.style.edgeStud)
        } else {
          glow.quad(points.at(d, lateral, 0.02), points.at(d, lateral, 0.075), points.at(end, lateral, 0.075), points.at(end, lateral, 0.02), this.style.edgeStud)
        }
        continue
      }
      const inner = edge(d) - side * (LIP_WIDTH + 0.16)
      const outer = edge(d) - side * (LIP_WIDTH + 0.02)
      const low = Math.min(inner, outer)
      const high = Math.max(inner, outer)
      glow.quad(points.at(d, low, 0.02), points.at(d, high, 0.02), points.at(end, high, 0.02), points.at(end, low, 0.02), DANGER.red)
    }
  }

  /**
   * The edge stepping in or out where a segment changes lane count or shoulder
   * width at `d`. `before` and `after` are the edge's lateral positions on each
   * side of the step; the wider side's edge build wraps across the step.
   */
  step(d: number, before: number, after: number, side: -1 | 1, kind: SideKind): void {
    if (Math.abs(before - after) < 0.01) return
    const { deck, glow, points, style } = this
    const narrowing = Math.abs(after) < Math.abs(before)
    const inner = side === -1 ? Math.max(before, after) : Math.min(before, after)
    const outer = side === -1 ? Math.min(before, after) : Math.max(before, after)
    const left = Math.min(inner, outer)
    const right = Math.max(inner, outer)
    const facing: -1 | 1 = narrowing ? 1 : -1
    const overhang = edgeOverhang(kind) * side
    transverse(deck, points, d, Math.min(left, left + overhang), Math.max(right, right + overhang), -DECK_THICKNESS, 0, facing, style.skirt)
    const at = d - facing * 0.02
    if (kind === 'rail') {
      transverse(deck, points, at - facing * 0.25, left, right, RAIL_PLATE_BOTTOM, RAIL_PLATE_TOP, facing === 1 ? -1 : 1, this.railPlate)
      transverse(glow, points, at - facing * 0.26, left, right, RAIL_PLATE_TOP - 0.05, RAIL_PLATE_TOP - 0.012, facing === 1 ? -1 : 1, this.scrape)
    } else if (kind === 'wall') {
      transverse(deck, points, at - facing * 0.2, left, right, 0, WALL_HEIGHT, facing === 1 ? -1 : 1, this.wallFace)
    } else if (kind === 'open') {
      const near = narrowing ? d - LIP_WIDTH : d
      const far = narrowing ? d : d + LIP_WIDTH
      glow.quad(points.at(near, left, 0.014), points.at(near, right, 0.014), points.at(far, right, 0.014), points.at(far, left, 0.014), DANGER.red)
    }
  }
}
