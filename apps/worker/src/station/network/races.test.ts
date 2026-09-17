import { runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { relayLeg, relayLegV5 } from '@nim-relay/game-engine'
import { atlasRoute, isFailedLeg, isRelayLegResult, type BatonDetail, type CanonicalGhost, type IssuedRace, type RaceConfig, type RelayLegGhostline, type RelayLegResult, type RelayLegV6Result, type RelayLegV6Trace, type RunnerProfile, type SubmittedRace } from '@nim-relay/shared'
import type { Run } from '../model'
import {
  api,
  call,
  chainTransfer,
  confirmWith,
  createBaton,
  failingTrace,
  finishingTrace,
  IDLE_TRACE,
  joinNetwork,
  passBaton,
  plantV5Leg,
  prepareAndAttempt,
  raceLeg,
  randomTxHash,
  runner,
  stationRoom,
  v6Config,
  V5_IDLE_TRACE,
  type Pass,
  type TestRunner,
} from './testing'

function replayed(issued: IssuedRace, trace: RelayLegV6Trace): RelayLegV6Result {
  return relayLeg.replay({ ...v6Config(issued.config), inputTrace: trace })
}

function openingFlowAfter(result: RelayLegResult): number {
  return Math.min(relayLeg.MAX_OPENING_FLOW, Math.trunc(result.metrics.flowSum / result.ticks / 4))
}

/** The ghostline a leg derived from `trace` carries over the wire: JSON writes the engine's -0 centimetres as 0. */
function wireGhostline(config: RaceConfig, trace: RelayLegV6Trace): RelayLegGhostline {
  return JSON.parse(JSON.stringify(relayLeg.deriveGhostline(v6Config(config), trace)))
}

function ghostSummary(ghost: CanonicalGhost | null): unknown[] {
  return [ghost?.runId, ghost?.timeMs, ghost?.config]
}

async function storedRun(runId: string): Promise<Run | undefined> {
  return runInDurableObject(stationRoom(), (_instance, state) => state.storage.get<Run>(`run:${runId}`))
}

describe('v6 relay legs', () => {
  it('issues a signed v6 leg on the baton route and verifies its replay', async () => {
    // #given a new courier holding a fresh global baton
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Engine six' })
    // #when they race it with the lane bot
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    const trace = finishingTrace(issued.config, 'risk')
    const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: trace })
    // #then the server result is the engine replay of the issued route course, with one tether save and no ghost
    expect({ config: issued.config, sector: issued.sector, ghost: issued.ghost, result: submitted.result, qualified: submitted.qualifiedHandoff }).toEqual({
      config: { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: journey.baton.route.seed, world: journey.baton.route.world, tier: 0, openingFlow: 0, tetherSaves: 1, ghostline: null },
      sector: { index: 0, startedLeg: 0, firstLeg: true },
      ghost: null,
      result: replayed(issued, trace),
      qualified: true,
    })
  })

  it('rejects traces in the v5 sample shape', async () => {
    // #given an issued v6 leg
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Wrong shape' })
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    // #when a three-field v5 trace is submitted
    const response = await api(courier.cookie, '/submit', { issued, inputTrace: V5_IDLE_TRACE })
    // #then it is not replayed
    expect([response.status, await response.json()]).toEqual([400, { error: 'invalid_trace' }])
  })

  it('rejects a submission that changes the signed tier, opening FLOW or tether saves', async () => {
    // #given an issued v6 leg
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Tampered course' })
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    const config = v6Config(issued.config)
    // #when the client raises the tier, the inherited FLOW or the tether saves
    const tampered = [{ ...config, tier: 2 }, { ...config, openingFlow: relayLeg.MAX_OPENING_FLOW }, { ...config, tetherSaves: 0 }]
    const statuses = await Promise.all(tampered.map(changed => api(courier.cookie, '/submit', { issued: { ...issued, config: changed }, inputTrace: IDLE_TRACE }).then(response => response.status)))
    // #then each fails the signed-field check
    expect(statuses).toEqual([401, 401, 401])
  })

  it('scores a tampered trace by what it replays to, never by the client', async () => {
    // #given a bot trace with its lane shifts mirrored after the run
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Replay authority' })
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    const tampered: RelayLegV6Trace = finishingTrace(issued.config, 'safe').map(([ticks, shift, nudge, action]) => [ticks, shift === 0 ? 0 : shift === 1 ? -1 : 1, -nudge, action] as const)
    // #when it is submitted with a claimed result
    const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: tampered, result: { score: 999_999, completed: true } })
    // #then the stored result is the replay of the submitted inputs
    expect(submitted.result).toEqual(replayed(issued, tampered))
  })

  it('opens standard free rides once a runner has three completed verified runs', async () => {
    // #given a courier who completes three verified practice-free runs
    const courier = await runner()
    const firstRide = v6Config((await call<IssuedRace>(courier.cookie, '/network/issue', {})).config).tier
    const warmup = await createBaton(courier, { mode: 'global', title: 'Warm up' })
    for (let run = 0; run < 3; run++) await raceLeg(courier, warmup.baton.id)
    // #when they ride again without a baton
    const laterRide = v6Config((await call<IssuedRace>(courier.cookie, '/network/issue', {})).config).tier
    // #then the forgiving course gives way to the standard one, while the baton keeps its Genesis route tier
    expect([firstRide, laterRide, warmup.baton.route.tier]).toEqual([0, 1, 0])
  })
})

