import type { LegProgressResult, NetworkHandoffIntent, OpsReport, TrackEventResult } from '@nim-relay/shared'
import { z } from 'zod'
import type { Env } from '../../env'
import { ApiError, type Profile, type Run, type State } from '../model'
import { sha256Hex } from '../signing'
import { archiveNetwork } from './archive'
import { batonDetail, createBaton, rematchBaton } from './batons'
import { batonChronicle } from './chronicle'
import { RECONCILE_RETRY_MS } from './constants'
import { settleDailies } from './daily'
import { loadGhost } from './ghosts'
import { attemptHandoff, awaitsAcceptance, cancelHandoff, confirmHandoff, prepareHandoff, releaseLapsedReservation, strandIdleBaton, submitHandoffTransaction, type TransactionLookup } from './handoff'
import type { LiveLegs } from './live'
import { findBaton, isOpenIntent } from './lookups'
import { opsReport } from './ops'
import { countRun, noteArchived, noteUnarchivedChange, opsLedgerKey, readOpsLedger, writeOpsLedger } from './ops-ledger'
import { runnerProfile } from './profile'
import { reportLegProgress } from './progress'
import { issueRace, recordRun } from './races'
import { touchMember } from './runners'
import { networkSnapshot } from './snapshot'
import { acceptReservation, claimInvite, createCrew, createInvite, createRivalry, findInvite, joinCrew, markNotificationRead, recordHeartbeat, setCountryConsent } from './social'
import { freshNetworkState, networkStateKey, normalizeNetworkState, readNetworkState, writeNetworkState } from './state'
import { countChronicleView, countInviteOpen, countShare, readTraffic, trafficStateKey, writeTraffic } from './traffic'
import type { NetworkContext, NetworkState } from './types'

const createBody = z.object({
  mode: z.enum(['quick', 'global', 'crew', 'rival']),
  title: z.string().trim().max(60).refine(title => title.length === 0 || title.length >= 3).default(''),
  recipient: z.string().optional(),
  bestOf: z.union([z.literal(3), z.literal(5)]).optional(),
  crewId: z.string().optional(),
})
const batonBody = z.object({ batonId: z.string() })
const trackBody = z.object({
  kind: z.literal('share'),
  surface: z.enum(['chronicle', 'result', 'daily', 'crew', 'handoff']),
  visitor: z.string().min(8).max(128).optional(),
})

const PUBLIC_PREFIXES = ['/public', '/batons/', '/replays/', '/invites/', '/runners/', '/chronicles/', '/track']

/** Network routes that work signed out. Paths are relative to /network. */
export function isPublicNetworkPath(path: string): boolean {
  return PUBLIC_PREFIXES.some(prefix => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix)))
}

/**
 * Relay network for one Nimiq network inside the StationRoom Durable Object. Loaded per request, which the
 * room serializes with blockConcurrencyWhile; state reaches storage only through `persist` and `writeTo`.
 */
/** A read only rewrites last-seen once it is this old, so returning-visitor data stays fresh without a write per refresh. */
const LAST_SEEN_PERSIST_MS = 10 * 60_000

export interface VisitMarker {
  exists: boolean
  days: number
  country: string | null
  lastSeen: number
  settledThrough: string | null
  dailyBests: number
}

export class RelayNetworkService {
  private constructor(
    private readonly context: NetworkContext,
    private readonly key: string,
  ) {}

  get state(): NetworkState {
    return this.context.state
  }

  static async load(storage: DurableObjectStorage, env: Env, product: State, live: LiveLegs): Promise<RelayNetworkService> {
    const now = Date.now()
    const key = networkStateKey(env.NIMIQ_NETWORK)
    const stored = await readNetworkState(storage, key)
    const state = stored ? normalizeNetworkState(stored) : freshNetworkState()
    const traffic = await readTraffic(storage, trafficStateKey(key), now)
    const ops = await readOpsLedger(storage, opsLedgerKey(key), now)
    await live.ready()
    return new RelayNetworkService({ storage, env, product, state, traffic, ops, live }, key)
  }

