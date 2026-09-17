import type { ShareSurface } from '@nim-relay/shared'
import { sha256Hex } from '../signing'
import { keepLatestDates, utcDate } from './calendar'
import { ANONYMOUS_SHARES_PER_DAY, OPS_WINDOW_DAYS, SHARES_PER_ACTOR_PER_DAY } from './constants'
import type { TrafficState } from './types'

const ANONYMOUS_TOTAL_KEY = 'anonymous'

type ShareTallies = 'shareTalliesSince' | 'sharesBySurface' | 'sharesByDay'
/** Traffic as written by any release so far: the share tallies came later. */
type StoredTraffic = Omit<TrafficState, ShareTallies> & Partial<Pick<TrafficState, ShareTallies>>

export interface ShareAction {
  /** A signed-in runner, or an anonymous device key. */
  actorKey: string
  anonymous: boolean
  surface: ShareSurface
}

/**
 * Who a tracked event counts against for daily caps: the signed-in runner, or a hash of a signed-out device's visitor
 * key. Devices that send no key share one bucket.
 */
export async function trackActorKey(actorId: string | null, visitor: string | undefined): Promise<string> {
  if (actorId) return `runner:${actorId}`
  return `visitor:${visitor ? await sha256Hex(visitor) : 'unidentified'}`
}

export function trafficStateKey(networkKey: string): string {
  return `${networkKey}:traffic`
}

export async function readTraffic(storage: DurableObjectStorage, key: string, now: number): Promise<TrafficState> {
  const stored = await storage.get<StoredTraffic>(key)
  if (!stored) return { day: '', chronicleViews: 0, inviteOpens: 0, shares: 0, openedInvites: [], sharesToday: {}, shareTalliesSince: now, sharesBySurface: {}, sharesByDay: {} }
  return { ...stored, shareTalliesSince: stored.shareTalliesSince ?? now, sharesBySurface: stored.sharesBySurface ?? {}, sharesByDay: stored.sharesByDay ?? {} }
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
 * Counts a share action on its surface. Anonymous shares also share one network-wide daily cap so rotating
 * device keys cannot inflate the metric.
 */
export function countShare(traffic: TrafficState, share: ShareAction, now: number): boolean {
  rollDay(traffic, now)
  const actorShares = traffic.sharesToday[share.actorKey] ?? 0
  if (actorShares >= SHARES_PER_ACTOR_PER_DAY) return false
  const anonymousShares = traffic.sharesToday[ANONYMOUS_TOTAL_KEY] ?? 0
  if (share.anonymous && anonymousShares >= ANONYMOUS_SHARES_PER_DAY) return false
  traffic.sharesToday[share.actorKey] = actorShares + 1
  if (share.anonymous) traffic.sharesToday[ANONYMOUS_TOTAL_KEY] = anonymousShares + 1
  traffic.shares++
  tallyShare(traffic, share.surface, now)
  return true
}

function tallyShare(traffic: TrafficState, surface: ShareSurface, now: number): void {
  traffic.sharesBySurface[surface] = (traffic.sharesBySurface[surface] ?? 0) + 1
  const today = utcDate(now)
  traffic.sharesByDay[today] = (traffic.sharesByDay[today] ?? 0) + 1
  keepLatestDates(traffic.sharesByDay, now, OPS_WINDOW_DAYS)
}