describe('failed legs', () => {
  it('are verified but never qualify for a handoff or count as a finished leg', async () => {
    // #given a holder whose courier falls with no tether save left
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Over the edge' })
    const issued = await call<IssuedRace>(a.cookie, '/network/issue', { batonId: journey.baton.id })
    const trace = failingTrace(issued.config)
    // #when the leg is submitted and the holder tries to pass the baton on it
    const submitted = await call<SubmittedRace>(a.cookie, '/submit', { issued, inputTrace: trace })
    const prepare = await api(a.cookie, '/network/handoff/prepare', { runId: issued.runId, recipient: b.p.id })
    const profile = await call<RunnerProfile>('', `/network/runners/${a.p.handle}`)
    // #then the replay is recorded as failed, the pass is refused and no leg was finished
    expect({
      result: submitted.result,
      failed: [submitted.result.completed, isFailedLeg(submitted.result)],
      qualified: submitted.qualifiedHandoff,
      prepare: [prepare.status, await prepare.json()],
      legs: profile.legs,
    }).toEqual({
      result: replayed(issued, trace),
      failed: [false, true],
      qualified: false,
      prepare: [409, { error: 'finish_your_relay_leg_first' }],
      legs: 0,
    })
  })
})

describe('tether saves', () => {
  it('give every leg and practice ride one save and the official Daily attempt none', async () => {
    // #given a holder with a finished leg, and the Daily
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Tether policy' })
    const raced = await raceLeg(courier, journey.baton.id)
    const issue = async (body: Record<string, unknown>) => v6Config((await call<IssuedRace>(courier.cookie, '/network/issue', body)).config).tetherSaves
    // #when each kind of ride is issued
    const saves = {
      batonLeg: await issue({ batonId: journey.baton.id }),
      batonPractice: await issue({ batonId: journey.baton.id, practice: true }),
      freeRide: await issue({}),
      ghostPractice: await issue({ practice: true, ghostRunId: raced.issued.runId }),
      dailyPractice: await issue({ daily: true, practice: true }),
      officialDaily: await issue({ daily: true }),
    }
    // #then only the official Daily attempt rides without one
    expect(saves).toEqual({ batonLeg: 1, batonPractice: 1, freeRide: 1, ghostPractice: 1, dailyPractice: 1, officialDaily: 0 })
  })
})

