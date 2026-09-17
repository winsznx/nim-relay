/**
 * FLOW as the player should feel it: four tiers the whole presentation agrees on. The HUD glows by
 * tier, the scene widens, streaks and blazes by it, and the music opens fully at mid and adds its
 * hat layer through high, so sight and sound change at the same moments. Relay Rush is the top tier
 * and comes from the simulation (`rushTicks`), never from FLOW alone.
 */

export type FlowTier = 'low' | 'mid' | 'high' | 'rush'

/** FLOW (0..1) where the mid tier starts: the music filter is fully open here. */
export const FLOW_MID = 0.5
/** FLOW (0..1) where the high tier starts: speed streaks and the hat layer come in. */
export const FLOW_HIGH = 0.75

export function flowTier(flow: number, rushTicks: number): FlowTier {
  if (rushTicks > 0) return 'rush'
  if (flow >= FLOW_HIGH) return 'high'
  if (flow >= FLOW_MID) return 'mid'
  return 'low'
}

const RANK: Readonly<Record<FlowTier, number>> = { low: 0, mid: 1, high: 2, rush: 3 }

/** True when `next` is a higher tier than `previous`. */
export function tierRose(previous: FlowTier, next: FlowTier): boolean {
  return RANK[next] > RANK[previous]
}
