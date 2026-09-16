import { LIVE_LEG_WINDOW_MS, type BatonLive, type NetworkBaton, type StationWorld } from '@nim-relay/shared'
import { LIVE_REPORT_INTERVAL_MS } from './constants'

/** Durable Object storage deletes at most 128 keys per call. */
const STORAGE_KEYS_PER_CALL = 128

/** The latest accepted progress report of a baton leg, with the custody it was accepted under. */
export interface LiveReport {
  batonId: string
  runId: string
  runnerId: string
  runnerName: string
  runnerHandle: string
  /** Handoff count the leg was issued for. */
  relayLeg: number
  progress: number
  ghostDeltaMs: number | null
  world: StationWorld
  sector: number
  updatedAt: number
  /** When the leg's issue expires: a report never outlives its ticket. */
  expiresAt: number
}

export function liveKeyPrefix(networkKey: string): string {
  return `${networkKey}:live:`
}

/**
 * Live baton legs of one network. Reports are held in Durable Object memory and under one small storage key per
 * baton that each accepted report overwrites, so a restarted object still shows a leg in progress. None of this is
 * network state. A report stops counting once it is LIVE_LEG_WINDOW_MS old or its issue expired, and pruning then
 * deletes it.
 */
export class LiveLegs {
  private readonly reports = new Map<string, LiveReport>()
  /** runId -> when its latest report was accepted. */
  private readonly acceptedAt = new Map<string, number>()
  private hydration: Promise<void> | null = null

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly prefix: string,
  ) {}

  /** Loads the reports an earlier instance of the object stored, once per instance. */
  ready(): Promise<void> {
    this.hydration ??= this.hydrate().catch((error: unknown) => {
      this.hydration = null
      throw error
    })
    return this.hydration
  }

  /** The leg `baton`'s holder is racing, while its latest report is fresh and custody has not moved since it. Call after `ready`. */
  liveFor(baton: Pick<NetworkBaton, 'id' | 'holder' | 'handoffCount'>, now: number): BatonLive | null {
    const report = this.reports.get(baton.id)
    if (!report || !isFresh(report, now) || report.runnerId !== baton.holder.id || report.relayLeg !== baton.handoffCount) return null
    const { runnerName, runnerHandle, progress, ghostDeltaMs, world, sector, updatedAt } = report
    return { runnerName, runnerHandle, progress, ghostDeltaMs, world, sector, updatedAt, ageMs: now - updatedAt }
  }

  /** Whether the run's previous report was accepted less than LIVE_REPORT_INTERVAL_MS ago. */
  tooSoon(runId: string, now: number): boolean {
    const accepted = this.acceptedAt.get(runId)
    return accepted !== undefined && now - accepted < LIVE_REPORT_INTERVAL_MS
  }

  async record(report: LiveReport): Promise<void> {
    await this.prune(report.updatedAt)
    await this.storage.put(this.keyOf(report.batonId), report)
    this.reports.set(report.batonId, report)
    this.acceptedAt.set(report.runId, report.updatedAt)
  }

  /** Ends the live leg of a run that was submitted. Returns whether that run was the baton's live leg. */
  async end(batonId: string, runId: string): Promise<boolean> {
    await this.ready()
    if (this.reports.get(batonId)?.runId !== runId) return false
    await this.storage.delete(this.keyOf(batonId))
    this.reports.delete(batonId)
    this.acceptedAt.delete(runId)
    return true
  }

  /** Forgets every report that can never be live again, in memory and in storage. */
  async prune(now: number): Promise<void> {
    await this.ready()
    for (const [runId, accepted] of this.acceptedAt) {
      if (now - accepted >= LIVE_REPORT_INTERVAL_MS) this.acceptedAt.delete(runId)
    }
    const stale = [...this.reports.values()].filter(report => !isFresh(report, now))
    await this.deleteKeys(stale.map(report => this.keyOf(report.batonId)))
    for (const report of stale) this.reports.delete(report.batonId)
  }

  private async hydrate(): Promise<void> {
    const now = Date.now()
    const stored = await this.storage.list<LiveReport>({ prefix: this.prefix })
    const stale: string[] = []
    for (const [key, report] of stored) {
      if (isFresh(report, now)) this.reports.set(report.batonId, report)
      else stale.push(key)
    }
    await this.deleteKeys(stale)
  }

  private async deleteKeys(keys: readonly string[]): Promise<void> {
    for (let offset = 0; offset < keys.length; offset += STORAGE_KEYS_PER_CALL) {
      await this.storage.delete(keys.slice(offset, offset + STORAGE_KEYS_PER_CALL))
    }
  }

  private keyOf(batonId: string): string {
    return `${this.prefix}${batonId}`
  }
}

function isFresh(report: LiveReport, now: number): boolean {
  return now - report.updatedAt < LIVE_LEG_WINDOW_MS && now < report.expiresAt
}