describe('baton sector continuity', () => {
  let a: TestRunner
  let b: TestRunner
  let batonId: string
  const passes: Pass[] = []

  beforeAll(async () => {
    a = await runner()
    b = await runner()
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: '' })
    batonId = journey.baton.id
    // Nine passes keep the route so each runner chases the previous ghost; the tenth lets the server send it onward.
    for (let leg = 0; leg < 10; leg++) {
      const [from, to] = leg % 2 === 0 ? [a, b] : [b, a]
      passes.push(await passBaton(from, to, batonId, issued => finishingTrace(issued.config, leg % 3 === 0 ? 'risk' : 'safe'), leg < 9 ? 'same' : undefined))
    }
  }, 120_000)

  it('gives the next runner the previous runner ghost and ghostline on the same course with inherited FLOW', () => {
    // #given the first two legs of the sector
    const [first, second] = passes
    const firstResult = replayed(first!.issued, first!.trace)
    // #then leg 2 races leg 1 on the same seed, world and tier, drafting the route derived from leg 1's replay
    expect({ config: second!.issued.config, ghost: ghostSummary(second!.issued.ghost), firstLeg: second!.issued.sector?.firstLeg }).toEqual({
      config: { ...v6Config(first!.issued.config), openingFlow: openingFlowAfter(firstResult), ghostline: wireGhostline(first!.issued.config, first!.trace) },
      ghost: [first!.issued.runId, firstResult.timeMs, first!.issued.config],
      firstLeg: false,
    })
  })

  it('derives a ghostline from the replay its runner was verified on, including the ghostline they drafted', () => {
    // #given the second leg, which drafted the first leg's ghostline, and the third leg that races it
    const [, second, third] = passes
    // #then the third leg's ghostline replays the second leg exactly as issued
    expect([v6Config(second!.issued.config).ghostline !== null, v6Config(third!.issued.config).ghostline]).toEqual([true, wireGhostline(second!.issued.config, second!.trace)])
  })

  it('keeps each derived ghostline on the ghost run, leaving its verified record unchanged', async () => {
    // #when the first leg's stored run is read after the second leg raced it
    const [first, second] = passes
    const run = await storedRun(first!.issued.runId)
    // #then it carries the ghostline the second leg was signed with, beside its own issued config and result
    expect(JSON.parse(JSON.stringify({ ghostline: run?.ghostline, config: run?.issued.config, result: run?.result }))).toEqual({
      ghostline: v6Config(second!.issued.config).ghostline,
      config: first!.issued.config,
      result: first!.submitted.result,
    })
  })

  it('refuses a submission whose signed ghostline was changed or dropped', async () => {
    // #given the second leg's ticket and its ghostline
    const second = passes[1]!
    const config = v6Config(second.issued.config)
    const ghostline = config.ghostline
    if (!ghostline) throw new Error('The second leg raced no ghostline')
    // #when it is submitted with the ghost moved one centimetre, or without its ghostline
    const moved = { ...config, ghostline: { ...ghostline, x: ghostline.x.map(x => x + 1) } }
    const statuses = await Promise.all([moved, { ...config, ghostline: null }].map(changed => api(b.cookie, '/submit', { issued: { ...second.issued, config: changed }, inputTrace: second.trace }).then(response => response.status)))
    // #then both fail the signed-field check
    expect(statuses).toEqual([401, 401])
  })

  it('adds a bounded ghostline to the leg ticket, whatever the size of the traces it carries', () => {
    // #when the second leg's ticket is measured without the ghost's trace, which the engine bounds on its own
    const second = passes[1]!
    const ghost = second.issued.ghost && { ...second.issued.ghost, inputTrace: [] }
    // #then its ghostline, the ghost's own config and everything else stay under a fifth of the 100 KB station limit
    expect(JSON.stringify({ ...second.issued, ghost }).length).toBeLessThan(20_000)
  })

  it('keeps a whole submission of a raced ghost leg well under the request size limit', () => {
    // #when the second leg's submission body is measured
    const second = passes[1]!
    // #then it stays under half of the 100 KB station limit
    expect(JSON.stringify({ issued: second.issued, inputTrace: second.trace }).length).toBeLessThan(50_000)
  })

  it('opens a new sector on the route the tenth pass bound', async () => {
    // #when the baton is read after its tenth handoff, which bound the server's default route
    const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
    const bound = passes[9]!.intent.route
    const route = bound && atlasRoute(bound.routeId)
    // #then sector 1 starts at leg 10 on that route's world, tier and seed, leaving the station the ninth leg reached
    expect({ sector: detail.baton.route.sector, startedLeg: detail.baton.route.sectorStartedLeg, course: [detail.baton.route.world, detail.baton.route.tier, detail.baton.route.seed], origin: detail.baton.route.origin }).toEqual({
      sector: 1,
      startedLeg: 10,
      course: [route?.world, route?.tier, route?.seed],
      origin: passes[0]!.issued.atlas?.destination,
    })
  })

  it('sets the first time on a new sector without a ghost', async () => {
    // #when the holder issues the first leg of sector 1
    const issued = await call<IssuedRace>(a.cookie, '/network/issue', { batonId })
    // #then there is no ghost or ghostline to race and the course follows the new route
    const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
    expect({ ghost: issued.ghost, detailGhost: detail.ghost, ghostline: v6Config(issued.config).ghostline, sector: issued.sector, seed: v6Config(issued.config).seed }).toEqual({
      ghost: null,
      detailGhost: null,
      ghostline: null,
      sector: { index: 1, startedLeg: 10, firstLeg: true },
      seed: detail.baton.route.seed,
    })
  })

  it('leaves a milestone echo on the tenth handoff and a ghost record on each sector', async () => {
    // #when the baton is read
    const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
    // #then the tenth handoff is a milestone and sector 0 holds a ghost record
    expect({
      milestone: detail.echoes.filter(echo => echo.kind === 'milestone').map(echo => [echo.leg, echo.sector, echo.runner.id]),
      records: detail.echoes.filter(echo => echo.kind === 'ghost-record').map(echo => echo.sector),
    }).toEqual({ milestone: [[10, 0, b.p.id]], records: [0] })
  })

  it('names the untitled baton from its mode and serial', async () => {
    // #when the untitled baton is read
    const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
    // #then its display name comes from its serial
    expect(detail.baton.displayName).toBe(`Global Relay #${String(detail.baton.serial).padStart(3, '0')}`)
  })
})

