import type { relayLeg } from '@nim-relay/game-engine'
import { fromQ, type Route } from './route'

/**
 * Cross-sections of the drivable deck. At any route distance the deck is a set
 * of lateral spans (metres from the main centre line): one span on the main
 * route, two once the fork paths separate, with real holes where gaps are.
 */

export type EdgeKind = 'edge' | 'gap'

export interface Span {
  left: number
  right: number
  leftKind: EdgeKind
  rightKind: EdgeKind
}

export interface PathInterval {
  path: relayLeg.Path
  centre: number
  left: number
  right: number
}

export function pathIntervals(route: Route, d: number): PathInterval[] {
  const { from, to } = route.fork
  const paths: relayLeg.Path[] = d > from && d < to ? ['safe', 'risk'] : ['main']
  return paths.map(path => {
    const centre = route.pathOffset(path, d)
    const half = route.halfWidth(path, d)
    return { path, centre, left: centre - half, right: centre + half }
  })
}

/** Lateral holes cut by gaps at `d`, clipped to the owning path. */
export function gapHoles(route: Route, d: number, intervals: readonly PathInterval[]): { left: number; right: number }[] {
  const holes: { left: number; right: number }[] = []
  const q = d * 65536
  for (const gap of route.track.gaps) {
    if (gap.from > q) break
    if (q >= gap.to) continue
    const owner = intervals.find(interval => interval.path === gap.path)
    if (!owner) continue
    const centre = owner.centre + fromQ(gap.x)
    const left = Math.max(owner.left, centre - fromQ(gap.half))
    const right = Math.min(owner.right, centre + fromQ(gap.half))
    if (right > left) holes.push({ left, right })
  }
  return holes
}

export function spansAt(route: Route, d: number): Span[] {
  const intervals = pathIntervals(route, d).sort((a, b) => a.left - b.left)
  const merged: Span[] = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (last && interval.left <= last.right) {
      last.right = Math.max(last.right, interval.right)
    } else {
      merged.push({ left: interval.left, right: interval.right, leftKind: 'edge', rightKind: 'edge' })
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

/**
 * Distances inside [from, to] where the span topology can change: gap edges,
 * fork ends and the points where the fork decks part and rejoin. Strips are cut
 * at these so every strip has a constant number of spans.
 */
export function topologyBreaks(route: Route, from: number, to: number): number[] {
  const breaks: number[] = []
  const push = (d: number): void => {
    if (d > from && d < to) breaks.push(d)
  }
  for (const gap of route.track.gaps) {
    push(fromQ(gap.from))
    push(fromQ(gap.to))
  }
  push(route.fork.from)
  push(route.fork.to)
  const parting = forkPartingPoints(route)
  if (parting) {
    push(parting.split)
    push(parting.merge)
  }
  return breaks
}

const partingCache = new WeakMap<Route, { split: number; merge: number } | null>()

/** Where the two fork decks stop overlapping, and where they overlap again. */
export function forkPartingPoints(route: Route): { split: number; merge: number } | null {
  const cached = partingCache.get(route)
  if (cached !== undefined) return cached
  const { from, to } = route.fork
  const middle = (from + to) / 2
  let result: { split: number; merge: number } | null = null
  if (route.forkSeparated(middle)) {
    result = { split: bisect(route, from, middle), merge: bisect(route, to, middle) }
  }
  partingCache.set(route, result)
  return result
}

/** Finds the boundary between an overlapping end `a` and a separated end `b`. */
function bisect(route: Route, a: number, b: number): number {
  let overlapping = a
  let separated = b
  for (let i = 0; i < 40; i++) {
    const mid = (overlapping + separated) / 2
    if (route.forkSeparated(mid)) separated = mid
    else overlapping = mid
  }
  return (overlapping + separated) / 2
}
