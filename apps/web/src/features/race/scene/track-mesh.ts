import * as THREE from 'three'
import type { SceneMaterials } from './materials'
import { MeshBuilder } from './mesh-builder'
import type { Route } from './route'
import {
  buildBoostPads,
  buildGapWarnings,
  buildLaneLines,
  buildPulseLights,
  buildRacingLine,
  buildRails,
  buildRamps,
  type FeatureContext,
} from './track-features'
import { spansAt, topologyBreaks, type Span } from './track-spans'
import type { TrackStyle } from './track-style'

/**
 * Streams the route ribbon in chunks: merged geometry per material, built ahead
 * of the courier and disposed behind it. A chunk is at most four draw calls.
 */

const CHUNK_LENGTH = 40
const BEHIND = 70
const BUILDS_PER_FRAME = 2
const DECK_THICKNESS = 0.55
const CURB_WIDTH = 0.26
const CURB_HEIGHT = 0.09
const STUD_SPACING = 5
const EPSILON = 0.002
/** Guard rail along open edges: top bar height, bar depth, half thickness, lateral inset on the curb and post spacing. */
const RAIL_TOP = 0.74
const RAIL_BAR = 0.08
const RAIL_HALF = 0.032
const RAIL_INSET = 0.15
const POST_SPACING = 3
const POST_HALF = 0.028
const CURB_LIGHT = 0.45
const RAIL_LIGHT = 0.8

interface Chunk {
  index: number
  group: THREE.Group
  geometries: THREE.BufferGeometry[]
}

export class TrackStreamer {
  readonly group = new THREE.Group()
  private readonly chunks = new Map<number, Chunk>()
  private readonly builders = { deck: new MeshBuilder(), glow: new MeshBuilder(), boost: new MeshBuilder(), pulse: new MeshBuilder() }
  private readonly lowestGround: number
  private readonly curbLight: THREE.Color
  private readonly railLight: THREE.Color

  constructor(
    private readonly route: Route,
    private readonly materials: SceneMaterials,
    private readonly style: TrackStyle,
    private stripLength: number,
    private drawDistance: number,
  ) {
    this.group.name = 'track'
    this.curbLight = style.edgeLight.clone().multiplyScalar(CURB_LIGHT)
    this.railLight = style.edgeLight.clone().multiplyScalar(RAIL_LIGHT)
    let lowest = Number.POSITIVE_INFINITY
    const probe = new THREE.Vector3()
    for (let d = route.minDist; d <= route.maxDist; d += 10) lowest = Math.min(lowest, route.point(d, 0, 0, probe).y)
    this.lowestGround = lowest
  }

  get floorY(): number {
    return this.lowestGround - this.style.floorDepth
  }

