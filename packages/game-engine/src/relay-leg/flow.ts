import { ONE } from '../fixed-point'
import { MAX_MOMENTS, type Metrics, type Moment, type MomentKind, type State } from './types'

/** The state being built by one `step`: a fresh copy that the tick's rules may write. */
export type Draft = Omit<State, 'metrics'> & { metrics: Metrics }

/** FLOW gains. During Relay Rush FLOW is pinned at full, so gains change nothing. */
export function gainFlow(s: Draft, amount: number): void {
  if (s.rushTicks > 0) return
  s.flow = Math.min(ONE, s.flow + amount)
}

/** Soft FLOW losses (misses, drains, rough contact). Relay Rush shrugs them off. */
export function loseFlow(s: Draft, amount: number): void {
  if (s.rushTicks > 0) return
  s.flow = Math.max(0, s.flow - amount)
}

/** Hits and falls end Relay Rush on the spot, then cost their FLOW. */
export function breakFlow(s: Draft, amount: number): void {
  s.rushTicks = 0
  s.flow = Math.max(0, s.flow - amount)
}

/**
 * Records a verified moment in route order. Bounded by MAX_MOMENTS, and a kind never
 * repeats at the same distance.
 */
export function addMoment(s: Draft, kind: MomentKind): void {
  const moments = s.moments
  if (moments.length >= MAX_MOMENTS) return
  let insertAt = moments.length
  for (let i = 0; i < moments.length; i++) {
    const moment = moments[i]!
    if (moment.kind === kind && moment.dist === s.dist) return
    if (moment.dist > s.dist && insertAt === moments.length) insertAt = i
  }
  const moment: Moment = { kind, dist: s.dist, tick: s.tick, path: s.path }
  s.moments = [...moments.slice(0, insertAt), moment, ...moments.slice(insertAt)]
}
