import type { NetworkBaton, NetworkCrew, NetworkMetrics, NetworkRival, NetworkRunner, NetworkSnapshot, StationProfile, StationSnapshot, StationWorld } from '@nim-relay/shared'

/**
 * Development fixtures for the Station lab and view-model tests. Every name and
 * number here is invented for local testing and must never reach production code.
 */

export const FIXTURE_NOW = Date.UTC(2026, 8, 16, 18, 30)
const HOUR = 3_600_000
const DAY = 24 * HOUR

export function fixtureRunner(id: string, name: string, country: string | null = null): NetworkRunner {
  return { id, handle: name.toLowerCase(), name, wallet: `NQ00 FIXTURE ${id.toUpperCase()}`, country, countrySource: country ? 'network_observed' : null }
}

export const ADA = fixtureRunner('ada', 'Ada', 'NG')
export const KOFI = fixtureRunner('kofi', 'Kofi', 'GH')
export const LENA = fixtureRunner('lena', 'Lena', 'DE')
export const MARCO = fixtureRunner('marco', 'Marco', 'BR')
export const YUKI = fixtureRunner('yuki', 'Yuki', 'JP')

type BatonSeed = Partial<NetworkBaton> & Pick<NetworkBaton, 'id' | 'mode' | 'origin' | 'holder'>

export function fixtureBaton(seed: BatonSeed): NetworkBaton {
  const handoffCount = seed.handoffCount ?? 0
  const createdAt = seed.createdAt ?? FIXTURE_NOW - 3 * DAY
  const world: StationWorld = seed.world ?? 'metro'
  const countries = seed.lineage?.countries ?? []
  return {
    code: seed.id.toUpperCase(),
    serial: 1,
    title: '',
    displayName: `Fixture relay ${seed.id}`,
    network: 'TestAlbatross',
    value: 100_000,
    createdAt,
    updatedAt: createdAt + handoffCount * HOUR,
    completedAt: null,
    status: 'active',
    handoffCount,
    world,
    route: { seed: `fixture-${seed.id}`, world, tier: 0, sector: 0, sectorStartedLeg: 0 },
    previousRunId: handoffCount > 0 ? `run-${seed.id}-${handoffCount}` : null,
    crewId: null,
    rivalId: null,
    recipientId: null,
    recipientReservedAt: null,
    recipientAcceptedAt: null,
    expiresAt: FIXTURE_NOW + 20 * HOUR,
    lineage: { countries, runners: Math.max(1, handoffCount), ghostWins: 0 },
    quick: null,
    appearance: { handoffCount, ageMs: FIXTURE_NOW - createdAt, countries: countries.length, ghostWins: 0, milestones: [] },
    aliveMs: FIXTURE_NOW - createdAt,
    transactingWallets: handoffCount > 0 ? handoffCount + 1 : 0,
    stops: [{ countryCode: seed.origin.country }],
    ...seed,
  }
}

export function fixtureMetrics(qualifiedHandoffs = 0): NetworkMetrics {
  return {
    linkedWallets: 0,
    transactingWallets: 0,
    qualifiedHandoffs,
    mainnetHandoffs: 0,
    testnetHandoffs: qualifiedHandoffs,
    invites: 0,
    inviteConversions: 0,
    inviteOpens: 0,
    returningWallets: 0,
    quickMatches: 0,
    rematches: 0,
    quickRematches: 0,
    crewActiveDays: 0,
    dailyAttempts: 0,
    chronicleViews: 0,
    shares: 0,
    sessionSeconds: 0,
    foregroundSeconds: 0,
    controlledEvidence: { handoffs: qualifiedHandoffs, wallets: 0 },
    definitions: [],
  }
}

export function emptyNetwork(playerId: string | null = null): NetworkSnapshot {
  return {
    network: 'TestAlbatross',
    batons: [],
    crews: [],
    rivals: [],
    daily: { date: '2026-09-16', world: 'metro', seed: 'daily-2026-09-16-v4', officialRunId: null, leaderboard: [] },
    metrics: fixtureMetrics(),
    playerId,
    runners: [],
    inbox: [],
    invites: [],
    pendingHandoff: null,
    countryConsent: false,
  }
}

export function fixtureProfile(seed: Partial<StationProfile> = {}): StationProfile {
  return {
    id: ADA.id,
    name: ADA.name,
    handle: ADA.handle,
    xp: 2340,
    level: 5,
    seasonRank: 'Vanguard',
    runs: 48,
    handoffs: 12,
    achievements: ['First arrival', 'Baton bearer', 'Ghost hunter'],
    unlocked: ['solar', 'visor', 'vector', 'gold', 'ice', 'comet', 'aurora', 'halo'],
    equipped: { suit: 'midnight', helmet: 'halo', board: 'comet', trail: 'gold' },
    crewId: 'owls',
    ...seed,
  }
}

