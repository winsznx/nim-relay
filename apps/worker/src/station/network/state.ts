import type { BatonHandoff, NetworkHandoffIntent, RelayNote } from '@nim-relay/shared'
import { batonDisplayName, nextSerial } from './identity'
import { storedReason } from './reasons'
import { sectorSeed } from './route'
import type { BatonRecord, DailyEntry, Member, NetworkState } from './types'

/** Keeps each UTF-8 value well below the Durable Object per-value limit. */
const STATE_CHUNK_CHARS = 24_000
/** Durable Object storage reads and writes at most 128 keys per call. */
const STORAGE_KEYS_PER_CALL = 128
/** Batons created before route sectors keep their world and continue on a standard course. */
const LEGACY_ROUTE_TIER = 1

type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
type StoredMember = WithOptional<Member, 'completedRuns' | 'legs' | 'legMarks'>
type StoredBaton = WithOptional<BatonRecord, 'serial' | 'displayName' | 'route' | 'completedAt' | 'recipientReservedAt' | 'recipientAcceptedAt'>
type StoredHandoff = WithOptional<BatonHandoff, 'sector' | 'race' | 'rescue' | 'note'>
type StoredIntent = Omit<NetworkHandoffIntent, 'failure' | 'note'> & { failure: string | null; note?: RelayNote | null }
type StoredDailyEntry = WithOptional<DailyEntry, 'seed' | 'completed'>

/** Network state as written by any release so far: fields added later may be missing. */
export type StoredNetworkState = Omit<
  WithOptional<NetworkState, 'dailyBests' | 'dailySettledThrough' | 'serials' | 'echoes' | 'awards'>,
  'members' | 'batons' | 'handoffs' | 'intents' | 'daily'
> & {
  members: Record<string, StoredMember>
  batons: Record<string, StoredBaton>
  handoffs: StoredHandoff[]
  intents: Record<string, StoredIntent>
  daily: Record<string, Record<string, StoredDailyEntry>>
}

interface ChunkManifest {
  chunks: number
}

export function networkStateKey(network: string): string {
  return `network:${network}`
}

export function freshNetworkState(): NetworkState {
  return {
    version: 1,
    batons: {},
    handoffs: [],
    intents: {},
    notifications: {},
    invites: {},
    rivals: [],
    members: {},
    daily: {},
    dailyIssues: {},
    dailyBests: {},
    dailySettledThrough: null,
    crewDays: {},
    serials: {},
    echoes: {},
    awards: {},
    rematches: 0,
    dirty: false,
  }
}

export async function readNetworkState(storage: DurableObjectStorage, key: string): Promise<StoredNetworkState | null> {
  const stored = await storage.get<StoredNetworkState | ChunkManifest>(key)
  if (!stored) return null
  if (!('chunks' in stored)) return stored
  const keys = Array.from({ length: stored.chunks }, (_, index) => chunkKey(key, index))
  let serialized = ''
  for (const batch of inBatches(keys)) {
    const values = await storage.get<string>(batch)
    for (const segmentKey of batch) {
      const segment = values.get(segmentKey)
      if (segment === undefined) throw new Error('Relay archive segment missing')
      serialized += segment
    }
  }
  return JSON.parse(serialized) as StoredNetworkState
}

/** Must run inside a storage transaction: the manifest and its segments change together. */
export async function writeNetworkState(transaction: DurableObjectTransaction, key: string, state: NetworkState): Promise<void> {
  const serialized = JSON.stringify(state)
  const entries: [string, unknown][] = []
  for (let offset = 0; offset < serialized.length; offset += STATE_CHUNK_CHARS) {
    entries.push([chunkKey(key, entries.length), serialized.slice(offset, offset + STATE_CHUNK_CHARS)])
  }
  const manifest: ChunkManifest = { chunks: entries.length }
  entries.push([key, manifest])
  for (const batch of inBatches(entries)) await transaction.put(Object.fromEntries(batch))
}

