import { useEffect, useMemo, useState } from 'react'
import { LIVE_LEG_WINDOW_MS, type BatonLive, type NetworkBaton } from '@nim-relay/shared'
import { displayName } from '../race/format'
import { worldName } from './format'

/**
 * A baton leg as spectators see it while its holder races: only while the latest progress report is fresh on this
 * client's clock, and never further along than that report plus a small easing margin.
 */

/** A progress bar may run ahead of the latest report by at most this share of the route. */
export const LIVE_EXTRAPOLATION_LIMIT = 0.03
/** Time constant of the bar's easing towards where the leg is, in milliseconds. */
const EASE_MS = 450

/** When a live report stops counting on this client's clock, given when its response arrived here. */
export function liveStaleAt(live: BatonLive, receivedAt: number): number {
  return receivedAt + LIVE_LEG_WINDOW_MS - live.ageMs
}

/** Date.now() as of the last render, refreshed once the soonest of `deadlines` still ahead of it passes. */
function useClockPast(deadlines: readonly number[]): number {
  const [now, setNow] = useState(() => Date.now())
  const next = deadlines.reduce<number | null>((soonest, deadline) => (deadline > now && (soonest === null || deadline < soonest) ? deadline : soonest), null)
  useEffect(() => {
    if (next === null) return
    // Never behind the deadline it waited for, even when a timer fires a millisecond early.
    const timer = window.setTimeout(() => setNow(Math.max(Date.now(), next)), Math.max(0, next - Date.now()))
    return () => window.clearTimeout(timer)
  }, [next])
  return now
}

/** `live` while its latest report is under LIVE_LEG_WINDOW_MS old, else null. `receivedAt` is when its response arrived. */
export function useFreshLive(live: BatonLive | null | undefined, receivedAt: number): BatonLive | null {
  const staleAt = live ? liveStaleAt(live, receivedAt) : null
  const now = useClockPast(staleAt === null ? [] : [staleAt])
  return live && staleAt !== null && staleAt > now ? live : null
}

/** Ids of the batons whose holder is racing right now, from a snapshot that arrived at `receivedAt`. */
export function useLiveBatonIds(batons: readonly NetworkBaton[] | undefined, receivedAt: number): ReadonlySet<string> {
  const legs = useMemo(() => (batons ?? []).flatMap(baton => (baton.live ? [{ id: baton.id, staleAt: liveStaleAt(baton.live, receivedAt) }] : [])), [batons, receivedAt])
  const deadlines = useMemo(() => legs.map(leg => leg.staleAt), [legs])
  const now = useClockPast(deadlines)
  return useMemo(() => new Set(legs.filter(leg => leg.staleAt > now).map(leg => leg.id)), [legs, now])
}

/** Whether a relay room broadcast is only about legs in progress, which it marks with `live: true`. */
export function isLiveUpdate(data: unknown): boolean {
  if (typeof data !== 'string') return false
  try {
    const message: unknown = JSON.parse(data)
    return typeof message === 'object' && message !== null && Reflect.get(message, 'live') === true
  } catch {
    // An unreadable message still means something changed, so it counts as a full update.
    return false
  }
}

/** "TIM IS CARRYING THE BATON NOW" */
export function carryingLine(live: BatonLive): string {
  return `${displayName(live.runnerName)} IS CARRYING THE BATON NOW`
}

/** Whole percent reached, rounded down so a leg is never shown further along than reported. */
export function progressPercent(progress: number): string {
  return `${Math.floor(Math.max(0, Math.min(1, progress)) * 100)}%`
}

/** "+0.31s" while the ghost leads, "−0.31s" while the runner does. */
export function ghostGap(ghostDeltaMs: number): string {
  const sign = ghostDeltaMs > 0 ? '+' : ghostDeltaMs < 0 ? '−' : '±'
  return `${sign}${(Math.abs(ghostDeltaMs) / 1000).toFixed(2)}s`
}

/** "62% · +0.31s": progress and the ghost gap, when there is a ghost. */
export function liveNumbers(live: BatonLive): string {
  return live.ghostDeltaMs === null ? progressPercent(live.progress) : `${progressPercent(live.progress)} · ${ghostGap(live.ghostDeltaMs)}`
}

/** "62% · +0.31s vs MARIANA · Midnight Metro". The ghost gap is left out when the leg races no ghost. */
export function liveFacts(live: BatonLive, ghostName: string | null): string {
  const gap = live.ghostDeltaMs === null ? null : `${ghostGap(live.ghostDeltaMs)} vs ${ghostName ? displayName(ghostName) : 'GHOST'}`
  return [progressPercent(live.progress), gap, worldName(live.world)].filter(fact => fact !== null).join(' · ')
}

/**
 * Where a spectator's progress bar stands between reports. It eases towards the latest report and onward at the
 * pace of the last two reports, but never past LIVE_EXTRAPOLATION_LIMIT beyond the latest report, and drops back at
 * once when a report shows less progress, as when a leg is started again.
 */
export class LiveProgressEaser {
  private shown: number
  private progress: number
  private updatedAt: number
  private seenAt: number
  /** Share of the route per millisecond between the last two reports. */
  private pace = 0

  constructor(progress: number, updatedAt: number, now: number) {
    this.shown = progress
    this.progress = progress
    this.updatedAt = updatedAt
    this.seenAt = now
  }

  report(progress: number, updatedAt: number, now: number): void {
    if (updatedAt === this.updatedAt) return
    const elapsed = updatedAt - this.updatedAt
    const gained = progress - this.progress
    this.pace = elapsed > 0 && gained > 0 ? gained / elapsed : 0
    this.progress = progress
    this.updatedAt = updatedAt
    this.seenAt = now
  }

  /** The bar's value at `now`, `dt` milliseconds after the previous frame. */
  frame(now: number, dt: number): number {
    const ceiling = Math.min(1, this.progress + LIVE_EXTRAPOLATION_LIMIT)
    const target = Math.min(ceiling, this.progress + this.pace * Math.max(0, now - this.seenAt))
    this.shown = Math.min(ceiling, this.shown + (target - this.shown) * (1 - Math.exp(-Math.max(0, dt) / EASE_MS)))
    return this.shown
  }
}
