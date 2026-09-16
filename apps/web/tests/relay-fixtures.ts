import type { Page, Route } from '@playwright/test'
import type { BatonChronicle, BatonDetail, BatonHandoff, CanonicalGhost, NetworkBaton, NetworkMetrics, NetworkRunner, NetworkSnapshot, RunnerProfile, StationSnapshot } from '@nim-relay/shared'

/**
 * Test-only relay network fixtures shaped like the Worker's responses. They
 * exist to exercise populated screens in the browser and are never served by
 * the product.
 */

export const HOUR = 3_600_000
export const hash = (seed: number) => Array.from({ length: 64 }, (_, i) => ((seed * 31 + i * 7) % 16).toString(16)).join('')
/** Compact and upper case, the way the Worker presents addresses in snapshots. */
const wallet = (seed: number) => `NQ${String(10 + seed).padStart(2, '0')}${Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + ((seed + i * 5) % 26)) + String((seed + i) % 10) + String.fromCharCode(66 + ((seed * 3 + i) % 24)) + String((seed * 7 + i) % 10)).join('')}`

function runner(id: string, name: string, handle: string, country: string | null, seed: number): NetworkRunner {
  return { id, name, handle, wallet: wallet(seed), country, countrySource: country ? 'network_observed' : null }
}

export const RUNNERS = {
  ada: runner('p-ada', 'Ada Obi', 'ada', 'NG', 1),
  lena: runner('p-lena', 'Lena Vogel', 'lena', 'DE', 2),
  arjun: runner('p-arjun', 'Arjun Rao', 'arjun', 'IN', 3),
  mei: runner('p-mei', 'Mei Tan', 'mei', 'SG', 4),
  mateo: runner('p-mateo', 'Mateo Silva', 'mateo', 'BR', 5),
  sam: runner('p-sam', 'Sam Reed', 'sam', null, 6),
  wanjiru: runner('p-wanjiru', 'Wanjiru K', 'wanjiru', 'KE', 7),
  thandi: runner('p-thandi', 'Thandi M', 'thandi', 'ZA', 8),
}

export const metrics = (overrides: Partial<NetworkMetrics> = {}): NetworkMetrics => ({
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
  definitions: [
    'Wallets are linked accounts, not verified unique humans.',
    'Qualified handoffs require independent chain verification and canonical replay.',
    'All TestAlbatross activity is test evidence, excluded from mainnet traction.',
    'Countries are consented network observations, VPN-sensitive; unknown locations are not inferred.',
  ],
  ...overrides,
})

export function emptySnapshot(network: NetworkSnapshot['network'] = 'TestAlbatross'): NetworkSnapshot {
  const date = new Date().toISOString().slice(0, 10)
  return {
    network,
    batons: [],
    crews: [],
    rivals: [],
    daily: { date, world: 'metro', seed: `daily-${date}-v4`, officialRunId: null, leaderboard: [] },
    metrics: metrics(),
    playerId: null,
    runners: [],
    inbox: [],
    invites: [],
    pendingHandoff: null,
    countryConsent: false,
  }
}

export function baton(input: { id: string; code: string; serial: number; mode: NetworkBaton['mode']; title: string; path: NetworkRunner[]; createdAt: number; updatedAt: number; status?: NetworkBaton['status']; crewId?: string | null; rivalId?: string | null; recipientId?: string | null; ghostWins?: number }): NetworkBaton {
  const origin = input.path[0] ?? RUNNERS.ada
  const holder = input.path.at(-1) ?? origin
  const handoffCount = input.path.length - 1
  const countries = [...new Set(input.path.slice(1).flatMap((to, index) => [input.path[index]?.country, to.country]).filter((code): code is string => !!code))]
  return {
    id: input.id,
    code: input.code,
    serial: input.serial,
    title: input.title,
    displayName: input.title,
    mode: input.mode,
    network: 'TestAlbatross',
    value: 100_000,
    origin,
    holder,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    completedAt: input.status === 'completed' ? input.updatedAt : null,
    status: input.status ?? 'active',
    handoffCount,
    world: 'coast',
    route: { seed: `baton-${input.code}-v4`, world: 'coast', tier: 0, sector: 0, sectorStartedLeg: 0 },
    previousRunId: handoffCount > 0 ? `run-${input.code}-${handoffCount}` : null,
    crewId: input.crewId ?? null,
    rivalId: input.rivalId ?? null,
    recipientId: input.recipientId ?? null,
    recipientReservedAt: null,
    recipientAcceptedAt: null,
    expiresAt: input.updatedAt + 24 * HOUR,
    lineage: { countries, runners: new Set(input.path.map(item => item.id)).size, ghostWins: input.ghostWins ?? 0 },
    quick: null,
    appearance: { handoffCount, ageMs: input.updatedAt - input.createdAt, countries: countries.length, ghostWins: input.ghostWins ?? 0, milestones: [] },
    aliveMs: (input.status === 'completed' ? input.updatedAt : Date.now()) - input.createdAt,
    transactingWallets: handoffCount === 0 ? 0 : new Set(input.path.map(item => item.wallet)).size,
    stops: input.path.map(item => ({ countryCode: item.country })),
  }
}

