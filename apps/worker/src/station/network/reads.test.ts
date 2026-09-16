import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { NetworkSnapshot, StationSnapshot } from '@nim-relay/shared'
import { readNetworkState } from './state'
import { api, runner, stationRoom } from './testing'

const NETWORK_KEY = 'network:TestAlbatross'

async function storedState(): Promise<string> {
  return runInDurableObject(stationRoom(), async (_instance, state) => JSON.stringify({ network: await readNetworkState(state.storage, NETWORK_KEY), product: await state.storage.get('state') }))
}

describe('snapshot reads', () => {
  it('writes a first visit, then leaves stored state untouched on repeat reads', async () => {
    // #given a runner whose first visit is recorded
    const courier = await runner()
    const first = await api(courier.cookie, '/network')
    const afterFirst = await storedState()
    // #when they refresh the network and station snapshots again
    const again = await api(courier.cookie, '/network')
    const station = await api(courier.cookie, '')
    const afterRepeat = await storedState()
    // #then both reads succeed and nothing was rewritten
    const snapshot = (await again.json()) as NetworkSnapshot
    const stationSnapshot = (await station.json()) as StationSnapshot
    expect({
      statuses: [first.status, again.status, station.status],
      member: snapshot.playerId === courier.p.id,
      profile: stationSnapshot.profile.id === courier.p.id,
      unchanged: afterRepeat === afterFirst,
      recorded: afterFirst.includes(courier.p.id),
    }).toEqual({ statuses: [200, 200, 200], member: true, profile: true, unchanged: true, recorded: true })
  })
})
