import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { PlayerPreferences } from '@nim-relay/shared'
import { MAX_TOUR_PREFERENCES } from './constants'
import { applyTourPreference, preferencesKey } from './preferences'
import { readNetworkState } from './state'
import { api, call, runner, stationRoom, type TestRunner } from './testing'

const NETWORK_KEY = 'network:TestAlbatross'

function saveTour(courier: TestRunner, body: Record<string, unknown>): Promise<PlayerPreferences> {
  return call<PlayerPreferences>(courier.cookie, '/network/preferences/tour', body)
}

describe('tour preferences', () => {
  it('ask for a session on both routes', async () => {
    // #when both preference routes are called signed out
    const read = await api('', '/network/preferences')
    const write = await api('', '/network/preferences/tour', { tourId: 'core', version: 'v1', state: 'completed' })
    // #then both are refused
    expect([read.status, write.status]).toEqual([401, 401])
  })

  it('start empty and stay with the runner who saved them', async () => {
    // #given two runners
    const [a, b] = [await runner(), await runner()]
    // #when one of them starts the product tour
    const saved = await saveTour(a, { tourId: 'core', version: 'v1', state: 'started' })
    // #then only that runner's preferences hold it, stamped by the server
    const theirs = await call<PlayerPreferences>(b.cookie, '/network/preferences')
    const mine = await call<PlayerPreferences>(a.cookie, '/network/preferences')
    expect({ state: saved.tours.core?.state, stamped: typeof saved.tours.core?.updatedAt, mine: mine.tours.core?.state, theirs }).toEqual({ state: 'started', stamped: 'number', mine: 'started', theirs: { tours: {} } })
  })

  it('keep completed or skipped over a later started, and let a later finish replace an earlier one', async () => {
    // #given a runner who skipped the product tour on one device
    const courier = await runner()
    await saveTour(courier, { tourId: 'core', version: 'v1', state: 'skipped' })
    // #when another device reports it started, then that it completed
    const afterStarted = await saveTour(courier, { tourId: 'core', version: 'v1', state: 'started' })
    const afterCompleted = await saveTour(courier, { tourId: 'core', version: 'v1', state: 'completed' })
    // #then started never replaced the skip, and the completion did
    expect([afterStarted.tours.core?.state, afterCompleted.tours.core?.state]).toEqual(['skipped', 'completed'])
  })

  it('let a newer tour version replace an older one, and never the reverse', async () => {
    // #given a runner who completed version 1 of the gameplay tutorial
    const courier = await runner()
    await saveTour(courier, { tourId: 'gameplay', version: 'v1', state: 'completed' })
    // #when version 2 starts, then an old client reports version 1 skipped
    const upgraded = await saveTour(courier, { tourId: 'gameplay', version: 'v2', state: 'started' })
    const stale = await saveTour(courier, { tourId: 'gameplay', version: 'v1', state: 'skipped' })
    // #then version 2 stands
    expect([upgraded.tours.gameplay, stale.tours.gameplay].map(tour => `${tour?.version}:${tour?.state}`)).toEqual(['v2:started', 'v2:started'])
  })

  it('refuse malformed ids, versions and states, and any field beyond them', async () => {
    // #given a runner
    const courier = await runner()
    const valid = { tourId: 'core', version: 'v1', state: 'completed' }
    // #when malformed records are sent
    const statuses = await Promise.all(
      [
        { ...valid, tourId: 'Core Tour' },
        { ...valid, tourId: 'x'.repeat(41) },
        { ...valid, version: '1' },
        { ...valid, version: 'v1000' },
        { ...valid, state: 'not_seen' },
        { ...valid, wallet: courier.p.walletAddress },
        { tourId: 'core', version: 'v1' },
      ].map(async body => (await api(courier.cookie, '/network/preferences/tour', body)).status),
    )
    // #then each is refused and nothing was saved
    expect({ statuses, saved: await call<PlayerPreferences>(courier.cookie, '/network/preferences') }).toEqual({ statuses: [400, 400, 400, 400, 400, 400, 400], saved: { tours: {} } })
  })

  it('are stored on the runner’s own key and leave network and product state untouched', async () => {
    // #given a runner whose first network visit is already recorded, and no alarm due during the check
    const courier = await runner()
    await call(courier.cookie, '/network')
    const room = stationRoom()
    const stored = () => runInDurableObject(room, async (_instance, state) => JSON.stringify({ network: await readNetworkState(state.storage, NETWORK_KEY), product: await state.storage.get('state') }))
    const alarm = await runInDurableObject(room, async (_instance, state) => {
      const scheduled = await state.storage.getAlarm()
      await state.storage.deleteAlarm()
      return scheduled
    })
    try {
      const before = await stored()
      // #when they save and read tour progress
      await saveTour(courier, { tourId: 'core', version: 'v1', state: 'completed' })
      await call(courier.cookie, '/network/preferences')
      // #then only their preferences key holds it
      const own = await runInDurableObject(room, (_instance, state) => state.storage.get<PlayerPreferences>(preferencesKey(NETWORK_KEY, courier.p.id)))
      expect({ unchanged: (await stored()) === before, own: own?.tours.core?.state }).toEqual({ unchanged: true, own: 'completed' })
    } finally {
      if (alarm !== null) await runInDurableObject(room, (_instance, state) => state.storage.setAlarm(alarm))
    }
  })
})

describe('tour preference records', () => {
  it('remember a bounded number of tours, giving way from the one changed longest ago', () => {
    // #given preferences already holding the most tours they keep
    const preferences: PlayerPreferences = { tours: {} }
    for (let index = 0; index < MAX_TOUR_PREFERENCES; index++) applyTourPreference(preferences, { tourId: `tour-${index}`, version: 'v1', state: 'completed' }, 1_000 + index)
    // #when one more tour is recorded
    const changed = applyTourPreference(preferences, { tourId: 'newest', version: 'v1', state: 'started' }, 9_000)
    // #then the oldest record made room for it
    const ids = Object.keys(preferences.tours)
    expect({ changed, count: ids.length, dropped: !ids.includes('tour-0'), kept: ids.includes('newest') }).toEqual({ changed: true, count: MAX_TOUR_PREFERENCES, dropped: true, kept: true })
  })

  it('report no change when a record would stay as it is', () => {
    // #given a completed tour
    const preferences: PlayerPreferences = { tours: { core: { version: 'v1', state: 'completed', updatedAt: 1_000 } } }
    // #when the same state or a started state arrives again
    const repeats = [applyTourPreference(preferences, { tourId: 'core', version: 'v1', state: 'completed' }, 2_000), applyTourPreference(preferences, { tourId: 'core', version: 'v1', state: 'started' }, 3_000)]
    // #then nothing changed, not even the time
    expect({ repeats, record: preferences.tours.core }).toEqual({ repeats: [false, false], record: { version: 'v1', state: 'completed', updatedAt: 1_000 } })
  })
})
