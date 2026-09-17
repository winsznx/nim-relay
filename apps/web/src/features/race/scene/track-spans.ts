import type { relayLeg } from '@nim-relay/game-engine'
import { createPathLanes, fromQ, type PathLanes, type Route, type RouteFork } from './route'

/**
 * Cross-sections of the drivable deck. At any route distance the deck is a set
 * of lateral spans (metres from the main centre line): one span on the main
 * road, two once a fork's paths separate, with real holes where gaps are. Each
 * span divides into bands of paved lanes and shoulders, and each side ends in
 * the edge kind the simulation uses (rail, open drop, wall) or a gap.
 */

export type SideKind = relayLeg.EdgeKind | 'gap'

export interface Span {
  left: number
  right: number
  leftKind: SideKind
  rightKind: SideKind
}

export interface PathInterval {
  path: relayLeg.Path
  centre: number
  /** Edge lines, including shoulders. */
  left: number
  right: number
  /** Paved lane area. */
  laneLeft: number
  laneRight: number
  lanes: PathLanes
}

export type BandKind = 'lane' | 'shoulder'

export interface Band {
  left: number
  right: number
  kind: BandKind
  /** Left edge of the lane area this band belongs to, so lane grooves land on lane boundaries. */
  origin: number
  laneWidth: number
}

const MAIN_PATH: readonly relayLeg.Path[] = ['main']
const FORK_PATHS: readonly relayLeg.Path[] = ['safe', 'risk']
const BAND_EPSILON = 1e-4

export function pathIntervals(route: Route, d: number): PathInterval[] {
  const paths = route.forkAt(d) ? FORK_PATHS : MAIN_PATH
  const intervals = paths.map(path => {
    const lanes = route.lanes(path, d)
    const centre = route.pathOffset(path, d)
    const laneHalf = (lanes.count * lanes.width) / 2
    return {
      path,
      centre,
      left: centre - laneHalf - lanes.shoulder,
      right: centre + laneHalf + lanes.shoulder,
      laneLeft: centre - laneHalf,
      laneRight: centre + laneHalf,
      lanes,
    }
  })
  return intervals.sort((a, b) => a.centre - b.centre)
}

export interface Extent {
  left: number
  right: number
}

const extentLanes = createPathLanes()

/**
 * Lateral extents (metres from the main centre line) a zone covers on `path`
 * at `d`, the way the engine's `zoneCovers` resolves them: a zone over every
 * lane covers the whole road with its shoulders; otherwise each run of listed
 * lanes covers those lanes' full width and nothing else.
 */
export function zoneExtents(route: Route, path: relayLeg.Path, slots: readonly number[], d: number): Extent[] {
  const lanes = route.lanes(path, d, extentLanes)
  const centre = route.pathOffset(path, d)
  if (slots.length >= lanes.count) {
    const edge = (lanes.count * lanes.width) / 2 + lanes.shoulder
    return [{ left: centre - edge, right: centre + edge }]
  }
  const extents: Extent[] = []
  for (const slot of [...slots].sort((a, b) => a - b)) {
    const left = centre + ((slot - 1) * lanes.width) / 2
    const right = centre + ((slot + 1) * lanes.width) / 2
    const last = extents[extents.length - 1]
    if (last && left <= last.right + 1e-6) last.right = right
    else extents.push({ left, right })
  }
  return extents
}

/** Whether a zone covers `lateral` (metres from the main centre line) at `d`. Allocation free, for per-frame use. */
export function zoneCoversLateral(route: Route, path: relayLeg.Path, slots: readonly number[], d: number, lateral: number): boolean {
  const lanes = route.lanes(path, d, extentLanes)
  const x = lateral - route.pathOffset(path, d)
  if (slots.length >= lanes.count) return Math.abs(x) <= (lanes.count * lanes.width) / 2 + lanes.shoulder
  for (let i = 0; i < slots.length; i++) {
    if (Math.abs(x - (slots[i]! * lanes.width) / 2) <= lanes.width / 2) return true
  }
  return false
}

/** Lateral holes cut by gaps at `d`, on the owning path. */
export function gapHoles(route: Route, d: number, intervals: readonly PathInterval[]): Extent[] {
  const holes: Extent[] = []
  const q = d * 65536
  for (const gap of route.track.gaps) {
    if (gap.from > q) break
    if (q >= gap.to) continue
    if (gap.lanes.length === 0 || !intervals.some(interval => interval.path === gap.path)) continue
    for (const extent of zoneExtents(route, gap.path, gap.lanes, d)) {
      if (extent.right > extent.left) holes.push(extent)
    }
  }
  return holes
}