describe('historic v5 legs', () => {
  it('replay with the frozen v5 engine when their ticket was signed before v6', async () => {
    // #given a v5 leg ticket the network signed before the upgrade
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Historic ticket' })
    const issued = await plantV5Leg(courier, journey.baton)
    // #when it is submitted with a v5 trace
    const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: V5_IDLE_TRACE })
    // #then the result is the v5 replay and the finished leg still qualifies
    const config = issued.config.engineVersion === '5' ? issued.config : null
    expect({ result: submitted.result, qualified: submitted.qualifiedHandoff }).toEqual({ result: config && relayLegV5.replay({ ...config, inputTrace: V5_IDLE_TRACE }), qualified: true })
  })

  it('start a new sector with no ghost once a v5 leg was passed on', async () => {
    // #given a baton whose opening leg was raced on v5 and passed on after the upgrade
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Across the upgrade' })
    const historic = await plantV5Leg(a, journey.baton)
    const v5Result = (await call<SubmittedRace>(a.cookie, '/submit', { issued: historic, inputTrace: V5_IDLE_TRACE })).result
    if (!isRelayLegResult(v5Result)) throw new Error('The v5 leg did not replay as a relay leg')
    const intent = await prepareAndAttempt(a, b, historic.runId, journey.baton.route.routeId)
    const hash = randomTxHash()
    await confirmWith(a, intent, hash, chainTransfer(intent, hash))
    // #when the new holder issues the next leg on the same Atlas route
    const issued = await call<IssuedRace>(b.cookie, '/network/issue', { batonId: journey.baton.id })
    const detail = await call<BatonDetail>('', `/network/batons/${journey.baton.id}`)
    // #then sector 1 opens at leg 1 on the route's own course, while the v5 leg keeps sector 0
    const route = { ...journey.baton.route, sector: 1, sectorStartedLeg: 1 }
    expect({ config: issued.config, ghost: issued.ghost, sector: issued.sector, route: detail.baton.route, detailGhost: detail.ghost, v5Sector: detail.handoffs[0]?.sector }).toEqual({
      config: { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: route.seed, world: route.world, tier: route.tier, openingFlow: openingFlowAfter(v5Result), tetherSaves: 1, ghostline: null },
      ghost: null,
      sector: { index: 1, startedLeg: 1, firstLeg: true },
      route,
      detailGhost: null,
      v5Sector: 0,
    })
  })

  it('stay watchable but cannot be raced in practice', async () => {
    // #given a verified v5 run
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Watch only' })
    const issued = await plantV5Leg(courier, journey.baton)
    await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: V5_IDLE_TRACE })
    // #when another runner watches it and asks to practice against it
    const other = await runner()
    const watched = await call<CanonicalGhost>('', `/network/replays/${issued.runId}`)
    const practice = await api(other.cookie, '/network/issue', { practice: true, ghostRunId: issued.runId })
    // #then the replay is served and the practice ride is refused
    expect({ watched: [watched.runId, watched.config.engineVersion], practice: [practice.status, await practice.json()] }).toEqual({
      watched: [issued.runId, '5'],
      practice: [409, { error: 'ghost_is_watch_only' }],
    })
  })
})