export function fixtureStation(profile: StationProfile = fixtureProfile()): StationSnapshot {
  return {
    pendingHandoff: null,
    profile,
    global: { holderId: null, holderName: null, leg: 0, world: 'coast', seed: 'route-coast-v4' },
    daily: { date: '2026-09-16', world: 'metro', seed: 'daily-2026-09-16-v4', best: null },
    crews: [],
    rivals: [],
    inbox: [],
    rankings: [
      { id: LENA.id, name: LENA.name, score: 18_420, xp: 5200 },
      { id: ADA.id, name: ADA.name, score: 17_960, xp: 2340 },
      { id: YUKI.id, name: YUKI.name, score: 16_115, xp: 1900 },
      { id: KOFI.id, name: KOFI.name, score: 15_002, xp: 880 },
    ],
    chronicles: [
      { id: 'c2', name: MARCO.name, kind: 'handoff', world: 'ocean', at: FIXTURE_NOW - 5 * HOUR, score: 0, leg: 7 },
      { id: 'c1', name: YUKI.name, kind: 'run', world: 'alpine', at: FIXTURE_NOW - 9 * HOUR, score: 16_115, leg: 6 },
    ],
    cosmetics: [],
  }
}

const OWLS: NetworkCrew = {
  id: 'owls',
  code: 'OWLS42',
  name: 'Night Owls',
  members: [ADA, KOFI, LENA],
  batonIds: ['crew-owls'],
  streak: 4,
  bestStreak: 9,
  todayHandoffs: 0,
  contributions: { ada: 3, kofi: 2 },
  deadline: Date.UTC(2026, 8, 17),
}

/** A signed-in courier with something waiting on every surface. */
export function busyScenario(): { network: NetworkSnapshot; station: StationSnapshot; playerId: string; now: number } {
  const legend = fixtureBaton({
    id: 'legend',
    mode: 'global',
    displayName: 'Global Relay #001',
    origin: LENA,
    holder: MARCO,
    handoffCount: 34,
    createdAt: FIXTURE_NOW - 70 * DAY,
    updatedAt: FIXTURE_NOW - 3 * HOUR,
    lineage: { countries: ['DE', 'NG', 'GH', 'BR', 'JP'], runners: 21, ghostWins: 9 },
    appearance: { handoffCount: 34, ageMs: 70 * DAY, countries: 5, ghostWins: 9, milestones: [10, 25] },
    stops: ['DE', 'NG', 'GH', 'NG', 'BR', 'JP', 'DE', 'BR'].map(countryCode => ({ countryCode })),
  })
  const yourLeg = fixtureBaton({
    id: 'sunrise',
    mode: 'global',
    title: 'Sunrise Run',
    displayName: 'Sunrise Run',
    origin: KOFI,
    holder: ADA,
    handoffCount: 6,
    updatedAt: FIXTURE_NOW - 40 * 60_000,
    lineage: { countries: ['GH', 'NG', 'DE'], runners: 5, ghostWins: 2 },
    stops: [{ countryCode: 'GH' }, { countryCode: 'NG' }, { countryCode: null }, { countryCode: 'DE' }, { countryCode: 'NG' }],
  })
  const quick = fixtureBaton({
    id: 'duel',
    mode: 'quick',
    origin: ADA,
    holder: KOFI,
    handoffCount: 3,
    quick: { players: [ADA.id, KOFI.id], bestOf: 3, scores: { ada: 1, kofi: 0 }, rounds: 1, winnerId: null, rematchOf: null },
  })
  const crewBaton = fixtureBaton({ id: 'crew-owls', mode: 'crew', title: 'Owl Line', displayName: 'Owl Line', origin: LENA, holder: KOFI, crewId: OWLS.id, handoffCount: 11 })
  const rivalA = fixtureBaton({ id: 'north', mode: 'rival', displayName: 'North Stars · Ada', origin: ADA, holder: YUKI, handoffCount: 7, rivalId: 'stars' })
  const rivalB = fixtureBaton({ id: 'south', mode: 'rival', displayName: 'North Stars · Lena', origin: LENA, holder: MARCO, handoffCount: 5, rivalId: 'stars' })
  const rival: NetworkRival = { id: 'stars', title: 'North Stars', batonIds: ['north', 'south'], target: 10, scores: [7, 5], winnerId: null, createdAt: FIXTURE_NOW - 2 * DAY, endsAt: FIXTURE_NOW + 5 * DAY }

  const network: NetworkSnapshot = {
    ...emptyNetwork(ADA.id),
    batons: [yourLeg, quick, crewBaton, legend, rivalA, rivalB],
    crews: [OWLS],
    rivals: [rival],
    daily: {
      date: '2026-09-16',
      world: 'metro',
      seed: 'daily-2026-09-16-v4',
      officialRunId: 'daily-ada',
      leaderboard: [
        { player: LENA, runId: 'd1', score: 18_420, timeMs: 81_200 },
        { player: ADA, runId: 'daily-ada', score: 17_960, timeMs: 83_900 },
        { player: YUKI, runId: 'd3', score: 16_115, timeMs: 88_000 },
      ],
    },
    metrics: fixtureMetrics(61),
    runners: [ADA, KOFI, LENA, MARCO, YUKI],
  }
  return { network, station: fixtureStation(), playerId: ADA.id, now: FIXTURE_NOW }
}

/** Public view of the same network, as a visitor who has not set up a courier. */
export function signedOutScenario(): { network: NetworkSnapshot; station: null; playerId: null; now: number } {
  const { network } = busyScenario()
  return { network: { ...network, playerId: null, inbox: [], pendingHandoff: null, daily: { ...network.daily, officialRunId: null } }, station: null, playerId: null, now: FIXTURE_NOW }
}

export function emptyScenario(): { network: NetworkSnapshot; station: null; playerId: null; now: number } {
  return { network: emptyNetwork(), station: null, playerId: null, now: FIXTURE_NOW }
}
