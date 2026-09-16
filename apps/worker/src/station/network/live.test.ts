import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import { LIVE_LEG_WINDOW_MS, type BatonDetail, type BatonLive, type IssuedRace, type LegProgressInput, type NetworkSnapshot } from '@nim-relay/shared'
import { LIVE_BROADCAST_INTERVAL_MS, LIVE_REPORT_INTERVAL_MS } from './constants'
import { LiveUpdates } from './live-updates'
import { isPlausibleProgress } from './progress'
import { readNetworkState } from './state'
import { api, botTrace, call, createBaton, IDLE_TRACE, joinNetwork, passBaton, relayLegConfig, runner, stationRoom, type TestRunner } from './testing'

const NETWORK_KEY = 'network:TestAlbatross'
const LIVE_PATH = '/network/leg/progress'

interface HeldLeg {
  courier: TestRunner
  batonId: string
  issued: IssuedRace
}

async function holdLeg(title: string): Promise<HeldLeg> {
  const courier = await runner()
  const journey = await createBaton(courier, { mode: 'global', title })
  const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
  return { courier, batonId: journey.baton.id, issued }
}

/** What the holder's client reports after `ticks` ticks of the hands-off courier on the issued course. */
function reportAfter(issued: IssuedRace, ticks: number, ghostDeltaMs: number | null = null): LegProgressInput {
  let state = relayLeg.createState(relayLegConfig(issued.config))
  while (state.tick < ticks) state = relayLeg.step(state, { steer: 0, action: 0 })
  return { runId: issued.runId, tick: state.tick, dist: state.dist, finishDist: state.track.finishDist, ghostDeltaMs, path: state.path }
}

async function report(courier: TestRunner, input: unknown): Promise<[number, unknown]> {
  const response = await api(courier.cookie, LIVE_PATH, input)
  return [response.status, await response.json()]
}

async function liveOnPage(batonId: string): Promise<{ detail: BatonLive | null; baton: BatonLive | null | undefined; snapshot: BatonLive | null | undefined }> {
  const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
  const snapshot = await call<NetworkSnapshot>('', '/network/public')
  return { detail: detail.live, baton: detail.baton.live, snapshot: snapshot.batons.find(baton => baton.id === batonId)?.live }
}

function expectedLive(leg: HeldLeg, input: LegProgressInput, updatedAt: number, now: number): BatonLive {
  return {
    runnerName: leg.courier.p.displayName,
    runnerHandle: leg.courier.p.handle,
    progress: Math.round((input.dist / input.finishDist) * 10_000) / 10_000,
    ghostDeltaMs: input.ghostDeltaMs,
    world: relayLegConfig(leg.issued.config).world,
    sector: 0,
    updatedAt,
    ageMs: now - updatedAt,
  }
}