  /**
   * Signed-out routes never rewrite network state; only their traffic counters are stored, on their own key.
   * `actorId` is the signed-in runner behind a share or a baton page read, when there is one.
   */
  async handlePublic(path: string, body: unknown, actorId: string | null): Promise<unknown> {
    const now = Date.now()
    if (path === '/public') return networkSnapshot(this.context, null)
    const batonCode = segmentAfter(path, '/batons/')
    if (batonCode !== null) return batonDetail(this.context, findBaton(this.state, batonCode), null, actorId)
    const runId = segmentAfter(path, '/replays/')
    if (runId !== null) {
      const ghost = await loadGhost(this.context, runId)
      if (!ghost) throw new ApiError('verified_replay_not_found', 404)
      return ghost
    }
    const token = segmentAfter(path, '/invites/')
    if (token !== null) {
      const { invite, tokenHash } = await findInvite(this.context, token)
      if (countInviteOpen(this.context.traffic, tokenHash, now)) await this.saveTraffic()
      return invite
    }
    const handle = segmentAfter(path, '/runners/')
    if (handle !== null) return runnerProfile(this.context, handle)
    const chronicleCode = segmentAfter(path, '/chronicles/')
    if (chronicleCode !== null) {
      const chronicle = batonChronicle(this.context, chronicleCode)
      countChronicleView(this.context.traffic)
      await this.saveTraffic()
      return chronicle
    }
    if (path === '/track') return this.track(body, actorId, now)
    throw new ApiError('not_found', 404)
  }

  async handle(path: string, body: unknown, profile: Profile, country: string | undefined): Promise<unknown> {
    const { context } = this
    const now = Date.now()
    const member = touchMember(this.state, profile.id, country, now)
    settleDailies(this.state, now)
    switch (path) {
      case '/':
        return networkSnapshot(context, profile)
      case '/consent':
        setCountryConsent(member, body, country)
        return networkSnapshot(context, profile)
      case '/heartbeat':
        recordHeartbeat(member, body, now)
        return { ok: true }
      case '/create':
        return batonDetail(context, createBaton(context, profile, createBody.parse(body)), profile)
      case '/rematch':
        return batonDetail(context, rematchBaton(context, profile, findBaton(this.state, batonBody.parse(body).batonId)), profile)
      case '/issue':
        return issueRace(context, profile, body)
      case '/handoff/prepare':
        return prepareHandoff(context, profile, body)
      case '/handoff/attempt':
        return attemptHandoff(context, profile, body)
      case '/handoff/cancel':
        return cancelHandoff(context, profile, body)
      case '/handoff/confirm':
        return submitHandoffTransaction(context, profile, body, () => this.persist())
      case '/accept':
        return acceptReservation(context, profile, body)
      case '/invite':
        return createInvite(context, profile, body)
      case '/invite/claim':
        return claimInvite(context, profile, body)
      case '/crew/create':
        createCrew(context, profile, body)
        return networkSnapshot(context, profile)
      case '/crew/join':
        joinCrew(context, profile, body)
        return networkSnapshot(context, profile)
      case '/rival/create':
        createRivalry(context, profile, body)
        return networkSnapshot(context, profile)
      case '/inbox/read':
        markNotificationRead(context, profile, body)
        return networkSnapshot(context, profile)
      default:
        throw new ApiError('not_found', 404)
    }
  }

  /**
   * Called by /submit after replay, before the run is stored. Throws when the run no longer fits its leg; that refusal
   * is counted on the ledger alone, and a recorded run is counted when /submit writes it.
   */
  async onRun(run: Run, profile: Profile): Promise<void> {
    const now = Date.now()
    try {
      recordRun(this.context, run, profile)
    } catch (error) {
      if (error instanceof ApiError) {
        countRun(this.context.ops, 'refused', now)
        await this.saveOpsLedger()
      }
      throw error
    }
    countRun(this.context.ops, 'verified', now)
  }

  /** The holder's progress on their own baton leg. Network state is only read, so callers must not persist it. */
  reportProgress(profile: Profile, body: unknown): Promise<LegProgressResult> {
    return reportLegProgress(this.context, profile, body, Date.now())
  }

  /** The operator report. A read: it never writes state, traffic or the ledger. */
  opsReport(now: number): OpsReport {
    return opsReport(this.context, now)
  }

  /** Network state and the ops ledger always commit together. */
  async writeTo(transaction: DurableObjectTransaction): Promise<void> {
    await writeNetworkState(transaction, this.key, this.state)
    await writeOpsLedger(transaction, opsLedgerKey(this.key), this.context.ops)
  }

  /** Writes network and product state atomically and marks the network for archiving. */
  /** What a visit may change, captured before handling a read so `visitChanged` can decide whether to write. */
  visitMarker(playerId: string): VisitMarker {
    const member = this.state.members[playerId]
    return {
      exists: member !== undefined,
      days: member?.days.length ?? 0,
      country: member?.country ?? null,
      lastSeen: member?.lastSeen ?? 0,
      settledThrough: this.state.dailySettledThrough,
      dailyBests: Object.keys(this.state.dailyBests).length,
    }
  }