export function populatedNetwork(now = Date.now()): { snapshot: NetworkSnapshot; details: Record<string, BatonDetail> } {
  const { ada, lena, arjun, mei, mateo, sam, wanjiru, thandi } = RUNNERS
  const globalPath = [ada, lena, arjun, mei, mateo]
  const global = baton({ id: 'b-global', code: 'G7K2M9Q4XA', serial: 1, mode: 'global', title: 'Global Relay #001', path: globalPath, createdAt: now - 31 * HOUR, updatedAt: now - 0.2 * HOUR, ghostWins: 2 })
  const quick = baton({ id: 'b-quick', code: 'Q8H3WZ21PL', serial: 1, mode: 'quick', title: 'Friday rematch', path: [lena, sam], createdAt: now - 5 * HOUR, updatedAt: now - 1 * HOUR, recipientId: lena.id })
  const crew = baton({ id: 'b-crew', code: 'C4NB7T90RE', serial: 1, mode: 'crew', title: 'Rift Valley Runners relay', path: [wanjiru, thandi], createdAt: now - 20 * HOUR, updatedAt: now - 3 * HOUR, crewId: 'crew-1' })
  const handoffs: BatonHandoff[] = globalPath.slice(1).map((to, index) => {
    const from = globalPath[index] ?? ada
    return {
      id: `h-${index + 1}`,
      batonId: global.id,
      leg: index + 1,
      from,
      to,
      value: 100_000,
      txHash: hash(index + 11),
      network: 'TestAlbatross',
      at: now - (26 - index * 6) * HOUR,
      runId: `run-${global.code}-${index + 1}`,
      resultHash: hash(index + 51),
      qualified: true,
      confirmations: 3,
      blockNumber: 11_600_000 + index * 4_321,
      sector: 0,
      race: { engineVersion: '4', world: 'coast', timeMs: 61_200 - index * 830, score: 18_400 + index * 950, completed: true, ghostRunId: index ? `run-${global.code}-${index}` : null, ghostTimeMs: null, beatGhost: index > 0 ? index % 2 === 1 : null },
      rescue: false,
    }
  })
  const snapshot: NetworkSnapshot = {
    ...emptySnapshot(),
    batons: [global, quick, crew],
    runners: Object.values(RUNNERS),
    metrics: metrics({ linkedWallets: 8, transactingWallets: 7, qualifiedHandoffs: 6, testnetHandoffs: 6, invites: 3, inviteOpens: 3, inviteConversions: 2, returningWallets: 4, quickMatches: 1, dailyAttempts: 5, controlledEvidence: { handoffs: 6, wallets: 7 } }),
    daily: {
      ...emptySnapshot().daily,
      leaderboard: [
        { player: mei, runId: 'daily-1', score: 21_340, timeMs: 58_120 },
        { player: arjun, runId: 'daily-2', score: 19_870, timeMs: 60_040 },
      ],
    },
  }
  const details: Record<string, BatonDetail> = {
    [global.code]: {
      baton: global,
      handoffs,
      ghost: null,
      pendingHandoff: null,
      notableRuns: handoffs.map(item => ({ runId: item.runId, name: item.from.name, score: item.race?.score ?? 0, resultHash: item.resultHash })),
      echoes: [{ id: 'echo-1', batonId: global.id, kind: 'ghost-record', runner: { id: mei.id, name: mei.name }, leg: 3, runId: handoffs[2]?.runId ?? '', sector: 0, dist: null, at: now - 14 * HOUR }],
    },
  }
  return { snapshot, details }
}