  setQuality(stripLength: number, drawDistance: number): void {
    this.drawDistance = drawDistance
    if (stripLength === this.stripLength) return
    this.stripLength = stripLength
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk)
    this.chunks.clear()
  }

  /** Ensures chunks cover the view around `dist`. `immediate` builds everything needed now. */
  update(dist: number, immediate = false): void {
    const first = this.indexOf(dist - BEHIND)
    const last = this.indexOf(Math.min(this.route.maxDist, dist + this.drawDistance))
    for (const [index, chunk] of this.chunks) {
      if (index < first || index > last + 1) {
        this.disposeChunk(chunk)
        this.chunks.delete(index)
      }
    }
    let budget = immediate ? Number.POSITIVE_INFINITY : BUILDS_PER_FRAME
    for (let index = this.indexOf(dist); index <= last && budget > 0; index++) {
      if (this.chunks.has(index)) continue
      this.chunks.set(index, this.buildChunk(index))
      budget--
    }
    for (let index = this.indexOf(dist) - 1; index >= first && budget > 0; index--) {
      if (this.chunks.has(index)) continue
      this.chunks.set(index, this.buildChunk(index))
      budget--
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk)
    this.chunks.clear()
    this.group.removeFromParent()
  }

  private indexOf(d: number): number {
    return Math.floor((Math.max(this.route.minDist, d) - this.route.minDist) / CHUNK_LENGTH)
  }

  private disposeChunk(chunk: Chunk): void {
    chunk.group.removeFromParent()
    for (const geometry of chunk.geometries) geometry.dispose()
  }

  private buildChunk(index: number): Chunk {
    const from = this.route.minDist + index * CHUNK_LENGTH
    const to = Math.min(this.route.maxDist, from + CHUNK_LENGTH)
    const { deck, glow, boost, pulse } = this.builders
    for (const builder of [deck, glow, boost, pulse]) builder.clear()

    this.buildDeck(from, to)
    const context: FeatureContext = { route: this.route, from, to, deck, glow, boost, pulse, style: this.style }
    buildLaneLines(context)
    buildRacingLine(context)
    buildRamps(context)
    buildRails(context)
    buildBoostPads(context)
    buildGapWarnings(context)
    buildPulseLights(context)
    this.buildSupports(from, to)

    const group = new THREE.Group()
    group.name = `track-chunk-${index}`
    const geometries: THREE.BufferGeometry[] = []
    const add = (builder: MeshBuilder, material: THREE.Material, receiveShadow: boolean): void => {
      if (builder.vertexCount === 0) return
      const geometry = builder.build()
      geometries.push(geometry)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.receiveShadow = receiveShadow
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    add(deck, this.materials.deck, true)
    add(glow, this.materials.glow, false)
    add(boost, this.materials.boost, false)
    add(pulse, this.materials.pulse, false)
    this.group.add(group)
    return { index, group, geometries }
  }

  private cuts(from: number, to: number): number[] {
    const values = new Set<number>()
    const count = Math.max(1, Math.ceil((to - from) / this.stripLength))
    for (let i = 0; i <= count; i++) values.add(from + ((to - from) * i) / count)
    for (const d of topologyBreaks(this.route, from, to)) values.add(d)
    return [...values].sort((a, b) => a - b)
  }

  private buildDeck(from: number, to: number): void {
    const cuts = this.cuts(from, to)
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
    const route = this.route
    const at = (i: 0 | 1 | 2 | 3, d: number, lateral: number, height: number): THREE.Vector3 => route.point(d, lateral, height, p[i])

    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c]!
      const b = cuts[c + 1]!
      if (b - a < 1e-4) continue
      const startSpans = spansAt(route, a + EPSILON)
      const endSpans = spansAt(route, b - EPSILON)
      if (startSpans.length !== endSpans.length) continue
      for (let s = 0; s < startSpans.length; s++) {
        const sa = startSpans[s]!
        const sb = endSpans[s]!
        this.deckStrip(a, b, sa, sb, at)
        this.edges(a, b, sa, sb, at)
        this.studs(a, b, sa, sb)
      }
      if (c === 0 && from <= route.minDist + EPSILON) this.endCap(a, startSpans, 1)
      if (c + 2 === cuts.length && to >= route.maxDist - EPSILON) this.endCap(b, endSpans, -1)
    }
  }

  private deckStrip(
    a: number,
    b: number,
    sa: Span,
    sb: Span,
    at: (i: 0 | 1 | 2 | 3, d: number, lateral: number, height: number) => THREE.Vector3,
  ): void {
    const { deck } = this.builders
    const { shoulder, deck: deckColor, underside } = this.style
    const va = a / 6
    const vb = b / 6
    const band = (la: number, ra: number, lb: number, rb: number, color: THREE.Color): void => {
      deck.quad(at(0, a, la, 0), at(1, a, ra, 0), at(2, b, rb, 0), at(3, b, lb, 0), color, [la / 3, va, ra / 3, vb])
    }
    const inset = 0.42
    const leftInset = sa.leftKind === 'edge' ? inset : 0
    const rightInset = sa.rightKind === 'edge' ? inset : 0
    if (leftInset > 0) band(sa.left, sa.left + leftInset, sb.left, sb.left + leftInset, shoulder)
    band(sa.left + leftInset, sa.right - rightInset, sb.left + leftInset, sb.right - rightInset, deckColor)
    if (rightInset > 0) band(sa.right - rightInset, sa.right, sb.right - rightInset, sb.right, shoulder)

    const leftOuter = sa.leftKind === 'edge' ? CURB_WIDTH : 0
    const rightOuter = sa.rightKind === 'edge' ? CURB_WIDTH : 0
    deck.quad(
      at(0, a, sa.left - leftOuter, -DECK_THICKNESS), at(1, b, sb.left - leftOuter, -DECK_THICKNESS),
      at(2, b, sb.right + rightOuter, -DECK_THICKNESS), at(3, a, sa.right + rightOuter, -DECK_THICKNESS), underside, [0.5, 0.5, 0.5, 0.5],
    )
  }

  private edges(
    a: number,
    b: number,
    sa: Span,
    sb: Span,
    at: (i: 0 | 1 | 2 | 3, d: number, lateral: number, height: number) => THREE.Vector3,
  ): void {
    const { deck, glow } = this.builders
    const { skirt, curb } = this.style
    const flat: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 0.5]
    for (const side of [-1, 1] as const) {
      const kind = side === -1 ? sa.leftKind : sa.rightKind
      const ea = side === -1 ? sa.left : sa.right
      const eb = side === -1 ? sb.left : sb.right
      const out = kind === 'edge' ? CURB_WIDTH * side : 0
      const top = kind === 'edge' ? CURB_HEIGHT : 0
      if (kind === 'edge') {
        const innerA = ea
        const innerB = eb
        const outerA = ea + out
        const outerB = eb + out
        const lowA = side === -1 ? outerA : innerA
        const highA = side === -1 ? innerA : outerA
        const lowB = side === -1 ? outerB : innerB
        const highB = side === -1 ? innerB : outerB
        deck.quad(at(0, a, lowA, top), at(1, a, highA, top), at(2, b, highB, top), at(3, b, lowB, top), curb, flat)
        this.verticalFace(a, b, innerA, innerB, 0, top, -side as -1 | 1, curb, at)
        const lightInner = side * 0.12
        const lightOuter = side * 0.2
        const la = side === -1 ? ea + lightOuter : ea + lightInner
        const ra = side === -1 ? ea + lightInner : ea + lightOuter
        const lb = side === -1 ? eb + lightOuter : eb + lightInner
        const rb = side === -1 ? eb + lightInner : eb + lightOuter
        glow.quad(at(0, a, la, top + 0.004), at(1, a, ra, top + 0.004), at(2, b, rb, top + 0.004), at(3, b, lb, top + 0.004), this.curbLight)
        this.guardRail(a, b, ea + side * RAIL_INSET, eb + side * RAIL_INSET, side, at)
      }
      this.verticalFace(a, b, ea + out, eb + out, -DECK_THICKNESS, top, side, skirt, at)
    }
  }

  /** Top bar with a light line on its inner face, and posts, along one open edge between a and b. */
  private guardRail(
    a: number,
    b: number,
    centreA: number,
    centreB: number,
    side: -1 | 1,
    at: (i: 0 | 1 | 2 | 3, d: number, lateral: number, height: number) => THREE.Vector3,
  ): void {
    const { deck, glow } = this.builders
    const metal = this.style.curb
    const bottom = RAIL_TOP - RAIL_BAR
    deck.quad(at(0, a, centreA - RAIL_HALF, RAIL_TOP), at(1, a, centreA + RAIL_HALF, RAIL_TOP), at(2, b, centreB + RAIL_HALF, RAIL_TOP), at(3, b, centreB - RAIL_HALF, RAIL_TOP), metal)
    this.verticalFace(a, b, centreA - side * RAIL_HALF, centreB - side * RAIL_HALF, bottom, RAIL_TOP, -side as -1 | 1, metal, at)
    this.verticalFace(a, b, centreA + side * RAIL_HALF, centreB + side * RAIL_HALF, bottom, RAIL_TOP, side, metal, at)
    this.verticalFace(a, b, centreA - side * (RAIL_HALF + 0.004), centreB - side * (RAIL_HALF + 0.004), bottom + 0.022, bottom + 0.05, -side as -1 | 1, this.railLight, at, glow)

    const first = Math.ceil(a / POST_SPACING) * POST_SPACING
    for (let d = first; d < b; d += POST_SPACING) {
      const t = (d - a) / (b - a)
      const centre = centreA + (centreB - centreA) * t
      for (const facing of [-1, 1] as const) {
        this.verticalFace(d - POST_HALF, d + POST_HALF, centre + facing * POST_HALF, centre + facing * POST_HALF, 0, bottom, facing, metal, at)
        const at0 = d + facing * POST_HALF
        if (facing === -1) {
          deck.quad(at(0, at0, centre - POST_HALF, bottom), at(1, at0, centre - POST_HALF, 0), at(2, at0, centre + POST_HALF, 0), at(3, at0, centre + POST_HALF, bottom), metal)
        } else {
          deck.quad(at(0, at0, centre - POST_HALF, 0), at(1, at0, centre - POST_HALF, bottom), at(2, at0, centre + POST_HALF, bottom), at(3, at0, centre + POST_HALF, 0), metal)
        }
      }
    }
  }

  private verticalFace(
    a: number,
    b: number,
    lateralA: number,
    lateralB: number,
    bottom: number,
    top: number,
    facing: -1 | 1,
    color: THREE.Color,
    at: (i: 0 | 1 | 2 | 3, d: number, lateral: number, height: number) => THREE.Vector3,
    builder: MeshBuilder = this.builders.deck,
  ): void {
    const flat: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 0.5]
    if (facing === -1) {
      builder.quad(at(0, a, lateralA, bottom), at(1, a, lateralA, top), at(2, b, lateralB, top), at(3, b, lateralB, bottom), color, flat)
    } else {
      builder.quad(at(0, a, lateralA, bottom), at(1, b, lateralB, bottom), at(2, b, lateralB, top), at(3, a, lateralA, top), color, flat)
    }
  }

  /** Bright light studs on the inner curb faces, the strobe that sells speed. */
  private studs(a: number, b: number, sa: Span, sb: Span): void {
    const first = Math.ceil(a / STUD_SPACING) * STUD_SPACING
    if (first >= b) return
    const route = this.route
    const t = (first - a) / (b - a)
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
    for (const side of [-1, 1] as const) {
      if ((side === -1 ? sa.leftKind : sa.rightKind) !== 'edge') continue
      const edge = side === -1 ? sa.left + (sb.left - sa.left) * t : sa.right + (sb.right - sa.right) * t
      const lateral = edge - side * 0.004
      const length = 0.9
      if (side === -1) {
        this.builders.glow.quad(
          route.point(first, lateral, 0.02, p[0]), route.point(first + length, lateral, 0.02, p[1]),
          route.point(first + length, lateral, 0.075, p[2]), route.point(first, lateral, 0.075, p[3]), this.style.edgeStud,
        )
      } else {
        this.builders.glow.quad(
          route.point(first, lateral, 0.02, p[0]), route.point(first, lateral, 0.075, p[1]),
          route.point(first + length, lateral, 0.075, p[2]), route.point(first + length, lateral, 0.02, p[3]), this.style.edgeStud,
        )
      }
    }
  }

  private endCap(d: number, spans: readonly Span[], facing: 1 | -1): void {
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
    for (const span of spans) {
      const left = span.left - CURB_WIDTH
      const right = span.right + CURB_WIDTH
      const top = CURB_HEIGHT
      const bottom = -DECK_THICKNESS
      if (facing === 1) {
        this.builders.deck.quad(
          this.route.point(d, left, top, p[0]), this.route.point(d, left, bottom, p[1]),
          this.route.point(d, right, bottom, p[2]), this.route.point(d, right, top, p[3]), this.style.skirt,
        )
      } else {
        this.builders.deck.quad(
          this.route.point(d, left, bottom, p[0]), this.route.point(d, left, top, p[1]),
          this.route.point(d, right, top, p[2]), this.route.point(d, right, bottom, p[3]), this.style.skirt,
        )
      }
    }
  }

  private buildSupports(from: number, to: number): void {
    const spacing = this.style.supportSpacing
    const first = Math.ceil(from / spacing) * spacing
    const floor = this.floorY
    const route = this.route
    const top = new THREE.Vector3()
    for (let d = first; d < to; d += spacing) {
      if (d < route.minDist + 6 || d > route.maxDist - 6) continue
      for (const span of spansAt(route, d)) {
        const centre = (span.left + span.right) / 2
        route.point(d, centre, -DECK_THICKNESS, top)
        if (top.y - floor < 2) continue
        this.column(top, floor, route.headingAt(d), Math.min(1.1, (span.right - span.left) * 0.14))
        this.capBeam(d, span)
      }
    }
  }

  private column(top: THREE.Vector3, floor: number, heading: number, halfWidth: number): void {
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    const corners = (half: number, y: number): THREE.Vector3[] => {
      const along = half * 0.7
      return [
        [-half, -along],
        [half, -along],
        [half, along],
        [-half, along],
      ].map(([lx, lz]) => new THREE.Vector3(top.x + cos * lx! - sin * lz!, y, top.z + sin * lx! + cos * lz!))
    }
    const upper = corners(halfWidth, top.y)
    const lower = corners(halfWidth * 1.9, floor)
    const color = this.style.support
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      this.builders.deck.quad(lower[j]!, lower[i]!, upper[i]!, upper[j]!, color, [0.5, 0.5, 0.5, 0.5])
    }
  }

  private capBeam(d: number, span: Span): void {
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
    const route = this.route
    const top = -DECK_THICKNESS
    const bottom = -DECK_THICKNESS - 0.7
    const left = span.left + 0.3
    const right = span.right - 0.3
    for (const [offset, facing] of [[-0.6, -1], [0.6, 1]] as const) {
      const at = d + offset
      if (facing === -1) {
        this.builders.deck.quad(route.point(at, left, top, p[0]), route.point(at, left, bottom, p[1]), route.point(at, right, bottom, p[2]), route.point(at, right, top, p[3]), this.style.support)
      } else {
        this.builders.deck.quad(route.point(at, left, bottom, p[0]), route.point(at, left, top, p[1]), route.point(at, right, top, p[2]), route.point(at, right, bottom, p[3]), this.style.support)
      }
    }
    this.builders.deck.quad(
      route.point(d - 0.6, left, bottom, p[0]), route.point(d + 0.6, left, bottom, p[1]),
      route.point(d + 0.6, right, bottom, p[2]), route.point(d - 0.6, right, bottom, p[3]), this.style.support,
    )
  }
}