describe('live leg progress', () => {
  let start: number

  beforeEach(() => {
    start = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(start)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the holder’s latest report on the baton page and in snapshots', async () => {
    // #given a holder racing an issued leg
    const leg = await holdLeg('Watched live')
    const input = reportAfter(leg.issued, 600)
    // #when their client reports progress and a spectator looks two seconds later
    const accepted = await report(leg.courier, input)
    vi.setSystemTime(start + 2_000)
    const live = await liveOnPage(leg.batonId)
    // #then every surface shows the report as it was sent, two seconds old
    const expected = expectedLive(leg, input, start, start + 2_000)
    expect({ accepted, live }).toEqual({ accepted: [200, { accepted: true }], live: { detail: expected, baton: expected, snapshot: expected } })
  })

  it('keeps the ghost gap of a leg raced against a ghost', async () => {
    // #given the second runner of a baton, racing the first runner's ghost
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Chasing a ghost' })
    await passBaton(a, b, journey.baton.id)
    const issued = await call<IssuedRace>(b.cookie, '/network/issue', { batonId: journey.baton.id })
    // #when they report trailing the ghost by 310 ms
    await report(b, reportAfter(issued, 600, 310))
    // #then the gap is shown with the ghost the page names
    const detail = await call<BatonDetail>('', `/network/batons/${journey.baton.id}`)
    expect([detail.live?.ghostDeltaMs, detail.live?.runnerHandle, detail.ghost?.runId]).toEqual([310, b.p.handle, issued.ghost?.runId])
  })

  it('refuses reports on a leg the runner was not issued', async () => {
    // #given a holder's issued leg and another runner
    const leg = await holdLeg('Not yours')
    const other = await runner()
    // #when the other runner reports on it, and on a run that was never issued
    const foreign = await report(other, reportAfter(leg.issued, 600))
    const unknown = await report(other, { ...reportAfter(leg.issued, 600), runId: crypto.randomUUID() })
    // #then both are unknown to them and nothing is live
    expect({ foreign, unknown, live: (await liveOnPage(leg.batonId)).detail }).toEqual({ foreign: [404, { error: 'run_not_found' }], unknown: [404, { error: 'run_not_found' }], live: null })
  })

  it('refuses practice and Daily runs', async () => {
    // #given a holder practising their baton's course, and a runner on the official Daily
    const leg = await holdLeg('Practice is private')
    const practice = await call<IssuedRace>(leg.courier.cookie, '/network/issue', { batonId: leg.batonId, practice: true })
    const dailyRunner = await runner()
    const daily = await call<IssuedRace>(dailyRunner.cookie, '/network/issue', { daily: true })
    // #when either reports progress
    const practiceReport = await report(leg.courier, reportAfter(practice, 600))
    const dailyReport = await report(dailyRunner, reportAfter(daily, 600))
    // #then neither is a baton leg
    expect([practiceReport, dailyReport]).toEqual([
      [409, { error: 'not_a_baton_leg' }],
      [409, { error: 'not_a_baton_leg' }],
    ])
  })

  it('ignores a report sooner than 1.5 s after the run’s last accepted one', async () => {
    // #given an accepted report
    const leg = await holdLeg('Rate limited')
    await report(leg.courier, reportAfter(leg.issued, 600))
    // #when the next arrives after one second, and another once the interval has passed
    vi.setSystemTime(start + 1_000)
    const early = await report(leg.courier, reportAfter(leg.issued, 660))
    const afterEarly = (await liveOnPage(leg.batonId)).detail?.updatedAt
    vi.setSystemTime(start + LIVE_REPORT_INTERVAL_MS)
    const onTime = await report(leg.courier, reportAfter(leg.issued, 690))
    const afterOnTime = (await liveOnPage(leg.batonId)).detail?.updatedAt
    // #then only the early one is ignored
    expect({ early, afterEarly, onTime, afterOnTime }).toEqual({ early: [200, { accepted: false }], afterEarly: start, onTime: [200, { accepted: true }], afterOnTime: start + LIVE_REPORT_INTERVAL_MS })
  })

  it.each<[string, (input: LegProgressInput) => unknown, string]>([
    ['a distance past the finish', input => ({ ...input, dist: input.finishDist + 1 }), 'bad_request'],
    ['a tick past the longest leg', input => ({ ...input, tick: relayLeg.MAX_TICKS + 1 }), 'bad_request'],
    ['a malformed run id', input => ({ ...input, runId: 'run-1' }), 'bad_request'],
    ['a ghost gap longer than a leg', input => ({ ...input, ghostDeltaMs: 91_000 }), 'bad_request'],
    ['another course’s finish line', input => ({ ...input, finishDist: input.finishDist + 65_536 }), 'invalid_progress'],
    ['a distance no courier reaches in its ticks', input => ({ ...input, tick: 10 }), 'invalid_progress'],
    ['a fork path before the fork', input => ({ ...input, path: 'risk' }), 'invalid_progress'],
    ['a ghost gap on a leg without a ghost', input => ({ ...input, ghostDeltaMs: 120 }), 'invalid_progress'],
  ])('refuses %s', async (_case, change, error) => {
    // #given a holder's issued leg
    const leg = await holdLeg('Out of bounds')
    // #when the report is out of bounds
    const refused = await report(leg.courier, change(reportAfter(leg.issued, 600)))
    // #then it is refused and nothing is live
    expect({ refused, live: (await liveOnPage(leg.batonId)).detail }).toEqual({ refused: [400, { error }], live: null })
  })

  it('stops showing a leg 8 s after its latest report', async () => {
    // #given an accepted report
    const leg = await holdLeg('Gone quiet')
    await report(leg.courier, reportAfter(leg.issued, 600))
    // #when spectators look just before and at 8 s
    vi.setSystemTime(start + LIVE_LEG_WINDOW_MS - 1)
    const before = await liveOnPage(leg.batonId)
    vi.setSystemTime(start + LIVE_LEG_WINDOW_MS)
    const after = await liveOnPage(leg.batonId)
    // #then it is live only before
    expect({ before: [before.detail?.ageMs, before.snapshot?.ageMs], after }).toEqual({
      before: [LIVE_LEG_WINDOW_MS - 1, LIVE_LEG_WINDOW_MS - 1],
      after: { detail: null, baton: null, snapshot: null },
    })
  })

  it('refuses reports once the issue expired, and reconciliation deletes its stored report', async () => {
    // #given an accepted report
    const leg = await holdLeg('Ticket ran out')
    await report(leg.courier, reportAfter(leg.issued, 600))
    // #when the issue expires, the holder reports again and reconciliation runs
    vi.setSystemTime(leg.issued.expiresAt + 1)
    const expired = await report(leg.courier, reportAfter(leg.issued, 660))
    await runDurableObjectAlarm(stationRoom())
    const stored = await runInDurableObject(stationRoom(), (_instance, state) => state.storage.get(`${NETWORK_KEY}:live:${leg.batonId}`))
    // #then the report is refused, nothing is live and the stored report is gone
    expect({ expired, live: (await liveOnPage(leg.batonId)).detail, stored }).toEqual({ expired: [410, { error: 'run_expired' }], live: null, stored: undefined })
  })

  it('ends the live leg when its run is submitted', async () => {
    // #given an accepted report
    const leg = await holdLeg('Crossed the line')
    await report(leg.courier, reportAfter(leg.issued, 600))
    const storedBefore = await runInDurableObject(stationRoom(), (_instance, state) => state.storage.get(`${NETWORK_KEY}:live:${leg.batonId}`))
    // #when the run is submitted and a late report arrives
    await call(leg.courier.cookie, '/submit', { issued: leg.issued, inputTrace: IDLE_TRACE })
    const late = await report(leg.courier, reportAfter(leg.issued, 900))
    const storedAfter = await runInDurableObject(stationRoom(), (_instance, state) => state.storage.get(`${NETWORK_KEY}:live:${leg.batonId}`))
    // #then nothing is live, the stored report is gone and the late report is refused
    expect({ stored: [storedBefore !== undefined, storedAfter], live: (await liveOnPage(leg.batonId)).detail, late }).toEqual({
      stored: [true, undefined],
      live: null,
      late: [409, { error: 'run_already_submitted' }],
    })
  })

  it('hides a report once custody moved, and refuses the old holder’s reports', async () => {
    // #given a holder with two issued legs, reporting on the second
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Passed mid race' })
    const spare = await call<IssuedRace>(a.cookie, '/network/issue', { batonId: journey.baton.id })
    await report(a, reportAfter(spare, 600))
    // #when the first leg is passed on and the second keeps reporting
    await passBaton(a, b, journey.baton.id)
    const afterPass = (await liveOnPage(journey.baton.id)).detail
    const stale = await report(a, reportAfter(spare, 700))
    // #then the new holder is not shown as racing and the old holder can no longer report
    expect({ afterPass, stale }).toEqual({ afterPass: null, stale: [403, { error: 'only_current_holder_can_pass' }] })
  })

  it('never writes progress into network or product state', async () => {
    // #given a holder's issued leg and the stored state
    const leg = await holdLeg('Kept apart')
    const room = stationRoom()
    const stored = () => runInDurableObject(room, async (_instance, state) => JSON.stringify({ network: await readNetworkState(state.storage, NETWORK_KEY), product: await state.storage.get('state') }))
    const before = await stored()
    // #when progress is accepted
    const accepted = await report(leg.courier, reportAfter(leg.issued, 600))
    // #then network and product state are byte for byte unchanged and hold no progress
    const after = await stored()
    expect({ accepted, unchanged: after === before, mentionsRun: after.includes(leg.issued.runId) }).toEqual({ accepted: [200, { accepted: true }], unchanged: true, mentionsRun: false })
  })

  it('tells open clients about accepted progress', async () => {
    // #given a client listening to network updates
    const leg = await holdLeg('Heard live')
    const upgrade = await SELF.fetch('https://example.com/ws/network', { headers: { Upgrade: 'websocket' } })
    const socket = upgrade.webSocket
    if (!socket) throw new Error('No websocket upgrade')
    socket.accept()
    const message = new Promise<unknown>(resolve => socket.addEventListener('message', event => resolve(JSON.parse(String(event.data)))))
    // #when progress is accepted
    vi.setSystemTime(start + LIVE_BROADCAST_INTERVAL_MS * 10)
    await report(leg.courier, reportAfter(leg.issued, 600))
    // #then the client is told live legs changed
    expect(await message).toEqual({ type: 'network_updated', live: true })
    socket.close()
  })
})

