import { describe, expect, it } from 'vitest'
import type { NetworkSnapshot } from '@nim-relay/shared'
import { ADA, FIXTURE_NOW, KOFI, LENA, busyScenario, emptyNetwork, fixtureBaton, fixtureProfile, fixtureStation, signedOutScenario } from './dev/fixtures'
import { STATION_SURFACES, toStationView, type StationViewData } from './view-model'

const HOUR = 3_600_000

function tones(view: StationViewData): string[] {
  return [...view.departures.map(row => row.tone), ...STATION_SURFACES.flatMap(id => view.cards[id].facts.map(fact => fact.tone))]
}

describe('toStationView', () => {
  it('reads an empty network plainly, without live signals or invented activity', () => {
    const freshCourier = fixtureStation(fixtureProfile({ achievements: [], handoffs: 0, runs: 0, xp: 0, level: 1, seasonRank: 'Cadet' }))
    const view = toStationView(emptyNetwork(ADA.id), { ...freshCourier, rankings: [], chronicles: [] }, ADA.id, FIXTURE_NOW)

    expect(view.departures).toEqual([
      { key: 'global-idle', service: 'Global', destination: 'No active relay', status: '', tone: 'idle' },
      { key: 'daily', service: 'Daily', destination: 'Midnight Metro', status: 'Open', tone: 'opportunity' },
    ])
    expect(view.world).toEqual({ activeRelays: 0, stations: 0, confirmedHandoffs: 0, routes: [] })
    expect(view.cards.world.facts[0]?.text).toBe('No active relays yet.')
    expect(view.vault).toEqual({ legend: null, yours: [], yoursTotal: 0 })
    expect(view.live.state).toBe('idle')
    expect(view.cards.live.action).toEqual({ label: 'Start a Global Relay', route: '/start' })
    expect(view.chronicle).toEqual({ achievements: [], moments: [] })
    expect(view.cards.chronicle.facts[0]?.text).toMatch(/^No moments recorded yet/)
    expect(view.rankings.daily.lines).toEqual([])
    expect(view.rankings.ghosts).toEqual([])
    expect(view.cards.departures.action).toEqual({ label: 'Ride the Daily', route: '/daily' })
    expect(tones(view)).not.toContain('live')
  })

  it('shows a signed-out visitor only public records, even from an account snapshot', () => {
    const { network } = busyScenario()
    const staleAccount: NetworkSnapshot = { ...network, pendingHandoff: pendingPass(network) }
    const view = toStationView(staleAccount, null, null, FIXTURE_NOW)

    expect(view.signedIn).toBe(false)
    expect(view.courier.setUp).toBe(false)
    expect(view.cards.courier.action).toEqual({ label: 'Set up your courier', route: '/profile' })
    expect(view.departures.map(row => row.service)).toEqual(['Global', 'Daily', 'Rival'])
    expect(view.departures[0]).toMatchObject({ destination: 'Sunrise Run', status: 'Leg 7', tone: 'live' })
    expect(view.departures[1]).toMatchObject({ status: 'Open' })
    expect(view.departures[2]).toMatchObject({ destination: 'North Stars', status: '7-5/10' })
    expect(view.rankings.daily.lines.some(line => line.you)).toBe(false)
    expect(view.vault.yours).toEqual([])
    expect(view.cards.vault.facts[1]?.text).toBe('Set up a courier to keep your batons here.')
    expect(toStationView(signedOutScenario().network, null, null, FIXTURE_NOW).departures).toEqual(view.departures)
  })

  it('puts the holder on their leg first on the board, the portal and the vault', () => {
    const sunrise = fixtureBaton({ id: 'sunrise', mode: 'global', displayName: 'Sunrise Run', origin: KOFI, holder: ADA, handoffCount: 6, updatedAt: FIXTURE_NOW - HOUR })
    const view = toStationView({ ...emptyNetwork(ADA.id), batons: [sunrise], runners: [ADA, KOFI] }, fixtureStation(), ADA.id, FIXTURE_NOW)

    expect(view.departures[0]).toEqual({ key: 'turn-sunrise', service: 'Global', destination: 'Sunrise Run', status: 'Your leg', tone: 'opportunity' })
    expect(view.departures.filter(row => row.service === 'Global')).toHaveLength(1)
    expect(view.cards.departures.action).toEqual({ label: 'Run your leg', route: '/leg/SUNRISE' })
    expect(view.live).toMatchObject({ state: 'live', yours: true, leg: 7, handoffs: 6, lastPass: expect.stringMatching(/^1h\s0m$/), ghostReady: true })
    expect(view.cards.live.action).toEqual({ label: 'Run your leg', route: '/leg/SUNRISE' })
    expect(view.vault.legend?.id).toBe('sunrise')
    expect(view.vault.yoursTotal).toBe(1)
    expect(view.cards.vault.action).toEqual({ label: 'Open your vault', route: '/profile' })
  })

  it('flags a crew streak at risk with the time left, and clears it after a handoff today', () => {
    const { network, station } = busyScenario()
    const calm = { ...network, batons: network.batons.filter(baton => baton.holder.id !== ADA.id), daily: { ...network.daily, officialRunId: null, leaderboard: [] } }
    const view = toStationView(calm, station, ADA.id, Date.UTC(2026, 8, 16, 18, 30))

    expect(view.departures).toContainEqual({ key: 'crew-owls', service: 'Crew', destination: 'Night Owls', status: 'At risk', tone: 'opportunity' })
    expect(view.cards.departures.facts.map(fact => fact.text)).toContainEqual(expect.stringMatching(/^Night Owls loses its 4-day streak in 5h\s30m without a handoff\.$/))
    expect(view.cards.departures.action).toEqual({ label: 'Keep the streak', route: '/crew' })

    const kept = toStationView({ ...calm, crews: calm.crews.map(crew => ({ ...crew, todayHandoffs: 1 })) }, station, ADA.id, FIXTURE_NOW)
    expect(kept.departures).toContainEqual({ key: 'crew-owls', service: 'Crew', destination: 'Night Owls', status: 'Streak 4', tone: 'idle' })
    expect(kept.cards.departures.action.route).toBe('/daily')
  })

  it('reports an attempted Daily by rank instead of inviting another official ride', () => {
    const board = [
      { player: LENA, runId: 'd1', score: 18_420, timeMs: 81_200 },
      { player: ADA, runId: 'mine', score: 17_960, timeMs: 83_900 },
      { player: KOFI, runId: 'd3', score: 15_002, timeMs: 90_100 },
    ]
    const network: NetworkSnapshot = { ...emptyNetwork(ADA.id), daily: { ...emptyNetwork().daily, officialRunId: 'mine', leaderboard: board } }
    const view = toStationView(network, fixtureStation(), ADA.id, FIXTURE_NOW)

    expect(view.departures).toContainEqual({ key: 'daily', service: 'Daily', destination: 'Midnight Metro', status: 'Rank 2', tone: 'idle' })
    expect(view.rankings.daily).toMatchObject({ position: 2, riders: 3 })
    expect(view.rankings.daily.lines.map(line => line.you)).toEqual([false, true, false])
    expect(view.cards.rankings.facts.map(fact => fact.text)).toEqual(["Lena leads today's Daily with 18,420.", "You're #2 of 3 today.", 'Your season rank is Vanguard with 2,340 XP.'])
    expect(view.cards.departures.action).toEqual({ label: 'Start a relay', route: '/start' })

    const started = toStationView({ ...network, daily: { ...network.daily, leaderboard: [] } }, fixtureStation(), ADA.id, FIXTURE_NOW)
    expect(started.departures).toContainEqual({ key: 'daily', service: 'Daily', destination: 'Midnight Metro', status: 'Started', tone: 'idle' })
  })

  it('never invents an opponent name the snapshot does not carry', () => {
    const duel = fixtureBaton({
      id: 'duel',
      mode: 'quick',
      origin: ADA,
      holder: ADA,
      quick: { players: [ADA.id, 'unknown-runner'], bestOf: 3, scores: { ada: 1 }, rounds: 1, winnerId: null, rematchOf: null },
    })
    const view = toStationView({ ...emptyNetwork(ADA.id), batons: [duel], runners: [ADA] }, null, ADA.id, FIXTURE_NOW)

    expect(view.departures[0]).toMatchObject({ service: 'Quick', destination: 'vs your opponent', status: 'Your turn' })
    expect(view.cards.departures.facts[0]?.text).toBe("It's your turn against your opponent.")
  })
})

function pendingPass(network: NetworkSnapshot): NetworkSnapshot['pendingHandoff'] {
  return {
    id: 'intent-1',
    batonId: 'sunrise',
    runId: 'run-1',
    recipientId: KOFI.id,
    recipientName: KOFI.name,
    note: null,
    route: null,
    sender: ADA.wallet,
    recipient: KOFI.wallet,
    value: 100_000,
    data: '',
    network: network.network,
    leg: 7,
    status: 'pending',
    txHash: null,
    createdAt: FIXTURE_NOW - 60_000,
    expiresAt: FIXTURE_NOW + 4 * 60_000,
    attemptedAt: null,
    state: 'prepared',
    failure: null,
  }
}