/** Fills fields introduced after the state was written. Deterministic, so unsaved reads agree with the next write. */
export function normalizeNetworkState(stored: StoredNetworkState): NetworkState {
  const state: NetworkState = {
    ...stored,
    members: mapValues(stored.members, normalizeMember),
    batons: {},
    handoffs: stored.handoffs.map(normalizeHandoff),
    intents: mapValues(stored.intents, intent => ({ ...intent, failure: storedReason(intent.failure), note: intent.note ?? null })),
    daily: mapValues(stored.daily, (entries, date) => mapValues(entries, entry => normalizeDailyEntry(entry, date))),
    dailyBests: stored.dailyBests ?? {},
    dailySettledThrough: stored.dailySettledThrough ?? null,
    serials: { ...stored.serials },
    echoes: stored.echoes ?? {},
    awards: stored.awards ?? {},
  }
  state.batons = normalizeBatons(stored.batons, state)
  return state
}

function normalizeMember(member: StoredMember): Member {
  return { ...member, completedRuns: member.completedRuns ?? 0, legs: member.legs ?? 0, legMarks: member.legMarks ?? {} }
}

function normalizeHandoff(handoff: StoredHandoff): BatonHandoff {
  return { ...handoff, sector: handoff.sector ?? null, race: handoff.race ?? null, rescue: handoff.rescue ?? false, note: handoff.note ?? null }
}

function normalizeDailyEntry(entry: StoredDailyEntry, date: string): DailyEntry {
  return { ...entry, seed: entry.seed ?? `daily-${date}-v4`, completed: entry.completed ?? entry.score > 0 }
}

/** Serials follow creation order within each mode. */
function normalizeBatons(stored: Record<string, StoredBaton>, state: NetworkState): Record<string, BatonRecord> {
  const ordered = Object.values(stored).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  for (const baton of ordered) {
    if (baton.serial !== undefined) state.serials[baton.mode] = Math.max(state.serials[baton.mode] ?? 0, baton.serial)
  }
  const batons: Record<string, BatonRecord> = {}
  for (const baton of ordered) batons[baton.id] = normalizeBaton(baton, state)
  return batons
}

function normalizeBaton(baton: StoredBaton, state: NetworkState): BatonRecord {
  const serial = baton.serial ?? nextSerial(state, baton.mode)
  const reserved = baton.recipientId !== null
  const acceptedBefore = reserved && (baton.handoffCount > 0 || invitationClaimed(state, baton))
  return {
    ...baton,
    serial,
    displayName: baton.displayName ?? batonDisplayName(baton.mode, serial, baton.title),
    route: baton.route ?? { seed: sectorSeed(baton.code, 0), world: baton.world, tier: LEGACY_ROUTE_TIER, sector: 0, sectorStartedLeg: baton.handoffCount },
    completedAt: baton.completedAt !== undefined ? baton.completedAt : baton.status === 'completed' ? baton.updatedAt : null,
    recipientReservedAt: baton.recipientReservedAt !== undefined ? baton.recipientReservedAt : reserved ? baton.updatedAt : null,
    recipientAcceptedAt: baton.recipientAcceptedAt !== undefined ? baton.recipientAcceptedAt : acceptedBefore ? baton.updatedAt : null,
  }
}

function invitationClaimed(state: NetworkState, baton: StoredBaton): boolean {
  return Object.values(state.invites).some(invite => invite.batonId === baton.id && invite.claimedBy === baton.recipientId)
}

function chunkKey(key: string, index: number): string {
  return `${key}:chunk:${index}`
}

function inBatches<T>(items: readonly T[]): T[][] {
  const batches: T[][] = []
  for (let offset = 0; offset < items.length; offset += STORAGE_KEYS_PER_CALL) batches.push(items.slice(offset, offset + STORAGE_KEYS_PER_CALL))
  return batches
}

function mapValues<T, U>(record: Record<string, T>, map: (value: T, key: string) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value, key)]))
}