describe('practice against a chosen ghost', () => {
  it('races a v6 ghost on its own course, drafting its ghostline', async () => {
    // #given a verified v6 leg
    const owner = await runner()
    const journey = await createBaton(owner, { mode: 'global', title: 'Chosen ghost' })
    const raced = await raceLeg(owner, journey.baton.id)
    // #when another runner practices against it
    const other = await runner()
    const practice = await call<IssuedRace>(other.cookie, '/network/issue', { practice: true, ghostRunId: raced.issued.runId })
    // #then the course, FLOW and ghost are the run's own, with its derived ghostline and one tether save
    const config = v6Config(raced.issued.config)
    expect({ config: practice.config, ghost: ghostSummary(practice.ghost), practice: practice.practice }).toEqual({
      config: { ...config, tetherSaves: 1, ghostline: wireGhostline(config, raced.trace) },
      ghost: [raced.issued.runId, raced.submitted.result.timeMs, raced.issued.config],
      practice: true,
    })
  })
})

describe('baton identity', () => {
  it('numbers batons per mode and keeps chosen titles', async () => {
    // #given two untitled global batons, a titled one, and a quick match
    const a = await runner()
    const b = await runner()
    await joinNetwork(a, b)
    const first = await createBaton(a, { mode: 'global' })
    const second = await createBaton(a, { mode: 'global', title: '  ' })
    const titled = await createBaton(a, { mode: 'global', title: 'Around the world' })
    const quick = await createBaton(a, { mode: 'quick', recipient: b.p.id })
    // #then global serials increment together and quick counts separately
    expect([second.baton.serial - first.baton.serial, titled.baton.serial - first.baton.serial, second.baton.displayName, titled.baton.displayName, quick.baton.displayName]).toEqual([
      1,
      2,
      `Global Relay #${String(second.baton.serial).padStart(3, '0')}`,
      'Around the world',
      `Quick Relay #${String(quick.baton.serial).padStart(3, '0')}`,
    ])
  })
})

