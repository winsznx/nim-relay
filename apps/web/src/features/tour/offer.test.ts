import { describe, expect, it } from 'vitest'
import type { NetworkBaton, NetworkNotification, NetworkSnapshot } from '@nim-relay/shared'
import { entryRouteOf } from './entry-route'
import { hasUrgentState, isUrgentRoute, offerDecision, readSessionFlags, writeSessionFlags, type OfferInput, type SessionStore } from './offer'

const calm: OfferInput = {
  tourState: 'not_seen',
  touring: false,
  settled: true,
  urgent: false,
  entryUrgent: false,
  onWorldHome: true,
  flags: { offered: false, deferred: false, nudged: false },
}

const decide = (overrides: Partial<OfferInput>) => offerDecision({ ...calm, ...overrides })

function snapshot(overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  return {
    network: 'TestAlbatross',
    batons: [],
    crews: [],
    rivals: [],
    daily: { date: '2026-09-17', world: 'metro', seed: 'seed', officialRunId: null, leaderboard: [] },
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
    playerId: 'p-me',
    runners: [],
    inbox: [],
    invites: [],
    pendingHandoff: null,
    countryConsent: false,
    ...overrides,
  }
}

const runner = (id: string) => ({ id, name: id, handle: id, wallet: `NQ00${id}`, country: null, countrySource: null })

function baton(overrides: Partial<NetworkBaton>): NetworkBaton {
  return {
    id: 'b-1',
    code: 'CODE000001',
    serial: 1,
    title: 'Relay',
    displayName: 'Relay',
    mode: 'global',
    network: 'TestAlbatross',
    value: 100_000,
    origin: runner('p-origin'),
    holder: runner('p-other'),
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    status: 'active',
    handoffCount: 1,
    world: 'coast',
    route: { seed: 's', world: 'coast', tier: 0, sector: 0, sectorStartedLeg: 0, routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' },
    previousRunId: null,
    crewId: null,
    rivalId: null,
    recipientId: null,
    recipientReservedAt: null,
    recipientAcceptedAt: null,
    expiresAt: 0,
    lineage: { countries: [], runners: 1, ghostWins: 0 },
    quick: null,
    appearance: { handoffCount: 1, ageMs: 0, countries: 0, ghostWins: 0, milestones: [] },
    aliveMs: 0,
    transactingWallets: 1,
    ...overrides,
  }
}

const notice = (type: NetworkNotification['type'], readAt: number | null): NetworkNotification => ({ id: `n-${type}`, type, title: type, body: '', batonId: 'b-1', runId: null, createdAt: 0, readAt })

describe('first-run tour offer', () => {
  it('offers the tour once the world home is calm and loaded', () => {
    // #then a calm, settled first visit gets the offer, and an unsettled one waits
    expect([decide({}), decide({ settled: false }), decide({ onWorldHome: false })]).toEqual(['offer', 'wait', 'wait'])
  })

  it('never offers a tour already started, completed or skipped, or one running now', () => {
    // #then none of these get an offer
    expect([decide({ tourState: 'started' }), decide({ tourState: 'completed' }), decide({ tourState: 'skipped' }), decide({ touring: true })]).toEqual(['none', 'none', 'none', 'none'])
  })

  it('defers when the visit starts on a leg or an invitation, or something urgent is waiting', () => {
    // #then urgency defers even before loading settles
    expect([decide({ entryUrgent: true, settled: false }), decide({ urgent: true })]).toEqual(['defer', 'defer'])
  })

  it('follows an urgent visit with the quiet prompt once the world home is calm again', () => {
    // #given a deferred session
    const flags = { offered: false, deferred: true, nudged: false }
    // #then it waits while urgent or away from home, then nudges instead of offering
    expect([decide({ flags, entryUrgent: true, urgent: true }), decide({ flags, entryUrgent: true, onWorldHome: false }), decide({ flags, entryUrgent: true })]).toEqual(['wait', 'wait', 'nudge'])
  })

  it('shows the offer or the prompt at most once per session', () => {
    // #then a session that already showed either gets neither again
    expect([decide({ flags: { offered: true, deferred: false, nudged: false } }), decide({ flags: { offered: false, deferred: true, nudged: true } })]).toEqual(['none', 'none'])
  })
})

describe('urgent state', () => {
  it('treats races and invitations as urgent routes', () => {
    expect([isUrgentRoute('leg'), isUrgentRoute('invite'), isUrgentRoute('world'), isUrgentRoute('inbox')]).toEqual([true, true, false, false])
  })

  it('finds an unread arrival, a leg to carry, a reservation and a pass to finish, and nothing for visitors', () => {
    // #given the states a runner might come back to
    const cases = {
      calm: snapshot({ batons: [baton({})], inbox: [notice('incoming_baton', 5), notice('ghost_beaten', null)] }),
      arrival: snapshot({ inbox: [notice('incoming_baton', null)] }),
      turn: snapshot({ inbox: [notice('your_turn', null)] }),
      carrying: snapshot({ batons: [baton({ holder: runner('p-me') })] }),
      reserved: snapshot({ batons: [baton({ recipientId: 'p-me' })] }),
      accepted: snapshot({ batons: [baton({ recipientId: 'p-me', recipientAcceptedAt: 1 })] }),
    }
    // #then only the ones that need this runner count, and a signed-out visitor never has any
    expect({ ...Object.fromEntries(Object.entries(cases).map(([name, value]) => [name, hasUrgentState(value, 'p-me')])), visitor: hasUrgentState(cases.arrival, null) }).toEqual({
      calm: false,
      arrival: true,
      turn: true,
      carrying: true,
      reserved: true,
      accepted: false,
      visitor: false,
    })
  })
})

describe('tour session flags', () => {
  it('round-trip through session storage and fall back to none when it is missing or broken', () => {
    // #given working, empty and throwing storage
    const values = new Map<string, string>()
    const working: SessionStore = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
    const broken: SessionStore = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    // #when flags are written and read back
    writeSessionFlags('core', 'v1', { offered: true, deferred: false, nudged: true }, () => working)
    const originalWarn = console.warn
    console.warn = () => undefined
    try {
      writeSessionFlags('core', 'v1', { offered: true, deferred: true, nudged: true }, () => broken)
    } finally {
      console.warn = originalWarn
    }
    // #then working storage keeps them per tour version and the rest read as none
    expect([readSessionFlags('core', 'v1', () => working), readSessionFlags('core', 'v2', () => working), readSessionFlags('core', 'v1', () => broken), readSessionFlags('core', 'v1', () => null)]).toEqual([
      { offered: true, deferred: false, nudged: true },
      { offered: false, deferred: false, nudged: false },
      { offered: false, deferred: false, nudged: false },
      { offered: false, deferred: false, nudged: false },
    ])
  })
})

describe('tour entry route', () => {
  it('keeps the route pattern and drops parameters', () => {
    // #then tokens, codes and handles never leave the device
    expect(['/', '/invite/9f8e7d6c', '/relay/G7K2M9Q4XA', '/runner/mateo', '/leg/practice', '/somewhere/else'].map(entryRouteOf)).toEqual(['/', '/invite/:token', '/relay/:code', '/runner/:handle', '/leg/:code', '/not-found'])
  })
})