  visitChanged(playerId: string, before: VisitMarker, now: number): boolean {
    const after = this.visitMarker(playerId)
    return (
      !before.exists ||
      after.days !== before.days ||
      after.country !== before.country ||
      after.settledThrough !== before.settledThrough ||
      after.dailyBests !== before.dailyBests ||
      now - before.lastSeen >= LAST_SEEN_PERSIST_MS
    )
  }

  async persist(schedule = true): Promise<void> {
    this.state.version++
    this.state.dirty = true
    noteUnarchivedChange(this.context.ops, Date.now())
    await this.context.storage.transaction(async transaction => {
      await this.writeTo(transaction)
      await transaction.put('state', this.context.product)
    })
    if (schedule) await this.context.storage.setAlarm(Date.now() + RECONCILE_RETRY_MS)
  }

  /** Transfers awaiting chain verification. The room looks them up before entering its critical section. */
  submittedTransactionHashes(): string[] {
    return Object.values(this.state.intents).flatMap(intent => (intent.state === 'submitted' && intent.txHash ? [intent.txHash] : []))
  }

  /**
   * Alarm work, run inside the room's critical section: re-verify submitted transfers against lookups made beforehand,
   * expire unsent intents, strand idle batons, release lapsed reservations and settle ended Dailies.
   */
  async reconcile(lookups: ReadonlyMap<string, TransactionLookup>): Promise<void> {
    const { state } = this
    const now = Date.now()
    for (const intent of Object.values(state.intents)) {
      if (intent.state === 'prepared' && intent.expiresAt < now) intent.state = 'expired'
      const lookup = intent.state === 'submitted' && intent.txHash ? lookups.get(intent.txHash) : undefined
      if (lookup) await this.reconfirm(intent, lookup)
    }
    for (const baton of Object.values(state.batons)) {
      strandIdleBaton(state, baton, now)
      releaseLapsedReservation(this.context, baton, now)
    }
    settleDailies(state, now)
    await this.persist(false)
  }

  /** Runs outside the critical section; a stale copy is harmless because the archive is idempotent. */
  async archive(): Promise<boolean> {
    return archiveNetwork(this.context.env, this.state)
  }

  /**
   * Records a successful archive of `archivedVersion`. The archive flag clears, without counting a new version,
   * only when nothing was written after that snapshot; otherwise only the ledger notes the archive.
   */
  async markArchived(archivedVersion: number): Promise<void> {
    const caughtUp = this.state.version === archivedVersion
    noteArchived(this.context.ops, Date.now(), caughtUp)
    if (!caughtUp) return this.saveOpsLedger()
    this.state.dirty = false
    await this.context.storage.transaction(transaction => this.writeTo(transaction))
  }

  hasPendingWork(): boolean {
    const { state } = this
    if (state.dirty || Object.values(state.intents).some(isOpenIntent)) return true
    return Object.values(state.batons).some(baton => baton.status === 'active' || awaitsAcceptance(baton))
  }

  private async reconfirm(intent: NetworkHandoffIntent, lookup: TransactionLookup): Promise<void> {
    try {
      await confirmHandoff(this.context, intent, () => this.persist(), async () => lookup)
    } catch (error) {
      // Custody changes only after every lookup succeeded, so a failed confirmation leaves nothing half-applied.
      console.error('Handoff reconciliation deferred', intent.id, error instanceof Error ? error.message : 'unknown')
    }
  }

  private async track(body: unknown, actorId: string | null, now: number): Promise<TrackEventResult> {
    const input = trackBody.parse(body)
    const anonymous = actorId === null
    const actorKey = actorId ? `runner:${actorId}` : `visitor:${input.visitor ? await sha256Hex(input.visitor) : 'unidentified'}`
    const counted = countShare(this.context.traffic, { actorKey, anonymous, surface: input.surface }, now)
    if (counted) await this.saveTraffic()
    return { counted }
  }

  private async saveTraffic(): Promise<void> {
    await writeTraffic(this.context.storage, trafficStateKey(this.key), this.context.traffic)
  }

  private async saveOpsLedger(): Promise<void> {
    await writeOpsLedger(this.context.storage, opsLedgerKey(this.key), this.context.ops)
  }
}

function segmentAfter(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null
  const segment = path.slice(prefix.length)
  if (!segment || segment.includes('/')) throw new ApiError('not_found', 404)
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new ApiError('not_found', 404)
  }
}
