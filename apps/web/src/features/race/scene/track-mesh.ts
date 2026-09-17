import * as THREE from 'three'
import type { SceneMaterials } from './materials'
import { MeshBuilder } from './mesh-builder'
import type { Route } from './route'
import { CURB_HEIGHT, DECK_THICKNESS, TrackEdges, edgeOverhang } from './track-edges'
import {
  buildBoostPads,
  buildGapWarnings,
  buildPulseLights,
  buildRails,
  buildRamps,
  type FeatureContext,
} from './track-features'
import { buildForkMarkings, buildGateGuides, buildLaneMarkings, buildLaneTransitions } from './track-markings'
import { pathIntervals, spanBands, spansAt, topologyBreaks, type PathInterval, type Span } from './track-spans'
import type { TrackStyle } from './track-style'

/**
 * Streams the route ribbon in chunks: merged geometry per material, built ahead
 * of the courier and disposed behind it. A chunk is at most four draw calls.
 */

const CHUNK_LENGTH = 40
const BEHIND = 70
const BUILDS_PER_FRAME = 2
const EPSILON = 0.002
/** Shoulders repeat the deck's seam pattern this many times more densely, which reads as a rumble strip. */
const RUMBLE_REPEAT = 8

interface Chunk {
  index: number
  group: THREE.Group
  geometries: THREE.BufferGeometry[]
}

export class TrackStreamer {
  readonly group = new THREE.Group()
  private readonly chunks = new Map<number, Chunk>()
  private readonly builders = { deck: new MeshBuilder(), glow: new MeshBuilder(), boost: new MeshBuilder(), pulse: new MeshBuilder() }
  private readonly edges: TrackEdges
  private readonly lowestGround: number
  private readonly corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const

