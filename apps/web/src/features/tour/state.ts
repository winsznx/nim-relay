import { useEffect, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  preferredTourRecord,
  TOUR_ID_PATTERN,
  TOUR_VERSION_PATTERN,
  tourVersionNumber,
  type PlayerPreferences,
  type TourPreferenceInput,
  type TourProgress,
  type TourProgressRecord,
} from '@nim-relay/shared'
import * as api from '../relays/api'

/**
 * How far a runner got through each guided tour, per tour version. This device's record is written first and read
 * synchronously; for a signed-in runner it is also kept on the server so another device doesn't offer the tour again.
 * Completed and skipped always beat started, here and on the server. Storage or server failures never block a tour.
 */

export type TourState = 'not_seen' | TourProgress

export interface TourStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Null when there is no storage to use. */
export type TourStorageAccess = () => TourStorage | null

export interface TourServer {
  load(): Promise<PlayerPreferences>
  save(input: TourPreferenceInput): Promise<PlayerPreferences>
}

export const TOUR_STORAGE_PREFIX = 'nim-relay-tour:'

export function tourStorageKey(tourId: string, version: string): string {
  return `${TOUR_STORAGE_PREFIX}${tourId}:${version}`
}

const PROGRESS: readonly TourProgress[] = ['started', 'completed', 'skipped']

function parseRecord(raw: string | null): TourProgressRecord | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const state: unknown = Reflect.get(value, 'state')
    const updatedAt: unknown = Reflect.get(value, 'updatedAt')
    const progress = PROGRESS.find(item => item === state)
    return progress && typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? { state: progress, updatedAt } : null
  } catch {
    // A corrupt entry counts as no progress, so the tour can be offered again.
    return null
  }
}

function parseKey(key: string): { tourId: string; version: string } | null {
  if (!key.startsWith(TOUR_STORAGE_PREFIX)) return null
  const [tourId = '', version = '', ...rest] = key.slice(TOUR_STORAGE_PREFIX.length).split(':')
  return rest.length === 0 && TOUR_ID_PATTERN.test(tourId) && TOUR_VERSION_PATTERN.test(version) ? { tourId, version } : null
}

export interface TourProgressStore {
  read(tourId: string, version: string): TourState
  readRecord(tourId: string, version: string): TourProgressRecord | null
  /**
   * Records progress and returns the state that stands afterwards: started never replaces completed or skipped.
   * `not_seen` forgets this device's record only; a server record comes back on the next sync.
   */
  write(tourId: string, version: string, state: TourState): TourState
  /** Brings server records onto this device, then sends the server what only this device knows. Rejects when loading fails. */
  sync(): Promise<void>
  /** Signed in: writes are also sent to the server. */
  setSyncEnabled(enabled: boolean): void
  subscribe(listener: () => void): () => void
}

