import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { FeatureContext } from './track-features'
import { Points, chevron, deckQuad, stripes, strips } from './track-geometry'
import { forkParting, gapHoles, pathIntervals, topologyBreaks, type PathInterval } from './track-spans'
import { DANGER, GOLD } from './track-style'
import { fromQ, type Route, type RouteFork } from './route'

/**
 * Road paint that is the lane geometry: solid edge lines where the lanes end
 * and the shoulder begins, dashed dividers between lane slots, gold guides into
 * the lane of the next gate, merge arrows where lane counts change, red hash
 * marks before an edge opens into a drop, and the gold paint of every fork's
 * risk path.
 */

const LIFT = 0.024
const MARK_STEP = 1.5
const EDGE_LINE = 0.13
const EDGE_INSET = 0.07
const DIVIDER = 0.11
const DASH = 3
const DASH_PERIOD = 9
const GUIDE_FROM = 24
const GUIDE_STEP = 6
const CHEVRON_STEP = 5
const RISK_APPROACH = 70
const SAFE_EDGE = new THREE.Color(1.02, 0.96, 0.88)
const SAFE_DIVIDER = new THREE.Color(0.72, 0.68, 0.62)
const RISK_EDGE = new THREE.Color(1.2, 0.64, 0.12)
const RISK_DIVIDER = GOLD.soft
const RISK_CHEVRON = new THREE.Color(1.05, 0.55, 0.09)
const GORE = new THREE.Color(0.75, 0.62, 0.42)
const GUIDE = new THREE.Color(1.2, 0.62, 0.1)

const EPSILON = 0.002

function paint(interval: PathInterval): { edge: THREE.Color; divider: THREE.Color } {
  return interval.path === 'risk' ? { edge: RISK_EDGE, divider: RISK_DIVIDER } : { edge: SAFE_EDGE, divider: SAFE_DIVIDER }
}

function inHole(route: Route, d: number, lateral: number): boolean {
  return gapHoles(route, d, pathIntervals(route, d)).some(hole => lateral >= hole.left && lateral <= hole.right)
}

/** Distance cuts at most MARK_STEP apart that also land on every topology break. */
function markCuts(route: Route, from: number, to: number): number[] {
  const values = new Set(strips(from, to, MARK_STEP))
  for (const d of topologyBreaks(route, from, to)) values.add(d)
  return [...values].sort((a, b) => a - b)
}

/** The same path's interval at both ends of a strip, so a line can be drawn between them. */
function matched(start: readonly PathInterval[], end: readonly PathInterval[]): [PathInterval, PathInterval][] {
  const pairs: [PathInterval, PathInterval][] = []
  for (const interval of start) {
    const other = end.find(candidate => candidate.path === interval.path)
    if (other && other.lanes.count === interval.lanes.count) pairs.push([interval, other])
  }
  return pairs
}

type LineSource = (interval: PathInterval) => number

/** Draws one line per path between `a` and `b`, skipping gap holes and stretches inside the other fork path's lanes. */
function paintStrip(context: FeatureContext, points: Points, a: number, b: number, lines: (interval: PathInterval) => readonly [LineSource, number, THREE.Color][]): void {
  const { route, glow } = context
  const middle = (a + b) / 2
  const others = pathIntervals(route, middle)
  for (const [ia, ib] of matched(pathIntervals(route, a + EPSILON), pathIntervals(route, b - EPSILON))) {
    for (const [source, half, color] of lines(ia)) {
      const lateralA = source(ia)
      const lateralB = source(ib)
      const at = (d: number): number => lateralA + ((lateralB - lateralA) * (d - a)) / (b - a)
      const lateral = at(middle)
      if (inHole(route, middle, lateral)) continue
      if (others.some(other => other.path !== ia.path && lateral > other.laneLeft + 0.05 && lateral < other.laneRight - 0.05)) continue
      deckQuad(glow, points, a, b, d => at(d) - half, d => at(d) + half, LIFT, color)
    }
  }
}

