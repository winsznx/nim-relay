import { describe, expect, it } from 'vitest'
import { atlasRoute, outgoingRoutes, type AtlasRouteDetail, type AtlasSnapshot, type BatonDetail, type IssuedRace, type NetworkHandoffIntent, type RunnerProfile, type SubmittedRace } from '@nim-relay/shared'
import { handoffCommitment } from './handoff'
import { api, call, createBaton, finishingTrace, joinNetwork, passBaton, raceLeg, runner, TEST_RUN_CHALLENGE_SECRET, type TestRunner } from './testing'

const DEFAULT_THROW = { angle: 45, power: 75 }

async function batonPage(batonId: string): Promise<BatonDetail> {
  return call<BatonDetail>('', `/network/batons/${batonId}`)
}

async function pair(): Promise<[TestRunner, TestRunner]> {
  const couriers: [TestRunner, TestRunner] = [await runner(), await runner()]
  await joinNetwork(...couriers)
  return couriers
}

describe('atlas route choice', () => {
  it('binds the chosen route into the intent and the commitment the transfer carries', async () => {
    // #given a holder whose leg reached the station of their Genesis route
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'global', title: 'Bound route' })
    const leg = await raceLeg(a, journey.baton.id)
    const next = (await batonPage(journey.baton.id)).atlas.next
    const onward = next?.routeIds.find(id => id !== next.rerunRouteId)
    if (!next || !onward) throw new Error('No onward route offered')
    // #when they prepare a pass along an onward route
    const intent = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, routeId: onward })
    const terms = { id: intent.id, batonId: journey.baton.id, leg: intent.leg, runId: leg.issued.runId, from: a.p.id, to: b.p.id, throw: DEFAULT_THROW, note: null }
    const other = next.routeIds.find(id => id !== onward)!
    const commitments = await Promise.all([
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, route: intent.route }),
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, route: { routeId: other, origin: next.station, destination: atlasRoute(other)!.to } }),
      handoffCommitment(TEST_RUN_CHALLENGE_SECRET, { ...terms, route: null }),
    ])
    // #then the intent keeps that route and only it reproduces the carried commitment
    const carried = intent.data.split('.')[3]
    expect({ route: intent.route, matches: commitments.map(commitment => commitment === carried) }).toEqual({
      route: { routeId: onward, origin: next.station, destination: atlasRoute(onward)?.to },
      matches: [true, false, false],
    })
  })

  it('refuses a route the station does not offer and a changed route for an open pass', async () => {
    // #given a holder with a qualified leg and a prepared pass
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'global', title: 'Tampered route' })
    const leg = await raceLeg(a, journey.baton.id)
    const next = (await batonPage(journey.baton.id)).atlas.next!
    const elsewhere = outgoingRoutes('aurora-ridge')[0]!.id
    const refused = await api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, routeId: elsewhere })
    await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, routeId: next.routeIds[0] })
    // #when the pass is prepared again with another offered route
    const changed = await api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, routeId: next.routeIds[1] })
    // #then both are refused
    expect([refused.status, await refused.json(), changed.status, await changed.json()]).toEqual([409, { error: 'route_not_available' }, 409, { error: 'handoff_already_prepared' }])
  })

  it('binds the server default when the holder does not choose, and prepares the next leg from it', async () => {
    // #given a holder who passes without choosing a route
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'global', title: 'Default route' })
    const offered = (await batonPage(journey.baton.id)).atlas.next!
    const pass = await passBaton(a, b, journey.baton.id)
    // #when the next runner issues their leg
    const issued = await call<IssuedRace>(b.cookie, '/network/issue', { batonId: journey.baton.id })
    const route = atlasRoute(offered.defaultRouteId)!
    // #then the default route was bound and the leg races its course without the previous runner's ghost
    expect({
      bound: pass.intent.route?.routeId,
      course: [issued.config.seed, issued.config.world, issued.config.engineVersion === '6' ? issued.config.tier : null],
      ghost: [issued.ghost, issued.atlas?.ghost],
      leg: issued.atlas && [issued.atlas.routeId, issued.atlas.origin, issued.atlas.destination],
    }).toEqual({
      bound: offered.defaultRouteId,
      course: [route.seed, route.world, route.tier],
      ghost: [null, 'different-route'],
      leg: [route.id, route.from, route.to],
    })
  })

  it('offers the previous runner ghost only on the same route', async () => {
    // #given a pass that keeps the route
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'global', title: 'Same route ghost' })
    const pass = await passBaton(a, b, journey.baton.id, undefined, 'same')
    // #when the next runner issues their leg
    const issued = await call<IssuedRace>(b.cookie, '/network/issue', { batonId: journey.baton.id })
    // #then they race the first runner's ghost on the route it raced
    expect([issued.ghost?.runId, issued.atlas?.ghost, issued.atlas?.routeId]).toEqual([pass.issued.runId, 'previous-runner', pass.issued.atlas?.routeId])
  })

  it('keeps a Quick round on one route until the round closes', async () => {
    // #given a Quick match whose opener finished the first leg
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'quick', title: 'Quick route', recipient: b.p.id })
    const next = (await batonPage(journey.baton.id)).atlas.next
    const leg = await raceLeg(a, journey.baton.id)
    const onward = outgoingRoutes(journey.baton.route.destination)[0]!.id
    // #when the opener tries to send the next leg elsewhere
    const refused = await api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id, routeId: onward })
    // #then the route is fixed for the round's second leg
    expect([next?.policy, next?.routeIds, refused.status]).toEqual(['fixed', [journey.baton.route.routeId], 409])
  })

  it('never lets a Daily run pass a baton or choose a route', async () => {
    // #given a runner with a finished official Daily run and a baton
    const [a, b] = await pair()
    await createBaton(a, { mode: 'global', title: 'Daily is not a leg' })
    const daily = await call<IssuedRace>(a.cookie, '/network/issue', { daily: true })
    await call<SubmittedRace>(a.cookie, '/submit', { issued: daily, inputTrace: finishingTrace(daily.config) })
    // #when they prepare a pass with the Daily run and a route
    const refused = await api(a.cookie, '/network/handoff/prepare', { runId: daily.runId, recipient: b.p.id, routeId: 'genesis-to-dune-array' })
    // #then no route choice exists for the Daily
    expect([refused.status, await refused.json(), daily.atlas]).toEqual([409, { error: 'finish_your_relay_leg_first' }, undefined])
  })
})

