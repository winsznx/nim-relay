import { runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { paymentAddress } from '@nim-relay/relay-protocol'
import type { NetworkSnapshot, OpsReport, OpsTour, TrackEventResult } from '@nim-relay/shared'
import { ANONYMOUS_TOUR_EVENTS_PER_DAY, DAY_MS, MAX_TRACKED_TOUR_STEPS, MAX_TRACKED_TOURS, OPS_WINDOW_DAYS, TOUR_EVENTS_PER_ACTOR_PER_DAY } from './constants'
import { readNetworkState } from './state'
import { countTourEvent, entrySection, freshTourLedger, onboardingReport, type TourEventRecord } from './tour-ledger'
import { call, operator, runner, stationRoom } from './testing'

const NETWORK_KEY = 'network:TestAlbatross'
const NOW = Date.UTC(2026, 8, 17, 12)
const TOUR_ID = 'core'

function track(body: unknown, cookie = ''): Promise<Response> {
  return SELF.fetch('https://example.com/api/station/network/track', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

async function counted(body: unknown, cookie = ''): Promise<boolean> {
  const response = await track(body, cookie)
  if (!response.ok) throw new Error(`track failed with ${response.status}`)
  return ((await response.json()) as TrackEventResult).counted
}

async function onboarding(tourId: string): Promise<OpsTour | undefined> {
  const report = await call<OpsReport>((await operator()).cookie, '/network/ops')
  return report.onboarding.tours.find(tour => tour.tourId === tourId && tour.version === 'v1')
}

const tourEvent = (event: string, extra: Record<string, unknown> = {}) => ({ kind: 'tour', event, tourId: TOUR_ID, version: 'v1', ...extra })

describe('tour event tracking', () => {
  it('counts walkthroughs into the operator’s onboarding funnel', async () => {
    // #given a visitor, a signed-in runner and the funnel as it stands
    const visitor = crypto.randomUUID()
    const courier = await runner()
    const before = await onboarding(TOUR_ID)
    // #when the visitor is offered the tour, starts it from an invitation, views and completes step 1 and leaves at step 2,
    // and the runner declines the offer, replays the tour and reports a missing target on step 3
    const results = [
      await counted(tourEvent('offered', { visitor, entryRoute: '/invite/9f8e7d6c5b4a' }), ''),
      await counted(tourEvent('started', { visitor, entryRoute: '/invite/9f8e7d6c5b4a?from=qr' })),
      await counted(tourEvent('step_viewed', { visitor, stepId: 'relay-world', stepNumber: 1 })),
      await counted(tourEvent('step_completed', { visitor, stepId: 'relay-world', stepNumber: 1 })),
      await counted(tourEvent('step_viewed', { visitor, stepId: 'featured-relay', stepNumber: 2 })),
      await counted(tourEvent('skipped', { visitor, stepId: 'featured-relay', stepNumber: 2 })),
      await counted(tourEvent('skipped'), courier.cookie),
      await counted(tourEvent('replayed', { entryRoute: '/profile' }), courier.cookie),
      await counted(tourEvent('target_missing', { stepId: 'open-journey', stepNumber: 3 }), courier.cookie),
    ]
    const after = await onboarding(TOUR_ID)
    // #then every event counted where it belongs
    const delta = (pick: (tour: OpsTour | undefined) => number) => pick(after) - pick(before)
    const step = (tour: OpsTour | undefined, stepId: string) => tour?.steps.find(item => item.stepId === stepId)
    expect({
      results,
      totals: {
        offered: delta(tour => tour?.offered ?? 0),
        started: delta(tour => tour?.started ?? 0),
        skipped: delta(tour => tour?.skipped ?? 0),
        declined: delta(tour => tour?.declined ?? 0),
        replayed: delta(tour => tour?.replayed ?? 0),
        completed: delta(tour => tour?.completed ?? 0),
      },
      world: { viewed: delta(tour => step(tour, 'relay-world')?.viewed ?? 0), completed: delta(tour => step(tour, 'relay-world')?.completed ?? 0) },
      relay: { viewed: delta(tour => step(tour, 'featured-relay')?.viewed ?? 0), skippedHere: delta(tour => step(tour, 'featured-relay')?.skippedHere ?? 0) },
      journeyMissing: delta(tour => step(tour, 'open-journey')?.missing ?? 0),
      order: after?.steps.map(item => item.stepNumber),
      invitations: delta(tour => tour?.entries.find(entry => entry.section === '/invite')?.started ?? 0),
    }).toEqual({
      results: [true, true, true, true, true, true, true, true, true],
      totals: { offered: 1, started: 1, skipped: 1, declined: 1, replayed: 1, completed: 0 },
      world: { viewed: 1, completed: 1 },
      relay: { viewed: 1, skippedHere: 1 },
      journeyMissing: 1,
      order: [1, 2, 3],
      invitations: 1,
    })
  })

  it('refuses events that break the schema, carry other data or leave out their step', async () => {
    // #given a well-formed step event
    const valid = tourEvent('step_viewed', { stepId: 'relay-world', stepNumber: 1, visitor: crypto.randomUUID() })
    // #when malformed variants arrive
    const malformed = [
      { ...valid, event: 'hovered' },
      { ...valid, tourId: 'Core' },
      { ...valid, version: 'one' },
      { ...valid, stepId: 'Relay World' },
      { ...valid, stepNumber: 0 },
      { ...valid, stepNumber: 1.5 },
      { ...valid, entryRoute: 'https://nimrelay.xyz/' },
      { ...valid, wallet: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' },
      { ...valid, deviceId: 'device' },
      tourEvent('step_viewed'),
      tourEvent('skipped', { stepId: 'relay-world' }),
    ]
    const statuses = await Promise.all(malformed.map(async body => (await track(body)).status))
    // #then each is refused as a bad request
    expect(statuses).toEqual(malformed.map(() => 400))
  })

  it('keeps tour events on their own budget and off the network state', async () => {
    // #given a signed-in runner already known to the network, with no alarm due during the check
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
      // #when they send more tour events than the daily share cap allows shares
      const tours = []
      for (let index = 0; index < 25; index++) tours.push(await counted(tourEvent('step_viewed', { stepId: 'relay-world', stepNumber: 1 }), courier.cookie))
      const unchanged = (await stored()) === before
      // #then all of them count, the network state is untouched and their share still counts
      const share = await counted({ kind: 'share', surface: 'result' }, courier.cookie)
      expect({ tours: tours.every(Boolean), unchanged, share }).toEqual({ tours: true, unchanged: true, share: true })
    } finally {
      if (alarm !== null) await runInDurableObject(room, (_instance, state) => state.storage.setAlarm(alarm))
    }
  })

  it('names no visitor key, runner, wallet or dynamic path in the operator report', async () => {
    // #given a runner and a visitor who took the tour from a runner page and an invitation
    const courier = await runner()
    const visitor = crypto.randomUUID()
    const invitation = 'a1b2c3d4e5f60718293a4b5c'
    await counted(tourEvent('started', { entryRoute: `/runner/${courier.p.handle}` }), courier.cookie)
    await counted(tourEvent('started', { visitor, entryRoute: `/invite/${invitation}` }))
    // #when the operator reads the report
    const text = await (await SELF.fetch('https://example.com/api/station/network/ops', { headers: { Cookie: (await operator()).cookie } })).text()
    // #then only sections identify where tours started
    const identifying = [visitor, courier.p.id, courier.p.handle, courier.p.walletAddress, paymentAddress(courier.p.walletAddress), invitation]
    expect({ leaked: identifying.filter(value => text.includes(value)), sections: ['"/runner"', '"/invite"'].every(section => text.includes(section)) }).toEqual({ leaked: [], sections: true })
  })

  it('leaves the public network snapshot as it was', async () => {
    // #given the public snapshot
    const before = await call<NetworkSnapshot>('', '/network/public')
    // #when a visitor sends tour events
    await counted(tourEvent('offered', { visitor: crypto.randomUUID() }))
    // #then no public metric moved
    expect((await call<NetworkSnapshot>('', '/network/public')).metrics).toEqual(before.metrics)
  })
})

function record(overrides: Partial<TourEventRecord> = {}): TourEventRecord {
  return { event: 'step_viewed', tourId: 'core', version: 'v1', step: { id: 'relay-world', number: 1 }, entry: null, ...overrides }
}

describe('tour event caps and aggregation', () => {
  it('stop counting an actor past the daily cap, and start again after UTC midnight', () => {
    // #given a runner who already sent the most tour events a day allows
    const ledger = freshTourLedger(NOW)
    const actor = { key: 'runner:p-1', anonymous: false }
    for (let index = 0; index < TOUR_EVENTS_PER_ACTOR_PER_DAY; index++) countTourEvent(ledger, record(), actor, NOW)
    // #when they send one more today and one tomorrow
    const today = countTourEvent(ledger, record(), actor, NOW)
    const tomorrow = countTourEvent(ledger, record(), actor, NOW + DAY_MS)
    // #then only tomorrow's counts
    expect([today, tomorrow]).toEqual([false, true])
  })

  it('stop counting signed-out devices past the network-wide cap while runners still count', () => {
    // #given signed-out devices that together used the anonymous daily cap
    const ledger = freshTourLedger(NOW)
    for (let index = 0; index < ANONYMOUS_TOUR_EVENTS_PER_DAY; index++) countTourEvent(ledger, record(), { key: `visitor:${Math.floor(index / 100)}`, anonymous: true }, NOW)
    // #when a fresh device and a runner send an event
    const device = countTourEvent(ledger, record(), { key: 'visitor:fresh', anonymous: true }, NOW)
    const courier = countTourEvent(ledger, record(), { key: 'runner:p-2', anonymous: false }, NOW)
    // #then only the runner's counts
    expect([device, courier]).toEqual([false, true])
  })

  it('count a bounded number of tours and steps per day', () => {
    // #given a day that already counted the most tours, and a tour with the most steps
    const ledger = freshTourLedger(NOW)
    const actor = { key: 'runner:p-3', anonymous: false }
    for (let index = 0; index < MAX_TRACKED_TOURS; index++) countTourEvent(ledger, record({ tourId: `tour-${index}` }), actor, NOW)
    for (let index = 0; index < MAX_TRACKED_TOUR_STEPS; index++) countTourEvent(ledger, record({ tourId: 'tour-0', step: { id: `step-${index}`, number: index + 1 } }), actor, NOW)
    // #when another tour and another step arrive, and a known step again
    const results = [
      countTourEvent(ledger, record({ tourId: 'one-too-many' }), actor, NOW),
      countTourEvent(ledger, record({ tourId: 'tour-0', step: { id: 'one-too-many', number: 25 } }), actor, NOW),
      countTourEvent(ledger, record({ tourId: 'tour-0', step: { id: 'step-3', number: 4 } }), actor, NOW),
    ]
    // #then only the known step counts
    expect(results).toEqual([false, false, true])
  })

  it('reduce where a visit started to its first path segment', () => {
    // #when entry routes of every kind are reduced
    const sections = ['/', '/?ref=x', '/invite/secret-token', '/leg/ABC123DEF0?ghost=run', '/relay/:code', '/unknown/path', '/#hash'].map(route => entrySection(route))
    // #then only known sections survive
    expect(sections).toEqual(['/', '/', '/invite', '/leg', '/relay', 'other', '/'])
  })

  it('report the operator window only, with steps in tour order', () => {
    // #given events today and events older than the window
    const ledger = freshTourLedger(NOW - OPS_WINDOW_DAYS * DAY_MS)
    const actor = { key: 'runner:p-4', anonymous: false }
    countTourEvent(ledger, record({ event: 'started', step: null, entry: '/' }), actor, NOW - OPS_WINDOW_DAYS * DAY_MS)
    countTourEvent(ledger, record({ event: 'started', step: null, entry: '/invite' }), actor, NOW)
    countTourEvent(ledger, record({ step: { id: 'daily', number: 9 } }), actor, NOW)
    countTourEvent(ledger, record({ step: { id: 'relay-world', number: 1 } }), actor, NOW)
    // #when the report is built
    const [tour] = onboardingReport(ledger, NOW).tours
    // #then the older day is left out and steps follow their numbers
    expect({ started: tour?.started, steps: tour?.steps.map(step => step.stepId), entries: tour?.entries }).toEqual({ started: 1, steps: ['relay-world', 'daily'], entries: [{ section: '/invite', started: 1 }] })
  })
})