export function createTourProgressStore({ storage, server, now = Date.now }: { storage: TourStorageAccess; server: TourServer | null; now?: () => number }): TourProgressStore {
  const listeners = new Set<() => void>()
  let syncEnabled = false

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const readRecord = (tourId: string, version: string): TourProgressRecord | null => {
    try {
      return parseRecord(storage()?.getItem(tourStorageKey(tourId, version)) ?? null)
    } catch {
      // Storage that throws on read holds nothing we can use.
      return null
    }
  }

  const saveRecord = (tourId: string, version: string, record: TourProgressRecord): void => {
    try {
      storage()?.setItem(tourStorageKey(tourId, version), JSON.stringify(record))
    } catch (error) {
      // Blocked or full storage: progress lasts for this visit only through the server, when signed in.
      console.warn('Tour progress was not saved on this device', error)
    }
  }

  const localEntries = (): { tourId: string; version: string; record: TourProgressRecord }[] => {
    try {
      const target = storage()
      if (!target) return []
      const entries: { tourId: string; version: string; record: TourProgressRecord }[] = []
      for (let index = 0; index < target.length; index++) {
        const parsed = parseKey(target.key(index) ?? '')
        const record = parsed ? readRecord(parsed.tourId, parsed.version) : null
        if (parsed && record) entries.push({ ...parsed, record })
      }
      return entries
    } catch {
      // Storage that throws while listing has nothing to send.
      return []
    }
  }

  /** Server records win where the merge rule says so. Returns whether this device's records changed. */
  const absorb = (preferences: PlayerPreferences): boolean => {
    let changed = false
    for (const [tourId, remote] of Object.entries(preferences.tours)) {
      if (!TOUR_ID_PATTERN.test(tourId) || !TOUR_VERSION_PATTERN.test(remote.version)) continue
      const local = readRecord(tourId, remote.version)
      const merged = preferredTourRecord(local, { state: remote.state, updatedAt: remote.updatedAt })
      if (!merged || merged.state === local?.state) continue
      saveRecord(tourId, remote.version, merged)
      changed = true
    }
    return changed
  }

  const push = async (input: TourPreferenceInput): Promise<void> => {
    if (!server) return
    try {
      if (absorb(await server.save(input))) emit()
    } catch (error) {
      console.warn('Tour progress was not saved to your runner', error)
    }
  }

  return {
    read: (tourId, version) => readRecord(tourId, version)?.state ?? 'not_seen',
    readRecord,
    write(tourId, version, state) {
      const current = readRecord(tourId, version)
      if (state === 'not_seen') {
        try {
          storage()?.removeItem(tourStorageKey(tourId, version))
        } catch (error) {
          console.warn('Tour progress was not cleared on this device', error)
        }
        if (current) emit()
        return 'not_seen'
      }
      const next = preferredTourRecord(current, { state, updatedAt: now() }) ?? current
      if (next && next.state !== current?.state) {
        saveRecord(tourId, version, next)
        emit()
        if (syncEnabled) void push({ tourId, version, state: next.state })
      }
      return next?.state ?? state
    },
    async sync() {
      if (!server) return
      const preferences = await server.load()
      if (absorb(preferences)) emit()
      for (const { tourId, version, record } of localEntries()) {
        const remote = preferences.tours[tourId]
        if (remote && tourVersionNumber(remote.version) > tourVersionNumber(version)) continue
        if (remote?.version === version && (remote.state === record.state || preferredTourRecord(remote, record) === remote)) continue
        await push({ tourId, version, state: record.state })
      }
    },
    setSyncEnabled(enabled) {
      syncEnabled = enabled
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const browserStorage: TourStorageAccess = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Reading window.localStorage itself throws when site data is blocked.
    return null
  }
}

const browserStore = createTourProgressStore({ storage: browserStorage, server: { load: api.loadPreferences, save: api.saveTourPreference } })

/** `not_seen` until this device or the runner's synced record says otherwise. */
export function readTourState(tourId: string, version: string): TourState {
  return browserStore.read(tourId, version)
}

/** Local first, then the server when signed in. Returns the state that stands; see `TourProgressStore.write`. */
export function writeTourState(tourId: string, version: string, state: TourState): TourState {
  return browserStore.write(tourId, version, state)
}

function subscribeToStore(listener: () => void): () => void {
  const unsubscribe = browserStore.subscribe(listener)
  // Another tab of the app finished or skipped the tour.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(TOUR_STORAGE_PREFIX)) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    unsubscribe()
    window.removeEventListener('storage', onStorage)
  }
}

export function useTourState(tourId: string, version: string): TourState {
  return useSyncExternalStore(
    subscribeToStore,
    () => browserStore.read(tourId, version),
    () => 'not_seen',
  )
}

/**
 * Keeps a signed-in runner's tour progress in step with the server: once per session and runner it loads their
 * records, then sends what only this device knows. `settled` is true when signed out or once that load finished,
 * successfully or not, so a first-run offer can wait for it without ever depending on it.
 */
export function useTourPreferencesSync(playerId: string | null): { settled: boolean } {
  useEffect(() => {
    browserStore.setSyncEnabled(playerId !== null)
    return () => browserStore.setSyncEnabled(false)
  }, [playerId])
  const query = useQuery({
    queryKey: ['tour-preferences', playerId],
    queryFn: async () => {
      await browserStore.sync()
      return true
    },
    enabled: playerId !== null,
    staleTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  return { settled: playerId === null || query.isSuccess || query.isError }
}
