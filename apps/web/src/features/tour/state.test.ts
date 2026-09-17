import { describe, expect, it, vi } from 'vitest'
import type { PlayerPreferences, TourPreferenceInput } from '@nim-relay/shared'
import { createTourProgressStore, tourStorageKey, type TourServer, type TourStorage } from './state'

function memoryStorage(initial: Record<string, string> = {}): TourStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    get length() {
      return values.size
    },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: key => {
      values.delete(key)
    },
  }
}

const throwing: TourStorage = {
  length: 1,
  key: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  },
  removeItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
}

/** A server that merges like the Worker and records every save. */
function fakeServer(initial: PlayerPreferences = { tours: {} }, clock = () => 50_000): TourServer & { saves: TourPreferenceInput[]; preferences: PlayerPreferences } {
  const preferences: PlayerPreferences = structuredClone(initial)
  const saves: TourPreferenceInput[] = []
  return {
    saves,
    preferences,
    load: async () => structuredClone(preferences),
    save: async input => {
      saves.push(input)
      const current = preferences.tours[input.tourId]
      const finished = (state: string) => state !== 'started'
      if (!current || current.version !== input.version || finished(input.state) || !finished(current.state)) preferences.tours[input.tourId] = { version: input.version, state: input.state, updatedAt: clock() }
      return structuredClone(preferences)
    },
  }
}

const record = (state: string, updatedAt: number) => JSON.stringify({ state, updatedAt })

describe('tour progress on this device', () => {
  it('reads not_seen until something is recorded, per tour and version', () => {
    const storage = memoryStorage()
    const store = createTourProgressStore({ storage: () => storage, server: null, now: () => 1_000 })
    expect(store.read('core', 'v1')).toBe('not_seen')
    expect(store.write('core', 'v1', 'started')).toBe('started')
    expect(storage.values.get('nim-relay-tour:core:v1')).toBe(record('started', 1_000))
    expect([store.read('core', 'v1'), store.read('core', 'v2'), store.read('gameplay', 'v1')]).toEqual(['started', 'not_seen', 'not_seen'])
  })

  it('never lets started replace completed or skipped, and lets a later finish replace an earlier one', () => {
    let time = 1_000
    const storage = memoryStorage()
    const store = createTourProgressStore({ storage: () => storage, server: null, now: () => time++ })
    store.write('core', 'v1', 'skipped')
    expect(store.write('core', 'v1', 'started')).toBe('skipped')
    expect(store.write('core', 'v1', 'completed')).toBe('completed')
    expect(store.read('core', 'v1')).toBe('completed')
  })

  it('forgets this device’s record when not_seen is written', () => {
    const storage = memoryStorage({ [tourStorageKey('gameplay', 'v1')]: record('completed', 5) })
    const store = createTourProgressStore({ storage: () => storage, server: null })
    expect(store.write('gameplay', 'v1', 'not_seen')).toBe('not_seen')
    expect(store.read('gameplay', 'v1')).toBe('not_seen')
  })

  it('treats corrupt or foreign entries as no progress', () => {
    const storage = memoryStorage({
      [tourStorageKey('core', 'v1')]: '{"state":"finished","updatedAt":1}',
      [tourStorageKey('core', 'v2')]: 'not json',
      [tourStorageKey('core', 'v3')]: '"completed"',
    })
    const store = createTourProgressStore({ storage: () => storage, server: null })
    expect(['v1', 'v2', 'v3'].map(version => store.read('core', version))).toEqual(['not_seen', 'not_seen', 'not_seen'])
  })

  it('survives storage that throws or is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      for (const storage of [() => throwing, () => null]) {
        const store = createTourProgressStore({ storage, server: null })
        expect(store.read('core', 'v1')).toBe('not_seen')
        expect(store.write('core', 'v1', 'skipped')).toBe('skipped')
        expect(store.write('core', 'v1', 'not_seen')).toBe('not_seen')
      }
    } finally {
      warn.mockRestore()
    }
  })

  it('tells subscribers when the standing state changes, and only then', () => {
    const storage = memoryStorage()
    const store = createTourProgressStore({ storage: () => storage, server: null })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.write('core', 'v1', 'started')
    store.write('core', 'v1', 'started')
    store.write('core', 'v1', 'completed')
    store.write('core', 'v1', 'started')
    unsubscribe()
    store.write('core', 'v1', 'skipped')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('tour progress on the server', () => {
  it('brings a finished tour from another device onto this one', async () => {
    const storage = memoryStorage({ [tourStorageKey('core', 'v1')]: record('started', 9_000) })
    const server = fakeServer({ tours: { core: { version: 'v1', state: 'completed', updatedAt: 2_000 }, gameplay: { version: 'v1', state: 'skipped', updatedAt: 3_000 } } })
    const store = createTourProgressStore({ storage: () => storage, server })
    await store.sync()
    expect([store.read('core', 'v1'), store.read('gameplay', 'v1')]).toEqual(['completed', 'skipped'])
    expect(server.saves).toEqual([])
  })

  it('sends the server what only this device knows, and nothing it already has', async () => {
    const storage = memoryStorage({
      [tourStorageKey('core', 'v1')]: record('skipped', 1_000),
      [tourStorageKey('gameplay', 'v1')]: record('completed', 1_000),
      [tourStorageKey('relay', 'v1')]: record('started', 1_000),
    })
    const server = fakeServer({ tours: { gameplay: { version: 'v1', state: 'completed', updatedAt: 4_000 }, relay: { version: 'v2', state: 'started', updatedAt: 4_000 } } })
    const store = createTourProgressStore({ storage: () => storage, server })
    await store.sync()
    expect(server.saves).toEqual([{ tourId: 'core', version: 'v1', state: 'skipped' }])
  })

  it('sends writes only while signed in, and takes the server’s answer when it knows better', async () => {
    const storage = memoryStorage()
    const server = fakeServer({ tours: { core: { version: 'v1', state: 'completed', updatedAt: 2_000 } } })
    const store = createTourProgressStore({ storage: () => storage, server, now: () => 10_000 })
    store.write('gameplay', 'v1', 'started')
    expect(server.saves).toEqual([])
    store.setSyncEnabled(true)
    store.write('core', 'v1', 'started')
    await vi.waitFor(() => expect(store.read('core', 'v1')).toBe('completed'))
    expect(server.saves).toEqual([{ tourId: 'core', version: 'v1', state: 'started' }])
  })

  it('never blocks progress when the server fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const storage = memoryStorage()
      const failing: TourServer = { load: () => Promise.reject(new Error('offline')), save: () => Promise.reject(new Error('offline')) }
      const store = createTourProgressStore({ storage: () => storage, server: failing })
      store.setSyncEnabled(true)
      expect(store.write('core', 'v1', 'completed')).toBe('completed')
      await expect(store.sync()).rejects.toThrow('offline')
      await vi.waitFor(() => expect(warn).toHaveBeenCalled())
      expect(store.read('core', 'v1')).toBe('completed')
    } finally {
      warn.mockRestore()
    }
  })
})