export function buildLaneMarkings(context: FeatureContext): void {
  const { route, from, to } = context
  const points = new Points(route)
  const start = Math.max(from, route.minDist + 2)
  const end = Math.min(to, route.maxDist - 4)
  if (end <= start) return
  const edgeLines = (interval: PathInterval): readonly [LineSource, number, THREE.Color][] => {
    const color = paint(interval).edge
    return [
      [i => i.laneLeft + EDGE_INSET + EDGE_LINE / 2, EDGE_LINE / 2, color],
      [i => i.laneRight - EDGE_INSET - EDGE_LINE / 2, EDGE_LINE / 2, color],
    ]
  }
  const cuts = markCuts(route, start, end)
  for (let c = 0; c + 1 < cuts.length; c++) {
    if (cuts[c + 1]! - cuts[c]! > 1e-3) paintStrip(context, points, cuts[c]!, cuts[c + 1]!, edgeLines)
  }
  const dividers = (interval: PathInterval): readonly [LineSource, number, THREE.Color][] => {
    const color = paint(interval).divider
    return Array.from({ length: interval.lanes.count - 1 }, (_, k): [LineSource, number, THREE.Color] => [i => i.laneLeft + (k + 1) * i.lanes.width, DIVIDER / 2, color])
  }
  const breaks = topologyBreaks(route, start, end)
  for (let k = Math.floor(start / DASH_PERIOD); k * DASH_PERIOD < end; k++) {
    const dashStart = Math.max(start, k * DASH_PERIOD)
    const dashEnd = Math.min(end, k * DASH_PERIOD + DASH)
    if (dashEnd - dashStart < 0.05) continue
    const dashCuts = [dashStart, ...breaks.filter(d => d > dashStart && d < dashEnd), dashEnd]
    for (let c = 0; c + 1 < dashCuts.length; c++) paintStrip(context, points, dashCuts[c]!, dashCuts[c + 1]!, dividers)
  }
}

/** Gold chevrons down the centre of the lane each gold gate marks, brightening into the gate. */
export function buildGateGuides(context: FeatureContext): void {
  const { route, from, to, glow } = context
  const points = new Points(route)
  const color = new THREE.Color()
  for (const gate of route.track.gates) {
    const d0 = fromQ(gate.dist)
    if (d0 - GUIDE_FROM > to || d0 < from) continue
    const slots = gate.kind === 'pulse' ? [gate.lane, -gate.lane] : [gate.lane]
    for (let d = d0 - GUIDE_FROM; d < d0 - 2; d += GUIDE_STEP) {
      if (d < from || d >= to) continue
      if (route.activePath(gate.path, d) !== gate.path) continue
      const closeness = 1 - (d0 - d) / GUIDE_FROM
      for (const slot of slots) {
        const lateral = route.slotLateral(gate.path, slot, d)
        if (inHole(route, d, lateral)) continue
        if (gate.kind === 'pulse') color.copy(SAFE_DIVIDER).multiplyScalar(0.35 + closeness * 0.45)
        else color.copy(GUIDE).multiplyScalar(0.35 + closeness * 0.9)
        chevron(glow, points, d, lateral, 0.34, LIFT + 0.002, color, 0.1)
      }
    }
  }
}

/**
 * Where the main road changes lane count: arrows in the outer lanes lean in
 * before it narrows and fan out after it widens. Where an edge becomes an open
 * drop, red hash marks on that shoulder warn ahead of it.
 */
export function buildLaneTransitions(context: FeatureContext): void {
  const { route, from, to, glow } = context
  const points = new Points(route)
  const segments = route.track.segments
  for (let i = 1; i < segments.length; i++) {
    const boundary = fromQ(segments[i]!.from)
    if (boundary < from - 40 || boundary > to + 20) continue
    if (route.forkAt(boundary - EPSILON) || route.forkAt(boundary + EPSILON)) continue
    const before = route.lanes('main', boundary - EPSILON)
    const after = route.lanes('main', boundary + EPSILON)
    if (after.count < before.count) {
      for (const offset of [36, 24, 12]) {
        const d = boundary - offset
        if (d < from || d >= to) continue
        const outer = before.count - 1
        for (const side of [-1, 1] as const) {
          chevron(glow, points, d, route.slotLateral('main', side * outer, d), 0.62, LIFT + 0.002, SAFE_EDGE, 0.14, 1, -side * before.width * 0.45)
        }
      }
    } else if (after.count > before.count) {
      for (const offset of [5, 16]) {
        const d = boundary + offset
        if (d < from || d >= to) continue
        const outer = after.count - 1
        for (const side of [-1, 1] as const) {
          chevron(glow, points, d, route.slotLateral('main', side * outer, d), 0.62, LIFT + 0.002, SAFE_EDGE, 0.14, 1, side * after.width * 0.45)
        }
      }
    }
    for (const side of [-1, 1] as const) {
      const was = side === -1 ? before.left : before.right
      const becomes = side === -1 ? after.left : after.right
      if (becomes !== 'open' || was === 'open') continue
      for (let d = boundary - 30; d < boundary; d += 3) {
        if (d < from || d >= to) continue
        const edge = side * route.halfWidth('main', d)
        const inner = edge - side * before.shoulder * 0.8
        const low = Math.min(edge - side * 0.4, inner)
        const high = Math.max(edge - side * 0.4, inner)
        deckQuad(glow, points, d, d + 1.1, () => low, () => high, LIFT, DANGER.soft)
      }
    }
  }
}