const ref = (item: NetworkRunner) => ({ id: item.id, handle: item.handle, name: item.name })

export function chronicleOf(detail: BatonDetail): BatonChronicle {
  const { baton, handoffs } = detail
  return {
    baton: { id: baton.id, code: baton.code, serial: baton.serial, title: baton.title, displayName: baton.displayName, mode: baton.mode, network: baton.network, status: baton.status, value: baton.value, createdAt: baton.createdAt, completedAt: baton.completedAt, origin: ref(baton.origin), holder: ref(baton.holder), route: baton.route, appearance: baton.appearance },
    stops: [{ leg: 0, runner: ref(baton.origin), countryCode: baton.origin.country, at: baton.createdAt }, ...handoffs.map(item => ({ leg: item.leg, runner: ref(item.to), countryCode: item.to.country, at: item.at }))],
    aliveMs: baton.aliveMs,
    qualifiedHandoffs: handoffs.length,
    transactingWallets: baton.transactingWallets,
    countries: baton.lineage.countries.length,
    moments: [
      { kind: 'first-new-country', title: 'First arrival in Germany', runner: ref(RUNNERS.lena), leg: 1, value: 'DE' },
      { kind: 'fastest-leg', title: 'Fastest verified leg', runner: ref(RUNNERS.mei), leg: 4, value: 58_710 },
      { kind: 'closest-ghost-race', title: 'Closest ghost race', runner: ref(RUNNERS.arjun), leg: 3, value: 240 },
    ],
    runners: [ref(baton.origin), ...handoffs.map(item => ref(item.to))],
    transactions: handoffs.map(item => ({ leg: item.leg, txHash: item.txHash, from: item.from.wallet, to: item.to.wallet, blockNumber: item.blockNumber, confirmations: item.confirmations, at: item.at, runId: item.runId, resultHash: item.resultHash })),
    replays: handoffs.map(item => ({ leg: item.leg, runId: item.runId })),
  }
}

