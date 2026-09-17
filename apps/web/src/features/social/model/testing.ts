import type { NetworkBaton, NetworkCrew, NetworkDaily, NetworkNotification, NetworkRunner, NetworkSnapshot } from '@nim-relay/shared'

/** Builders for unit tests of the social view models. Not used by the product. */

export const HOUR = 3_600_000

export function runner(id: string, name = id): NetworkRunner {
  return { id, name, handle: id, wallet: `NQ00${id.toUpperCase().padEnd(32, '0')}`, country: null, countrySource: null }
}

export function baton(overrides: Partial<NetworkBaton> & Pick<NetworkBaton, 'id' | 'holder'>): NetworkBaton {
  const origin = overrides.origin ?? overrides.holder
  return {
    code: overrides.id.toUpperCase(),
    serial: 1,
    title: overrides.id,
    displayName: overrides.id,
    mode: 'global',
    network: 'TestAlbatross',
    value: 100_000,
    origin,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    status: 'active',
    handoffCount: 0,
    world: 'coast',
    route: { seed: 'seed', world: 'coast', tier: 0, sector: 0, sectorStartedLeg: 0, routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' },
    previousRunId: null,
    crewId: null,
    rivalId: null,
    recipientId: null,
    recipientReservedAt: null,
    recipientAcceptedAt: null,
    expiresAt: 24 * HOUR,
    lineage: { countries: [], runners: 1, ghostWins: 0 },
    quick: null,
    appearance: { handoffCount: 0, ageMs: 0, countries: 0, ghostWins: 0, milestones: [] },
    aliveMs: 0,
    transactingWallets: 0,
    ...overrides,
  }
}

export function crew(overrides: Partial<NetworkCrew> & Pick<NetworkCrew, 'id' | 'members'>): NetworkCrew {
  return { code: null, name: overrides.id, batonIds: [], streak: 0, bestStreak: 0, todayHandoffs: 0, contributions: {}, deadline: 24 * HOUR, ...overrides }
}

export function notification(overrides: Partial<NetworkNotification> & Pick<NetworkNotification, 'id' | 'type'>): NetworkNotification {
  return { title: overrides.id, body: '', batonId: null, runId: null, createdAt: 0, readAt: null, ...overrides }
}

export function daily(leaderboard: NetworkDaily['leaderboard'], officialRunId: string | null = null): NetworkDaily {
  return { date: '2026-09-16', world: 'metro', seed: 'daily-2026-09-16-v5', officialRunId, leaderboard }
}

export function snapshot(overrides: Partial<NetworkSnapshot>): NetworkSnapshot {
  return {
    network: 'TestAlbatross',
    batons: [],
    crews: [],
    rivals: [],
    daily: daily([]),
    metrics: {
      linkedWallets: 0,
      transactingWallets: 0,
      qualifiedHandoffs: 0,
      mainnetHandoffs: 0,
      testnetHandoffs: 0,
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
      controlledEvidence: { handoffs: 0, wallets: 0 },
      definitions: [],
    },
    playerId: null,
    runners: [],
    inbox: [],
    invites: [],
    pendingHandoff: null,
    countryConsent: false,
    ...overrides,
  }
}