export function buildForkMarkings(context: FeatureContext): void {
  for (const fork of context.route.forks) {
    if (fork.to < context.from - RISK_APPROACH || fork.from - RISK_APPROACH > context.to) continue
    riskChevrons(context, fork)
    gore(context, fork)
  }
}

/** Gold chevrons down the lanes that select the risk path on the approach, then down the risk path itself. */
function riskChevrons(context: FeatureContext, fork: RouteFork): void {
  const { route, from, to, glow } = context
  const points = new Points(route)
  const first = Math.ceil((fork.from - RISK_APPROACH) / CHEVRON_STEP) * CHEVRON_STEP
  const color = new THREE.Color()
  for (let d = first; d < fork.to - 4; d += CHEVRON_STEP) {
    if (d < from || d >= to) continue
    const approach = d < fork.from
    const path: relayLeg.Path = approach ? 'main' : 'risk'
    const lanes = route.lanes(path, d)
    const strength = approach ? 0.35 + 0.65 * (1 - (fork.from - d) / RISK_APPROACH) : 1
    color.copy(RISK_CHEVRON).multiplyScalar(strength)
    for (let slot = -(lanes.count - 1); slot <= lanes.count - 1; slot += 2) {
      if (approach && slot * fork.riskSide <= 0) continue
      const lateral = route.slotLateral(path, slot, d)
      if (inHole(route, d, lateral)) continue
      chevron(glow, points, d, lateral, Math.min(0.62, lanes.width * 0.2), LIFT + 0.003, color, 0.12, 1, approach ? fork.riskSide * 0.2 : 0)
    }
  }
}

/** Hatching on the deck between the two paths once their lanes part and before their decks separate. */
function gore(context: FeatureContext, fork: RouteFork): void {
  const { route, from, to, glow } = context
  const parting = forkParting(route, fork)
  if (parting.lanesSplit === null || parting.lanesMerge === null) return
  const points = new Points(route)
  const ranges: readonly [number, number][] = parting.decksSplit === null || parting.decksMerge === null
    ? [[parting.lanesSplit, parting.lanesMerge]]
    : [[parting.lanesSplit, parting.decksSplit], [parting.decksMerge, parting.lanesMerge]]
  for (const [start, end] of ranges) {
    if (end <= start) continue
    const a = Math.max(from, start)
    const b = Math.min(to, end)
    if (b <= a) continue
    const inner = (path: 'safe' | 'risk', d: number): number => {
      const offset = route.pathOffset(path, d)
      const half = route.laneSpan(path, d)
      const towardsOther = path === 'risk' ? -fork.riskSide : fork.riskSide
      return offset + towardsOther * half
    }
    const left = (d: number): number => Math.min(inner('safe', d), inner('risk', d)) + 0.12
    const right = (d: number): number => Math.max(inner('safe', d), inner('risk', d)) - 0.12
    for (const cut of pairs(strips(a, b, MARK_STEP))) {
      if (right(cut[0]) - left(cut[0]) < 0.2) continue
      stripes(glow, points, cut[0], cut[1], left, right, LIFT, GORE, null, 1.8, 0.9 * fork.riskSide)
    }
  }
}

function pairs(values: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i + 1 < values.length; i++) out.push([values[i]!, values[i + 1]!])
  return out
}