  constructor(
    private readonly route: Route,
    private readonly materials: SceneMaterials,
    private readonly style: TrackStyle,
    private stripLength: number,
    private drawDistance: number,
  ) {
    this.group.name = 'track'
    this.edges = new TrackEdges(route, style, this.builders.deck, this.builders.glow)
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
    this.buildSteps(from, to)
    const context: FeatureContext = { route: this.route, from, to, deck, glow, boost, pulse, style: this.style }
    buildLaneMarkings(context)
    buildLaneTransitions(context)
    buildGateGuides(context)
    buildForkMarkings(context)
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
    const route = this.route
    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c]!
      const b = cuts[c + 1]!
      if (b - a < 1e-4) continue
      const startIntervals = pathIntervals(route, a + EPSILON)
      const endIntervals = pathIntervals(route, b - EPSILON)
      const startSpans = spansAt(route, a + EPSILON, startIntervals)
      const endSpans = spansAt(route, b - EPSILON, endIntervals)
      if (startSpans.length !== endSpans.length) continue
      for (let s = 0; s < startSpans.length; s++) {
        const sa = startSpans[s]!
        const sb = endSpans[s]!
        this.deckStrip(a, b, sa, sb, startIntervals, endIntervals)
        const lerp = (from: number, to: number) => (d: number): number => from + ((to - from) * (d - a)) / (b - a)
        this.edges.side(a, b, lerp(sa.left, sb.left), -1, sa.leftKind)
        this.edges.side(a, b, lerp(sa.right, sb.right), 1, sa.rightKind)
      }
      if (c === 0 && from <= route.minDist + EPSILON) this.endCap(a, startSpans, 1)
      if (c + 2 === cuts.length && to >= route.maxDist - EPSILON) this.endCap(b, endSpans, -1)
    }
  }

  private at(i: 0 | 1 | 2 | 3, d: number, lateral: number, height: number): THREE.Vector3 {
    return this.route.point(d, lateral, height, this.corner[i])
  }

  private deckStrip(a: number, b: number, sa: Span, sb: Span, ia: readonly PathInterval[], ib: readonly PathInterval[]): void {
    const { deck } = this.builders
    const va = a / 6
    const vb = b / 6
    const bandsA = spanBands(sa, ia)
    const bandsB = spanBands(sb, ib)
    if (bandsA.length === bandsB.length) {
      for (let i = 0; i < bandsA.length; i++) {
        const ba = bandsA[i]!
        const bb = bandsB[i]!
        const reference = ba.right - ba.left >= bb.right - bb.left ? ba : bb
        const corners = [this.at(0, a, ba.left, 0), this.at(1, a, ba.right, 0), this.at(2, b, bb.right, 0), this.at(3, b, bb.left, 0)] as const
        if (reference.kind === 'lane') {
          const u0 = ((ba.left - reference.origin) / reference.laneWidth) * 0.5
          const u1 = ((ba.right - reference.origin) / reference.laneWidth) * 0.5
          deck.quad(corners[0], corners[1], corners[2], corners[3], this.style.deck, [u0, va, u1, vb])
        } else {
          deck.quad(corners[0], corners[1], corners[2], corners[3], this.style.shoulder, [0.25, va * RUMBLE_REPEAT, 0.25, vb * RUMBLE_REPEAT])
        }
      }
    } else {
      deck.quad(this.at(0, a, sa.left, 0), this.at(1, a, sa.right, 0), this.at(2, b, sb.right, 0), this.at(3, b, sb.left, 0), this.style.deck, [0.25, va, 0.25, vb])
    }
    const leftA = sa.left - edgeOverhang(sa.leftKind)
    const leftB = sb.left - edgeOverhang(sb.leftKind)
    const rightA = sa.right + edgeOverhang(sa.rightKind)
    const rightB = sb.right + edgeOverhang(sb.rightKind)
    deck.quad(
      this.at(0, a, leftA, -DECK_THICKNESS), this.at(1, b, leftB, -DECK_THICKNESS),
      this.at(2, b, rightB, -DECK_THICKNESS), this.at(3, a, rightA, -DECK_THICKNESS), this.style.underside, [0.5, 0.5, 0.5, 0.5],
    )
  }

  /** Where the main road changes width at a segment boundary, the edges step and their builds wrap the corner. */
  private buildSteps(from: number, to: number): void {
    const route = this.route
    for (const segment of route.track.segments) {
      const d = segment.from / 65536
      if (d <= 0 || d < from || d >= to) continue
      if (route.forkAt(d - EPSILON) || route.forkAt(d + EPSILON)) continue
      const before = route.lanes('main', d - EPSILON)
      const after = route.lanes('main', d + EPSILON)
      const halfBefore = (before.count * before.width) / 2 + before.shoulder
      const halfAfter = (after.count * after.width) / 2 + after.shoulder
      const narrowing = halfAfter < halfBefore
      this.edges.step(d, -halfBefore, -halfAfter, -1, narrowing ? before.left : after.left)
      this.edges.step(d, halfBefore, halfAfter, 1, narrowing ? before.right : after.right)
    }
  }

  private endCap(d: number, spans: readonly Span[], facing: 1 | -1): void {
    for (const span of spans) {
      const left = span.left - edgeOverhang(span.leftKind)
      const right = span.right + edgeOverhang(span.rightKind)
      const top = CURB_HEIGHT
      const bottom = -DECK_THICKNESS
      if (facing === 1) {
        this.builders.deck.quad(this.at(0, d, left, top), this.at(1, d, left, bottom), this.at(2, d, right, bottom), this.at(3, d, right, top), this.style.skirt)
      } else {
        this.builders.deck.quad(this.at(0, d, left, bottom), this.at(1, d, left, top), this.at(2, d, right, top), this.at(3, d, right, bottom), this.style.skirt)
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
    const top = -DECK_THICKNESS
    const bottom = -DECK_THICKNESS - 0.7
    const left = span.left + 0.3
    const right = span.right - 0.3
    const deck = this.builders.deck
    for (const [offset, facing] of [[-0.6, -1], [0.6, 1]] as const) {
      const at = d + offset
      if (facing === -1) {
        deck.quad(this.at(0, at, left, top), this.at(1, at, left, bottom), this.at(2, at, right, bottom), this.at(3, at, right, top), this.style.support)
      } else {
        deck.quad(this.at(0, at, left, bottom), this.at(1, at, left, top), this.at(2, at, right, top), this.at(3, at, right, bottom), this.style.support)
      }
    }
    deck.quad(this.at(0, d - 0.6, left, bottom), this.at(1, d + 0.6, left, bottom), this.at(2, d + 0.6, right, bottom), this.at(3, d - 0.6, right, bottom), this.style.support)
  }
}