describe('atlas aggregates', () => {
  it('count only verified qualified legs, with distinct runners, the fastest run and personal progression', async () => {
    // #given the Atlas before a baton travels Genesis -> station -> same route again, and a raced leg never passed on
    const before = await call<AtlasSnapshot>('', '/network/atlas')
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'global', title: 'Lighting routes' })
    const routeId = journey.baton.route.routeId
    const first = await passBaton(a, b, journey.baton.id, undefined, 'same')
    const second = await passBaton(b, a, journey.baton.id, undefined, 'same')
    const third = await passBaton(a, b, journey.baton.id, undefined, 'same')
    await raceLeg(b, journey.baton.id)
    // #when the Atlas, the route and a runner's profile are read
    const after = await call<AtlasSnapshot>('', '/network/atlas')
    const detail = await call<AtlasRouteDetail>('', `/network/atlas/routes/${routeId}`)
    const profile = await call<RunnerProfile>('', `/network/runners/${a.p.handle}`)
    const statsBefore = before.routes.find(route => route.routeId === routeId)!
    const passes = [first, second, third]
    const fastest = passes.reduce((best, pass) => (pass.submitted.result.timeMs < best.submitted.result.timeMs ? pass : best))
    // #then three legs and two runners were added, the fastest is one of them, and runner a completed one route
    expect({
      runs: detail.stats.verifiedRuns - statsBefore.verifiedRuns,
      runners: detail.stats.qualifiedRunners - statsBefore.qualifiedRunners,
      fastest: detail.stats.fastest && detail.stats.fastest.timeMs <= fastest.submitted.result.timeMs,
      lit: [detail.stats.lit, after.lightTheWorld.routesLit >= 1, after.lightTheWorld.routesTotal, after.lightTheWorld.stationsTotal],
      active: detail.stats.activeBatons.some(baton => baton.code === journey.baton.code),
      heat: detail.stats.heat > statsBefore.heat,
      atlas: [profile.atlas.routesCompleted, profile.atlas.stationsVisited, profile.atlas.journeys, profile.atlas.routes],
      explorer: profile.atlas.missions.find(mission => mission.id === 'explorer')?.progress,
    }).toEqual({
      runs: 3,
      runners: 2,
      fastest: true,
      lit: [true, true, 55, 24],
      active: true,
      heat: true,
      atlas: [1, 2, 1, [routeId]],
      explorer: 1,
    })
  })

  it('tells the baton journey hop by hop with the leg in progress last', async () => {
    // #given a baton passed once along its route
    const [a, b] = await pair()
    const journey = await createBaton(a, { mode: 'global', title: 'Journey hops' })
    const pass = await passBaton(a, b, journey.baton.id)
    // #when its page is read
    const detail = await batonPage(journey.baton.id)
    // #then the verified hop carries its transaction and the next hop leaves the station the first one reached
    expect(detail.atlas.journey.map(entry => (entry.kind === 'leg' ? [entry.leg, entry.origin, entry.destination, entry.txHash, entry.runner.handle] : [entry.kind]))).toEqual([
      [1, journey.baton.route.origin, journey.baton.route.destination, pass.txHash, a.p.handle],
      [2, journey.baton.route.destination, pass.intent.route?.destination, null, b.p.handle],
    ])
    expect(detail.baton.hops?.map(hop => hop.routeId)).toEqual([journey.baton.route.routeId, pass.intent.route?.routeId])
  })

  it('answers an unknown route with 404', async () => {
    const response = await api('', '/network/atlas/routes/nowhere-to-nowhere')
    expect(response.status).toBe(404)
  })
})