describe('live progress plausibility', () => {
  it('accepts every tick of real runs on both fork paths', () => {
    // #given the safe and risk bot runs of a course with a ghost
    const config = relayLeg.createState({ engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'live-bounds', world: 'metro', tier: 1, openingFlow: 0 }).config
    const failures: string[] = []
    for (const plan of ['safe', 'risk'] as const) {
      const cursor = new relayLeg.InputCursor(botTrace(config, plan))
      let state = relayLeg.createState(config)
      // #when every state is reported with the widest ghost gaps its tick allows
      while (!state.finished) {
        state = relayLeg.step(state, cursor.at(state.tick))
        const input: LegProgressInput = { runId: 'run', tick: state.tick, dist: state.dist, finishDist: state.track.finishDist, ghostDeltaMs: null, path: state.path }
        const gaps = [null, Math.round((state.tick * 1000) / relayLeg.TICK_RATE), Math.round(((state.tick - relayLeg.MAX_TICKS) * 1000) / relayLeg.TICK_RATE)]
        for (const ghostDeltaMs of gaps) if (!isPlausibleProgress({ ...input, ghostDeltaMs }, state.track, true)) failures.push(`${plan}@${state.tick}:${ghostDeltaMs}`)
      }
    }
    // #then none is refused
    expect(failures).toEqual([])
  })
})

describe('live broadcasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('send the first change at once and fold later ones into one broadcast per window', () => {
    // #given a broadcaster that has not sent yet
    const sent: number[] = []
    const updates = new LiveUpdates(() => sent.push(Date.now()))
    const start = Date.now()
    // #when changes arrive at once, after one second and after two
    updates.changed(Date.now())
    vi.advanceTimersByTime(1_000)
    updates.changed(Date.now())
    vi.advanceTimersByTime(1_000)
    updates.changed(Date.now())
    vi.advanceTimersByTime(LIVE_BROADCAST_INTERVAL_MS * 3)
    // #then one broadcast goes out immediately and one when the window closes
    expect(sent.map(at => at - start)).toEqual([0, LIVE_BROADCAST_INTERVAL_MS])
  })
})
