import { beforeAll, describe, expect, it } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import type { BatonDetail, IssuedRace, RelayLegResult, SubmittedRace } from '@nim-relay/shared'
import { api, botTrace, call, chainTransfer, confirmWith, createBaton, finishingTrace, IDLE_TRACE, joinNetwork, passBaton, prepareAndAttempt, raceLeg, randomTxHash, relayLegConfig, runner, type Pass, type TestRunner } from './testing'

function replayed(issued: IssuedRace, trace: Parameters<typeof relayLeg.replay>[0]['inputTrace']): RelayLegResult {
  return relayLeg.replay({ ...relayLegConfig(issued.config), inputTrace: trace })
}

function openingFlowAfter(result: RelayLegResult): number {
  return Math.min(relayLeg.MAX_OPENING_FLOW, Math.trunc(result.metrics.flowSum / result.ticks / 4))
}

describe('v5 relay legs', () => {
  it('issues a signed v5 leg on the baton route and verifies its replay', async () => {
    // #given a new courier holding a fresh global baton
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Engine five' })
    // #when they race it with the steering bot
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    const trace = botTrace(issued.config, 'risk')
    const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: trace })
    // #then the server result is the engine replay of the issued route course
    expect({ config: issued.config, sector: issued.sector, ghost: issued.ghost, result: submitted.result }).toEqual({
      config: { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: journey.baton.route.seed, world: journey.baton.route.world, tier: 0, openingFlow: 0 },
      sector: { index: 0, startedLeg: 0, firstLeg: true },
      ghost: null,
      result: replayed(issued, trace),
    })
  })

  it('rejects traces in the station v4 sample shape', async () => {
    // #given an issued v5 leg
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Wrong shape' })
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    // #when a four-field v4 trace is submitted
    const response = await api(courier.cookie, '/submit', { issued, inputTrace: [[0, 0, 0, 0]] })
    // #then it is not replayed
    expect([response.status, await response.json()]).toEqual([400, { error: 'invalid_trace' }])
  })

  it('rejects a submission that changes the signed tier or opening FLOW', async () => {
    // #given an issued v5 leg
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Tampered course' })
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    const config = relayLegConfig(issued.config)
    // #when the client raises the tier or the inherited FLOW
    const statuses = await Promise.all([
      api(courier.cookie, '/submit', { issued: { ...issued, config: { ...config, tier: 2 } }, inputTrace: IDLE_TRACE }).then(response => response.status),
      api(courier.cookie, '/submit', { issued: { ...issued, config: { ...config, openingFlow: relayLeg.MAX_OPENING_FLOW } }, inputTrace: IDLE_TRACE }).then(response => response.status),
    ])
    // #then both fail the signed-field check
    expect(statuses).toEqual([401, 401])
  })

  it('scores a tampered trace by what it replays to, never by the client', async () => {
    // #given a bot trace with its steering flipped after submission was prepared
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'Replay authority' })
    const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    const tampered = botTrace(issued.config, 'safe').map(([ticks, steer, action]) => [ticks, -steer, action] as const)
    // #when it is submitted
    const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: tampered, result: { score: 999_999, completed: true } })
    // #then the stored result is the replay of the submitted inputs
    expect(submitted.result).toEqual(replayed(issued, tampered))
  })

  it('opens standard courses once a runner has three completed verified runs', async () => {
    // #given a courier who completes three verified practice-free runs
    const courier = await runner()
    const warmup = await createBaton(courier, { mode: 'global', title: 'Warm up' })
    for (let run = 0; run < 3; run++) await raceLeg(courier, warmup.baton.id)
    // #when they open a new baton
    const journey = await createBaton(courier, { mode: 'global', title: 'Standard course' })
    // #then its route and the tier of the first warm-up course differ
    expect([warmup.baton.route.tier, journey.baton.route.tier]).toEqual([0, 1])
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
    for (let leg = 0; leg < 10; leg++) {
      const [from, to] = leg % 2 === 0 ? [a, b] : [b, a]
      passes.push(await passBaton(from, to, batonId, issued => finishingTrace(issued.config, leg % 3 === 0 ? 'risk' : 'safe')))
    }
  }, 60_000)

  it('gives the next runner the previous runner ghost on the same course with inherited FLOW', () => {
    // #given the first two legs of the sector
    const [first, second] = passes
    const firstResult = replayed(first!.issued, first!.trace)
    // #then leg 2 races leg 1 on the same seed, world and tier
    expect({ config: second!.issued.config, ghost: [second!.issued.ghost?.runId, second!.issued.ghost?.timeMs, second!.issued.ghost?.config], firstLeg: second!.issued.sector?.firstLeg }).toEqual({
      config: { ...relayLegConfig(first!.issued.config), openingFlow: openingFlowAfter(firstResult) },
      ghost: [first!.issued.runId, firstResult.timeMs, first!.issued.config],
      firstLeg: false,
    })
  })

  it('opens a new sector on the next world after ten qualified handoffs', async () => {
    // #when the baton is read after its tenth handoff
    const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
    const opening = relayLegConfig(passes[0]!.issued.config)
    // #then sector 1 starts at leg 10 on the next world with a new seed
    expect({ sector: detail.baton.route.sector, startedLeg: detail.baton.route.sectorStartedLeg, world: detail.baton.route.world, newSeed: detail.baton.route.seed !== opening.seed }).toEqual({
      sector: 1,
      startedLeg: 10,
      world: relayLeg.WORLDS[(relayLeg.WORLDS.indexOf(opening.world) + 1) % relayLeg.WORLDS.length],
      newSeed: true,
    })
  })

  it('sets the first time on a new sector without a ghost', async () => {
    // #when the holder issues the first leg of sector 1
    const issued = await call<IssuedRace>(a.cookie, '/network/issue', { batonId })
    // #then there is no ghost to race and the course follows the new route
    const detail = await call<BatonDetail>('', `/network/batons/${batonId}`)
    expect({ ghost: issued.ghost, detailGhost: detail.ghost, sector: issued.sector, seed: relayLegConfig(issued.config).seed }).toEqual({
      ghost: null,
      detailGhost: null,
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
  const official: { runner: TestRunner; issued: IssuedRace; submitted: SubmittedRace }[] = []

  beforeAll(async () => {
    for (const plan of ['safe', 'idle'] as const) {
      const courier = await runner()
      const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { daily: true })
      const inputTrace = plan === 'idle' ? IDLE_TRACE : finishingTrace(issued.config, plan)
      official.push({ runner: courier, issued, submitted: await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace }) })
    }
  })

  it('issues one standard course per UTC day with no inherited FLOW', () => {
    // #then both official runs raced the same tier-1 course for today
    const today = new Date().toISOString().slice(0, 10)
    expect([official[0]!.issued.config, official[1]!.issued.config]).toEqual([
      { ...relayLegConfig(official[0]!.issued.config), seed: `daily-${today}-v5`, tier: 1, openingFlow: 0 },
      official[0]!.issued.config,
    ])
  })

  it('races a runner without a result against the median official entry', async () => {
    // #given two official entries, and a newcomer without a result
    const newcomer = await runner()
    const [faster] = [...official].sort((x, y) => x.submitted.result.timeMs - y.submitted.result.timeMs)
    // #when the newcomer practices the Daily
    const practice = await call<IssuedRace>(newcomer.cookie, '/network/issue', { daily: true, practice: true })
    // #then the lower median of the two is the ghost
    expect(practice.ghost?.runId).toBe(faster!.issued.runId)
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