export function spansAt(route: Route, d: number, intervals: readonly PathInterval[] = pathIntervals(route, d)): Span[] {
  const merged: Span[] = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (last && interval.left <= last.right) {
      if (interval.right > last.right) {
        last.right = interval.right
        last.rightKind = interval.lanes.right
      }
    } else {
      merged.push({ left: interval.left, right: interval.right, leftKind: interval.lanes.left, rightKind: interval.lanes.right })
    }
  }
  const holes = gapHoles(route, d, intervals)
  if (holes.length === 0) return merged
  let spans = merged
  for (const hole of holes) {
    const next: Span[] = []
    for (const span of spans) {
      if (hole.right <= span.left || hole.left >= span.right) {
        next.push(span)
        continue
      }
      if (hole.left > span.left) next.push({ left: span.left, right: hole.left, leftKind: span.leftKind, rightKind: 'gap' })
      if (hole.right < span.right) next.push({ left: hole.right, right: span.right, leftKind: 'gap', rightKind: span.rightKind })
    }
    spans = next
  }
  return spans
}

/** Lane and shoulder bands of one span, left to right. Zero-width bands are kept so band counts stay stable along a strip. */
export function spanBands(span: Span, intervals: readonly PathInterval[]): Band[] {
  const cuts = [span.left]
  for (const interval of intervals) {
    for (const edge of [interval.laneLeft, interval.laneRight]) {
      if (edge > span.left + BAND_EPSILON && edge < span.right - BAND_EPSILON) cuts.push(edge)
    }
  }
  cuts.push(span.right)
  cuts.sort((a, b) => a - b)
  const bands: Band[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const left = cuts[i]!
    const right = cuts[i + 1]!
    const middle = (left + right) / 2
    const owner = intervals.find(interval => middle >= interval.laneLeft - BAND_EPSILON && middle <= interval.laneRight + BAND_EPSILON)
    bands.push(owner
      ? { left, right, kind: 'lane', origin: owner.laneLeft, laneWidth: owner.lanes.width }
      : { left, right, kind: 'shoulder', origin: left, laneWidth: 1 })
  }
  return bands
}

interface Parting {
  /** Where the paths' lane areas part after the split and meet before the merge. */
  lanesSplit: number | null
  lanesMerge: number | null
  /** Where the paths' decks part and meet. */
  decksSplit: number | null
  decksMerge: number | null
}

const partingCache = new WeakMap<Route, Map<number, Parting>>()

export function forkParting(route: Route, fork: RouteFork): Parting {
  let byFork = partingCache.get(route)
  if (!byFork) {
    byFork = new Map()
    partingCache.set(route, byFork)
  }
  const cached = byFork.get(fork.index)
  if (cached) return cached
  const middle = (fork.from + fork.to) / 2
  const lanesParted = (d: number): boolean => route.forkLanesParted(fork, d)
  const decksParted = (d: number): boolean => route.forkSeparated(fork, d)
  const parting: Parting = {
    lanesSplit: lanesParted(middle) ? bisect(fork.from + 1e-3, middle, lanesParted) : null,
    lanesMerge: lanesParted(middle) ? bisect(fork.to - 1e-3, middle, lanesParted) : null,
    decksSplit: decksParted(middle) ? bisect(fork.from + 1e-3, middle, decksParted) : null,
    decksMerge: decksParted(middle) ? bisect(fork.to - 1e-3, middle, decksParted) : null,
  }
  byFork.set(fork.index, parting)
  return parting
}

/**
 * Distances inside [from, to] where the cross-section topology can change:
 * segment boundaries (lane counts, shoulders and edge kinds step there), gap
 * edges, fork ends, and where fork lanes and decks part and meet. Strips are
 * cut at these so every strip has a constant band structure.
 */
export function topologyBreaks(route: Route, from: number, to: number): number[] {
  const breaks: number[] = []
  const push = (d: number | null): void => {
    if (d !== null && d > from && d < to) breaks.push(d)
  }
  for (const segment of route.track.segments) push(fromQ(segment.from))
  for (const gap of route.track.gaps) {
    push(fromQ(gap.from))
    push(fromQ(gap.to))
  }
  for (const fork of route.forks) {
    if (fork.to < from || fork.from > to) continue
    push(fork.from)
    push(fork.to)
    const parting = forkParting(route, fork)
    push(parting.lanesSplit)
    push(parting.lanesMerge)
    push(parting.decksSplit)
    push(parting.decksMerge)
  }
  return breaks
}

/** Finds the boundary between a not-parted end `a` and a parted end `b`. */
function bisect(a: number, b: number, parted: (d: number) => boolean): number {
  let joined = a
  let apart = b
  for (let i = 0; i < 40; i++) {
    const mid = (joined + apart) / 2
    if (parted(mid)) apart = mid
    else joined = mid
  }
  return (joined + apart) / 2
}
