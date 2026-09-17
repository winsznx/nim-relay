import { SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { paymentAddress } from '@nim-relay/relay-protocol'
import type { BatonChronicle, IssuedRace, NetworkSnapshot, RunnerProfile, TrackEventResult } from '@nim-relay/shared'
import { api, call, chainTransfer, confirmWith, createBaton, finishingTrace, joinNetwork, passBaton, runner, type Pass, type TestRunner } from './testing'

async function metrics() {
  return (await call<NetworkSnapshot>('', '/network/public')).metrics
}

function track(body: unknown, cookie = ''): Promise<Response> {
  return SELF.fetch('https://example.com/api/station/network/track', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

describe('baton history', () => {
  let a: TestRunner
  let b: TestRunner
  let batonId: string
  let batonCode: string
  const passes: Pass[] = []

  beforeAll(async () => {
    a = await runner()
    b = await runner()
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'History in the making' })
    batonId = journey.baton.id
    batonCode = journey.baton.code
    passes.push(await passBaton(a, b, batonId, issued => finishingTrace(issued.config, 'risk'), 'same'))
    passes.push(await passBaton(b, a, batonId, issued => finishingTrace(issued.config, 'safe'), 'same'))
    passes.push(await passBaton(a, b, batonId, issued => finishingTrace(issued.config, 'safe'), 'same'))
  }, 30_000)

  it('draws the sector echoes in the next issued race', async () => {
    // #when the holder issues the fourth leg
    const issued = await call<IssuedRace>(b.cookie, '/network/issue', { batonId })
    const times = passes.map(pass => pass.submitted.result.timeMs)
    const recordLeg = times.indexOf(Math.min(...times)) + 1
    // #then the sector's ghost record belongs to its fastest leg
    expect(issued.echoes?.filter(echo => echo.kind === 'ghost-record').map(echo => [echo.leg, echo.sector, echo.runId])).toEqual([[recordLeg, 0, passes[recordLeg - 1]!.issued.runId]])
  })

  it('keeps a single FIRST PASS artifact when a verified transfer is confirmed again', async () => {
    // #given the first pass is confirmed a second time
    const [first] = passes
    await confirmWith(a, first!.intent, first!.txHash, chainTransfer(first!.intent, first!.txHash))
    // #when the sender's profile is read
    const profile = await call<RunnerProfile>('', `/network/runners/${a.p.handle}`)
    // #then FIRST PASS was unlocked once, by handoff 1
    expect(profile.artifacts.filter(artifact => artifact.kind === 'first-pass').map(artifact => [artifact.batonId, artifact.leg])).toEqual([[batonId, 1]])
  })

  it('exposes a public profile without wallets or unconsented countries', async () => {
    // #when runner a's profile is read signed out
    const response = await api('', `/network/runners/@${a.p.handle}`)
    const text = await response.text()
    const profile = JSON.parse(text) as RunnerProfile
    // #then it carries relay facts but no wallet and no country
    expect({
      wallet: text.includes(a.p.walletAddress) || text.includes(paymentAddress(a.p.walletAddress)),
      country: profile.country,
      handoffs: profile.qualifiedHandoffs,
      recent: profile.recentRunners,
      baton: profile.historicBatons.find(baton => baton.id === batonId)?.role,
    }).toEqual({ wallet: false, country: null, handoffs: 2, recent: [{ name: b.p.displayName, handle: b.p.handle }], baton: 'origin' })
  })

  it('tells the journey in a public Chronicle with handles, not wallets', async () => {
    // #when the Chronicle is read signed out
    const response = await api('', `/network/chronicles/${batonCode}`)
    const text = await response.text()
    const chronicle = JSON.parse(text) as BatonChronicle
    // #then the lineage, stops and replays follow the verified handoffs
    expect({
      wallets: [a, b].some(courier => text.includes(paymentAddress(courier.p.walletAddress))),
      transactions: chronicle.transactions.map(transaction => [transaction.leg, transaction.txHash, transaction.from, transaction.to]),
      stops: chronicle.stops.map(stop => [stop.leg, stop.runner.id, stop.countryCode]),
      runners: chronicle.runners.map(courier => courier.id),
      replays: chronicle.replays.map(replay => replay.runId),
      counts: [chronicle.qualifiedHandoffs, chronicle.transactingWallets, chronicle.countries],
    }).toEqual({
      wallets: false,
      transactions: passes.map((pass, index) => [index + 1, pass.txHash, index % 2 === 0 ? a.p.handle : b.p.handle, index % 2 === 0 ? b.p.handle : a.p.handle]),
      stops: [[0, a.p.id, null], [1, b.p.id, null], [2, a.p.id, null], [3, b.p.id, null]],
      runners: [a.p.id, b.p.id],
      replays: passes.map(pass => pass.issued.runId),
      counts: [3, 2, 0],
    })
  })

  it('marks the fastest leg and the closest ghost race as Chronicle moments', async () => {
    // #given the verified leg times and the ghosts each leg raced
    const legs = passes.map((pass, index) => ({ leg: index + 1, timeMs: pass.submitted.result.timeMs, ghostMs: pass.issued.ghost?.timeMs ?? null }))
    const fastest = legs.reduce((best, leg) => (leg.timeMs < best.timeMs ? leg : best))
    const raced = legs.filter(leg => leg.ghostMs !== null).map(leg => ({ leg: leg.leg, gap: Math.abs(leg.timeMs - (leg.ghostMs ?? 0)) }))
    const closest = raced.reduce((best, leg) => (leg.gap < best.gap ? leg : best))
    // #when the Chronicle is read
    const chronicle = await call<BatonChronicle>('', `/network/chronicles/${batonId}`)
    // #then both moments point at those legs
    expect(chronicle.moments.filter(moment => moment.kind === 'fastest-leg' || moment.kind === 'closest-ghost-race').map(moment => [moment.kind, moment.leg, moment.value])).toEqual([
      ['fastest-leg', fastest.leg, fastest.timeMs],
      ['closest-ghost-race', closest.leg, closest.gap],
    ])
  })

  it('counts every Chronicle view', async () => {
    // #given the current count
    const before = (await metrics()).chronicleViews
    // #when the Chronicle is opened twice
    await api('', `/network/chronicles/${batonCode}`)
    await api('', `/network/chronicles/${batonCode}`)
    // #then both views count
    expect((await metrics()).chronicleViews - before).toBe(2)
  })
})

describe('consented countries', () => {
  let origin: TestRunner
  let recipient: TestRunner
  let batonCode: string

  beforeAll(async () => {
    origin = await runner()
    recipient = await runner()
    await call(origin.cookie, '/network/consent', { consent: true }, 'DE')
    await call(recipient.cookie, '/network/consent', { consent: true }, 'FR')
    const journey = await createBaton(origin, { mode: 'global', title: 'Across a border' })
    batonCode = journey.baton.code
    await passBaton(origin, recipient, journey.baton.id)
  })

  it('shows a runner country on their profile only while they consent', async () => {
    // #given the recipient shares a country, then revokes consent
    const shared = await call<RunnerProfile>('', `/network/runners/${recipient.p.handle}`)
    await call(recipient.cookie, '/network/consent', { consent: false }, 'FR')
    const revoked = await call<RunnerProfile>('', `/network/runners/${recipient.p.handle}`)
    await call(recipient.cookie, '/network/consent', { consent: true }, 'FR')
    // #then the country disappears with the consent
    expect([shared.country, revoked.country]).toEqual(['FR', null])
  })

  it('marks the first border crossing and hides stops whose runner withdrew consent', async () => {
    // #given the Chronicle while both runners consent
    const crossing = await call<BatonChronicle>('', `/network/chronicles/${batonCode}`)
    // #when the origin withdraws consent
    await call(origin.cookie, '/network/consent', { consent: false }, 'DE')
    const withdrawn = await call<BatonChronicle>('', `/network/chronicles/${batonCode}`)
    // #then the crossing is a moment, and the withdrawn stop loses its country
    expect({
      stops: [crossing.stops.map(stop => stop.countryCode), withdrawn.stops.map(stop => stop.countryCode)],
      moment: crossing.moments.find(moment => moment.kind === 'first-new-country')?.value,
      countries: [crossing.countries, withdrawn.countries],
    }).toEqual({ stops: [['DE', 'FR'], [null, 'FR']], moment: 'FR', countries: [2, 1] })
  })
})

describe('judge-safe metrics', () => {
  it('counts an invitation opened twice in a day once', async () => {
    // #given a fresh invitation
    const holder = await runner()
    const journey = await createBaton(holder, { mode: 'global', title: 'Invitation opens' })
    const invite = await call<{ token: string }>(holder.cookie, '/network/invite', { batonId: journey.baton.id })
    const before = (await metrics()).inviteOpens
    // #when its link is opened twice
    await api('', `/network/invites/${invite.token}`)
    await api('', `/network/invites/${invite.token}`)
    // #then it counts once
    expect((await metrics()).inviteOpens - before).toBe(1)
  })

  it('counts signed-in and anonymous shares and rejects unknown surfaces', async () => {
    // #given a signed-in runner and an anonymous device
    const courier = await runner()
    const before = (await metrics()).shares
    // #when both share and a malformed share arrives
    const signedIn = await track({ kind: 'share', surface: 'result' }, courier.cookie)
    const anonymous = await track({ kind: 'share', surface: 'chronicle', visitor: crypto.randomUUID() })
    const malformed = await track({ kind: 'share', surface: 'somewhere' })
    // #then the two valid shares count
    expect({
      counted: [(await signedIn.json() as TrackEventResult).counted, (await anonymous.json() as TrackEventResult).counted],
      malformed: malformed.status,
      shares: (await metrics()).shares - before,
    }).toEqual({ counted: [true, true], malformed: 400, shares: 2 })
  })

  it('counts created Quick matches', async () => {
    // #given two runners
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const before = (await metrics()).quickMatches
    // #when a Quick match is created
    await createBaton(a, { mode: 'quick', recipient: b.p.id, bestOf: 3 })
    // #then it counts
    expect((await metrics()).quickMatches - before).toBe(1)
  })

  it('keeps the metric definitions explicit about what is not verified', async () => {
    // #then shares and Chronicle views are defined as unverified counts
    const { definitions } = await metrics()
    expect(definitions.filter(definition => /not unique visitors|delivery is not verified/.test(definition))).toHaveLength(2)
  })
})