export function profileOf(item: NetworkRunner, snapshot: NetworkSnapshot): RunnerProfile {
  const batons = snapshot.batons.filter(baton => baton.origin.id === item.id || baton.holder.id === item.id)
  return {
    handle: item.handle,
    name: item.name,
    level: 3,
    seasonRank: 'Courier',
    country: item.country,
    qualifiedHandoffs: batons.length,
    legs: batons.length,
    ghostWins: 1,
    ghostLosses: 0,
    quick: { wins: 0, losses: 0 },
    crew: null,
    daily: { bestTimeMs: 58_120, entries: 2 },
    historicBatons: batons.map(baton => ({ id: baton.id, code: baton.code, displayName: baton.displayName, handoffCount: baton.handoffCount, role: baton.origin.id === item.id ? 'origin' : 'holder' })),
    achievements: [{ id: 'first-pass', title: 'First pass', unlockedAt: Date.now() - 20 * HOUR }],
    artifacts: [],
    cosmetics: { suit: 'solar', helmet: 'visor', board: 'vector', trail: 'comet' },
    recentRunners: [],
  }
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** A signed-in runner's account: the player, their network view and their station profile. */
export function signedInAs(runner: NetworkRunner, snapshot: NetworkSnapshot): { player: { id: string; handle: string; displayName: string; walletAddress: string }; snapshot: NetworkSnapshot; station: StationSnapshot } {
  const now = Date.now()
  const holding = snapshot.batons.find(baton => baton.holder.id === runner.id)
  return {
    player: { id: runner.id, handle: runner.handle, displayName: runner.name, walletAddress: runner.wallet },
    snapshot: {
      ...snapshot,
      playerId: runner.id,
      countryConsent: runner.country !== null,
      inbox: holding
        ? [
            { id: 'n-1', type: 'incoming_baton', title: `Mei Tan passed you the baton`, body: `${holding.displayName}, handoff ${holding.handoffCount}`, batonId: holding.id, runId: holding.previousRunId, createdAt: now - 14 * HOUR, readAt: now - 13 * HOUR },
            { id: 'n-2', type: 'ghost_beaten', title: 'Arjun Rao beat your ghost', body: holding.displayName, batonId: holding.id, runId: holding.previousRunId, createdAt: now - 2 * HOUR, readAt: null },
            { id: 'n-3', type: 'daily_active', title: 'Today’s Daily is open', body: 'Midnight Metro. One official ride.', batonId: null, runId: null, createdAt: now - 5 * HOUR, readAt: null },
          ]
        : [],
    },
    station: {
      profile: { id: runner.id, name: runner.name, handle: runner.handle, xp: 1_250, level: 3, seasonRank: 'Courier', runs: 14, handoffs: 2, achievements: ['Baton bearer'], unlocked: ['solar', 'visor', 'vector', 'comet', 'ice'], equipped: { suit: 'solar', helmet: 'visor', board: 'vector', trail: 'comet' }, crewId: null },
      global: { holderId: null, holderName: null, leg: 0, world: 'coast', seed: 'fixture' },
      daily: { date: new Date().toISOString().slice(0, 10), world: 'metro', seed: 'fixture', best: null },
      crews: [],
      rivals: [],
      inbox: [],
      rankings: [],
      chronicles: [],
      cosmetics: [
        { id: 'solar', category: 'suit', name: 'Solar suit', xp: 0 },
        { id: 'ice', category: 'suit', name: 'Ice suit', xp: 500 },
        { id: 'midnight', category: 'suit', name: 'Midnight suit', xp: 2_000 },
        { id: 'visor', category: 'helmet', name: 'Clear visor', xp: 0 },
        { id: 'halo', category: 'helmet', name: 'Halo helmet', xp: 3_000 },
        { id: 'vector', category: 'board', name: 'Vector board', xp: 0 },
      ],
    },
  }
}

/**
 * Serves the relay API from fixtures, signed out unless an account is given.
 * Unknown codes answer exactly as the Worker does.
 */
export interface MockNetwork {
  snapshot: NetworkSnapshot
  details?: Record<string, BatonDetail>
  /** Public runner profiles by handle; runners without one get a plain generated profile. */
  profiles?: Record<string, RunnerProfile>
  /** Verified replays by run id. */
  replays?: Record<string, CanonicalGhost>
}

export async function mockRelayApi(page: Page, network: MockNetwork, account?: ReturnType<typeof signedInAs>): Promise<void> {
  await page.routeWebSocket(/\/ws\/network$/, () => undefined)
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/auth/me') return account ? json(route, 200, { player: account.player }) : json(route, 401, { error: 'no_session' })
    if (path === '/api/station/network/public') return json(route, 200, network.snapshot)
    if (account && path === '/api/station/network') return json(route, 200, account.snapshot)
    if (account && path === '/api/station') return json(route, 200, account.station)
    const batonMatch = path.match(/^\/api\/station\/network\/(batons|chronicles)\/([^/]+)$/)
    if (batonMatch) {
      const detail = network.details?.[decodeURIComponent(batonMatch[2] ?? '')]
      if (!detail) return json(route, 404, { error: 'journey_not_found' })
      return json(route, 200, batonMatch[1] === 'chronicles' ? chronicleOf(detail) : detail)
    }
    const runnerMatch = path.match(/^\/api\/station\/network\/runners\/([^/]+)$/)
    if (runnerMatch) {
      const handle = decodeURIComponent(runnerMatch[1] ?? '')
      const found = Object.values(RUNNERS).find(item => item.handle === handle)
      return found ? json(route, 200, network.profiles?.[handle] ?? profileOf(found, network.snapshot)) : json(route, 404, { error: 'runner_not_found' })
    }
    if (path.startsWith('/api/station/network/invites/')) return json(route, 404, { error: 'invite_not_found' })
    const replayMatch = path.match(/^\/api\/station\/network\/replays\/([^/]+)$/)
    if (replayMatch) {
      const replay = network.replays?.[decodeURIComponent(replayMatch[1] ?? '')]
      return replay ? json(route, 200, replay) : json(route, 404, { error: 'verified_replay_not_found' })
    }
    if (path.startsWith('/api/station/network/track')) return json(route, 200, { counted: true })
    return json(route, 401, { error: 'no_session' })
  })
}
