import { utcDate } from './calendar'
import { ANONYMOUS_SHARES_PER_DAY, SHARES_PER_ACTOR_PER_DAY } from './constants'
import type { TrafficState } from './types'

const ANONYMOUS_TOTAL_KEY = 'anonymous'

export function trafficStateKey(networkKey: string): string {
  return `${networkKey}:traffic`
}

export async function readTraffic(storage: DurableObjectStorage, key: string): Promise<TrafficState> {
  return (await storage.get<TrafficState>(key)) ?? { day: '', chronicleViews: 0, inviteOpens: 0, shares: 0, openedInvites: [], sharesToday: {} }
}

export async function writeTraffic(storage: DurableObjectStorage, key: string, traffic: TrafficState): Promise<void> {
  await storage.put(key, traffic)
}

/** Daily dedupe and caps reset at UTC midnight; totals never do. */
function rollDay(traffic: TrafficState, now: number): void {
  const today = utcDate(now)
  if (traffic.day === today) return
  traffic.day = today
  traffic.openedInvites = []
  traffic.sharesToday = {}
}

/** Counts a valid invitation link at most once per UTC day. */
export function countInviteOpen(traffic: TrafficState, tokenHash: string, now: number): boolean {
  rollDay(traffic, now)
  if (traffic.openedInvites.includes(tokenHash)) return false
  traffic.openedInvites.push(tokenHash)
  traffic.inviteOpens++
  return true
}

export function countChronicleView(traffic: TrafficState): void {
  traffic.chronicleViews++
}

/**
 * Counts a share action. `actorKey` identifies a signed-in runner or an anonymous device key; anonymous shares
 * also share one network-wide daily cap so rotating device keys cannot inflate the metric.
 */
export function countShare(traffic: TrafficState, actorKey: string, anonymous: boolean, now: number): boolean {
  rollDay(traffic, now)
  const actorShares = traffic.sharesToday[actorKey] ?? 0
  if (actorShares >= SHARES_PER_ACTOR_PER_DAY) return false
  const anonymousShares = traffic.sharesToday[ANONYMOUS_TOTAL_KEY] ?? 0
  if (anonymous && anonymousShares >= ANONYMOUS_SHARES_PER_DAY) return false
  traffic.sharesToday[actorKey] = actorShares + 1
  if (anonymous) traffic.sharesToday[ANONYMOUS_TOTAL_KEY] = anonymousShares + 1
  traffic.shares++
  return true
}