describe('daily course', () => {
  const official: { runner: TestRunner; issued: IssuedRace; trace: RelayLegV6Trace; submitted: SubmittedRace }[] = []

  beforeAll(async () => {
    for (const plan of ['safe', 'risk'] as const) {
      const courier = await runner()
      const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { daily: true })
      const trace = finishingTrace(issued.config, plan)
      official.push({ runner: courier, issued, trace, submitted: await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: trace }) })
    }
  }, 30_000)

  it('issues one standard v6 course per UTC day with no inherited FLOW, tether save or ghostline for official attempts', () => {
    // #then both official runs raced the identical tier-1 course, the second shown the first run as its ghost without drafting it
    const today = new Date().toISOString().slice(0, 10)
    const [first, second] = official
    const course = { ...v6Config(first!.issued.config), seed: `daily-${today}-v6`, tier: 1, openingFlow: 0, tetherSaves: 0, ghostline: null }
    expect([first!.issued.config, second!.issued.config, second!.issued.ghost?.runId]).toEqual([course, course, first!.issued.runId])
  })

  it('shows the official attempt the ghost its practice drafts, without the ghostline or tether save', async () => {
    // #given a newcomer who practices the Daily against a drafted ghost
    const newcomer = await runner()
    const practice = await call<IssuedRace>(newcomer.cookie, '/network/issue', { daily: true, practice: true })
    // #when they start their official attempt
    const attempt = await call<IssuedRace>(newcomer.cookie, '/network/issue', { daily: true })
    // #then the same ghost comes along, and the config differs from practice only by the tether save and the ghostline
    expect({ ghost: attempt.ghost?.runId, drafted: v6Config(practice.config).ghostline !== null, config: attempt.config }).toEqual({
      ghost: practice.ghost?.runId,
      drafted: true,
      config: { ...v6Config(practice.config), tetherSaves: 0, ghostline: null },
    })
  })

  it('races a runner without a result against the median official entry, drafting its ghostline', async () => {
    // #given two official entries, and a newcomer without a result
    const newcomer = await runner()
    const [faster] = [...official].sort((x, y) => x.submitted.result.timeMs - y.submitted.result.timeMs || x.issued.runId.localeCompare(y.issued.runId))
    // #when the newcomer practices the Daily
    const practice = await call<IssuedRace>(newcomer.cookie, '/network/issue', { daily: true, practice: true })
    // #then the lower median of the two is the ghost, and its ghostline rides in the practice config
    expect([practice.ghost?.runId, v6Config(practice.config).ghostline]).toEqual([faster!.issued.runId, wireGhostline(faster!.issued.config, faster!.trace)])
  })

  it('never gives a runner their own official run as the Daily ghost', async () => {
    // #when the first official runner practices afterwards
    const practice = await call<IssuedRace>(official[0]!.runner.cookie, '/network/issue', { daily: true, practice: true })
    // #then the other official run is their ghost
    expect(practice.ghost?.runId).toBe(official[1]!.issued.runId)
  })
})

describe('handoff preparation', () => {
  it('reports unavailable recipients, self passes and a second prepared recipient', async () => {
    // #given a holder with a finished leg and an open intent to runner b
    const [a, b, c] = [await runner(), await runner(), await runner()]
    await joinNetwork(a, b, c)
    const journey = await createBaton(a, { mode: 'global', title: 'Choosing a runner' })
    const leg = await raceLeg(a, journey.baton.id)
    const prepare = (recipient: string) => api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient }).then(async response => [response.status, await response.json()])
    const unknown = await prepare('@runner-nobody')
    const self = await prepare(a.p.id)
    await prepareAndAttempt(a, b, leg.issued.runId)
    const second = await prepare(c.p.id)
    // #then each failure has its own code
    expect([unknown, self, second]).toEqual([
      [404, { error: 'recipient_unavailable' }],
      [400, { error: 'choose_another_courier' }],
      [409, { error: 'handoff_already_prepared' }],
    ])
  })

  it('reports a runner reserved for another pass as unavailable', async () => {
    // #given runner b claimed the holder's invitation
    const [a, b, c] = [await runner(), await runner(), await runner()]
    await joinNetwork(a, b, c)
    const journey = await createBaton(a, { mode: 'global', title: 'Reserved pass' })
    const invite = await call<{ token: string }>(a.cookie, '/network/invite', { batonId: journey.baton.id })
    await call(b.cookie, '/network/invite/claim', { token: invite.token })
    const leg = await raceLeg(a, journey.baton.id)
    // #when the holder chooses runner c instead
    const response = await api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: c.p.id })
    // #then c is unavailable for this pass
    expect([response.status, await response.json()]).toEqual([409, { error: 'recipient_unavailable' }])
  })

  it('verifies the pass that follows a reserved acceptance', async () => {
    // #given runner b accepted by invitation and the holder raced
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Accepted pass' })
    const invite = await call<{ token: string }>(a.cookie, '/network/invite', { batonId: journey.baton.id })
    await call(b.cookie, '/network/invite/claim', { token: invite.token })
    const leg = await raceLeg(a, journey.baton.id)
    const intent = await prepareAndAttempt(a, b, leg.issued.runId)
    // #when the transfer confirms
    const hash = randomTxHash()
    const confirmation = await confirmWith(a, intent, hash, chainTransfer(intent, hash))
    // #then custody moves and the reservation is cleared
    expect([confirmation.status, confirmation.baton?.holder.id, confirmation.baton?.recipientId]).toEqual(['verified', b.p.id, null])
  })
})

