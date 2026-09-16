import { describe, expect, it } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import type { BatonHandoff, HandoffRace, NetworkRunner, RelayLegConfig, RelayLegMetrics, RelayLegResult } from '@nim-relay/shared'
import type { Run } from '../model'
import { ghostSurvivals, runnerArtifacts, unlockAchievement } from './achievements'
import { scoreQuickRound } from './custody'
import { pickDailyGhostEntry } from './daily'
import { recordLegEchoes } from './echoes'
import { isRaced } from './lookups'
import { storedReason, verifierReason } from './reasons'
import { advanceRoute, inheritedOpeningFlow, openingRoute, sectorSeed, tierFor } from './route'
import { freshNetworkState, normalizeNetworkState, type StoredNetworkState } from './state'
import { countInviteOpen, countShare } from './traffic'
import type { BatonRecord, DailyEntry, Member, TrafficState } from './types'

const NOW = Date.UTC(2026, 8, 16, 12)
const DAY = 86_400_000

function courier(id: string): NetworkRunner {
  return { id, handle: `runner-${id}`, name: `Runner ${id}`, wallet: `NQ00${id.toUpperCase()}`, country: null, countrySource: null }
}

function member(completedRuns: number): Member {
  return { consent: false, country: null, firstSeen: NOW, lastSeen: NOW, days: [], foreground: 0, lastHeartbeat: NOW, completedRuns, legs: 0, legMarks: {} }
}

function batonRecord(overrides: Partial<BatonRecord> = {}): BatonRecord {
  const origin = courier('origin')
  return {
    id: 'baton-1', code: 'CODE000001', serial: 1, title: '', displayName: 'Global Relay #001', mode: 'global', network: 'TestAlbatross', value: 100_000,
    origin, holder: origin, createdAt: NOW, updatedAt: NOW, completedAt: null, status: 'active', handoffCount: 0, world: 'coast',
    route: openingRoute('CODE000001', 'coast', 1), previousRunId: null, crewId: null, rivalId: null,
    recipientId: null, recipientReservedAt: null, recipientAcceptedAt: null, expiresAt: NOW + DAY,
    lineage: { countries: [], runners: 1, ghostWins: 0 }, quick: null,
    ...overrides,
  }
}

function race(overrides: Partial<HandoffRace> = {}): HandoffRace {
  return { engineVersion: '5', world: 'coast', timeMs: 50_000, score: 180_000, completed: true, ghostRunId: null, ghostTimeMs: null, beatGhost: null, ...overrides }
}

function handoff(leg: number, fromId: string, overrides: Partial<BatonHandoff> = {}): BatonHandoff {
  return {
    id: `handoff-${leg}`, batonId: 'baton-1', leg, from: courier(fromId), to: courier(`${fromId}-next`), value: 100_000, txHash: 'a'.repeat(64),
    network: 'TestAlbatross', at: NOW + leg, runId: `run-${leg}`, resultHash: 'hash', qualified: true, confirmations: 2, blockNumber: 100 + leg,
    sector: 0, race: race(), rescue: false,
    ...overrides,
  }
}

const NO_METRICS: RelayLegMetrics = { perfectGates: 0, totalGates: 0, pulseHits: 0, nearMisses: 0, hits: 0, falls: 0, jumps: 0, cleanLandings: 0, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 0, flowSum: 0, flowPeak: 0 }

function relayRun(metrics: Partial<RelayLegMetrics>, result: Partial<Omit<RelayLegResult, 'metrics'>> = {}): Run {
  const config: RelayLegConfig = { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'rules-seed', world: 'coast', tier: 1, openingFlow: 0 }
  return {
    issued: { networkRace: true, relayLeg: 0, runId: 'run-1', playerId: 'origin', mode: 'global', config, expiresAt: NOW, target: null, mac: '', ghost: null },
    result: { resultHash: 'hash', ticks: 3_000, timeMs: 50_000, completed: true, score: 180_000, ...result, metrics: { ...NO_METRICS, ...metrics } },
    inputTrace: [[0, 0, 0]],
    at: NOW,
  }
}

describe('leg tiers', () => {
  it('opens forgiving courses until a runner has three completed verified runs', () => {
    // #given one runner with two completed runs and one with three
    const state = freshNetworkState()
    state.members = { rookie: member(2), regular: member(3) }
    // #when their tiers are read
    const tiers = [tierFor(state, 'rookie'), tierFor(state, 'regular')]
    // #then only the rookie gets the forgiving tier
    expect(tiers).toEqual([0, 1])
  })

  it('opens veteran courses from forty qualified handoffs', () => {
    // #given a runner with forty qualified handoffs and one with thirty-nine
    const state = freshNetworkState()
    state.members = { veteran: member(40), close: member(39) }
    state.handoffs = [
      ...Array.from({ length: 40 }, (_, index) => handoff(index + 1, 'veteran')),
      ...Array.from({ length: 39 }, (_, index) => handoff(index + 1, 'close')),
    ]
    // #when their tiers are read
    const tiers = [tierFor(state, 'veteran'), tierFor(state, 'close')]
    // #then the veteran tier starts at forty
    expect(tiers).toEqual([2, 1])
  })
})

describe('inherited opening FLOW', () => {
  it('is a quarter of the previous canonical run average FLOW', () => {
    // #given a run averaging 20000 FLOW per tick
    const previous = relayRun({ flowSum: 3_000 * 20_000 }, { ticks: 3_000 })
    // #when the next leg inherits from it
    // #then it opens with a quarter of that average
    expect(inheritedOpeningFlow(previous)).toBe(5_000)
  })

  it('never exceeds the engine bound', () => {
    // #given a previous run whose quarter average would exceed the bound
    const previous = relayRun({ flowSum: 3_000 * 100_000 }, { ticks: 3_000 })
    // #then the inherited FLOW is capped
    expect(inheritedOpeningFlow(previous)).toBe(relayLeg.MAX_OPENING_FLOW)
  })

  it('is zero without a previous relay leg run', () => {
    // #given no previous run, and a station v4 run
    const stationRun: Run = { ...relayRun({}), result: { resultHash: 'hash', ticks: 3_000, timeMs: 50_000, completed: true, score: 1, metrics: { hazardsHit: 0, nearMisses: 0, gates: 0, missedGates: 0, beatHits: 0, boostTicks: 0, overheats: 0, jumps: 0, landings: 0, grindTicks: 0, shortcutTicks: 0 } } }
    // #then neither passes FLOW on
    expect([inheritedOpeningFlow(undefined), inheritedOpeningFlow(stationRun)]).toEqual([0, 0])
  })
})

describe('route sectors', () => {
  it('keeps the sector course before ten qualified handoffs', () => {
    // #given a global baton after nine handoffs
    const baton = batonRecord({ handoffCount: 9 })
    const before = baton.route
    // #when the route advances
    advanceRoute(baton, 2)
    // #then the course is unchanged
    expect(baton.route).toEqual(before)
  })

  it('opens the next world on a new seed at ten qualified handoffs', () => {
    // #given a global baton reaching its tenth handoff on the coast
    const baton = batonRecord({ handoffCount: 10 })
    // #when the route advances for an opener on tier 2
    advanceRoute(baton, 2)
    // #then sector 1 starts on the next world in rotation with its own seed
    expect({ route: baton.route, world: baton.world }).toEqual({
      route: { seed: sectorSeed('CODE000001', 1), world: relayLeg.WORLDS[1], tier: 2, sector: 1, sectorStartedLeg: 10 },
      world: relayLeg.WORLDS[1],
    })
  })

  it('keeps a Quick match on one sector for the whole match', () => {
    // #given a quick baton at ten handoffs
    const baton = batonRecord({ mode: 'quick', handoffCount: 10 })
    const before = baton.route
    // #when the route advances
    advanceRoute(baton, 0)
    // #then the match keeps its opening course
    expect(baton.route).toEqual(before)
  })
})

describe('daily ghost selection', () => {
  const SEED = 'daily-2026-09-16-v5'
  const entry = (runId: string, timeMs: number, overrides: Partial<DailyEntry> = {}): DailyEntry => ({ runId, score: 300_000 - timeMs, timeMs, seed: SEED, completed: true, ...overrides })
  const board: Record<string, DailyEntry> = {
    fast: entry('fast', 40_000),
    quick: entry('quick', 45_000),
    middle: entry('middle', 50_000),
    steady: entry('steady', 55_000),
    slow: entry('slow', 60_000),
  }

  it('races a runner without a result against the median official entry', () => {
    // #when a newcomer asks for a ghost
    // #then the middle of five entries is chosen
    expect(pickDailyGhostEntry(board, 'newcomer', SEED, null)?.runId).toBe('middle')
  })

  it('picks the entry ranked just above the runner personal best', () => {
    // #given a personal best of 52 s
    // #then the slowest entry still faster than it is chosen
    expect(pickDailyGhostEntry(board, 'newcomer', SEED, 52_000)?.runId).toBe('middle')
  })

  it('falls back to the nearest slower entry for the fastest runner', () => {
    // #given a personal best faster than every entry
    // #then the fastest other entry is chosen
    expect(pickDailyGhostEntry(board, 'newcomer', SEED, 30_000)?.runId).toBe('fast')
  })

  it('never selects the runner own official run', () => {
    // #given the fastest runner asks with their own best
    // #then their own entry is skipped
    expect(pickDailyGhostEntry(board, 'fast', SEED, 40_000)?.runId).toBe('quick')
  })

  it('ignores incomplete runs and other courses', () => {
    // #given only an incomplete entry and one from the v4 course
    const other = { stalled: entry('stalled', 90_000, { completed: false }), legacy: entry('legacy', 50_000, { seed: 'daily-2026-09-16-v4' }) }
    // #then no ghost is available
    expect(pickDailyGhostEntry(other, 'newcomer', SEED, null)).toBeNull()
  })
})

describe('achievements', () => {
  it('unlock once and keep a single artifact', () => {
    // #given a runner unlocking FIRST PASS twice
    const state = freshNetworkState()
    const source = { subtitle: 'Global Relay #001 · Handoff 1', batonId: 'baton-1', leg: 1, at: NOW }
    const unlocks = [unlockAchievement(state, 'runner', 'first-pass', source), unlockAchievement(state, 'runner', 'first-pass', { ...source, at: NOW + 1 })]
    // #then only the first unlock counts
    expect({ unlocks, artifacts: runnerArtifacts(state, 'runner').map(artifact => [artifact.kind, artifact.at]) }).toEqual({ unlocks: [true, false], artifacts: [['first-pass', NOW]] })
  })

  it('count ghost survival until a later runner outscores the leg', () => {
    // #given a leg followed by two failed attempts, its own runner, a winning attempt and another failure
    const legs = [
      handoff(1, 'wall', { race: race({ score: 200_000 }) }),
      handoff(2, 'b', { race: race({ score: 150_000 }) }),
      handoff(3, 'c', { race: race({ score: 199_999 }) }),
      handoff(4, 'wall', { race: race({ score: 100_000 }) }),
      handoff(5, 'd', { race: race({ score: 200_001 }) }),
      handoff(6, 'e', { race: race({ score: 10 }) }),
    ].filter(isRaced)
    // #then only the attempts before the winning one count
    expect(ghostSurvivals(legs[0]!, legs)).toBe(2)
  })
})

describe('relay echoes', () => {
  it('mark the fastest canonical leg on a sector as its ghost record', () => {
    // #given a slower earlier leg and a faster latest leg on sector 0
    const state = freshNetworkState()
    const latest = handoff(2, 'b', { race: race({ timeMs: 41_000 }) })
    state.handoffs = [handoff(1, 'a', { race: race({ timeMs: 45_000 }) }), latest]
    // #when the latest leg leaves its echoes
    recordLegEchoes(state, latest, relayRun({}))
    // #then it holds the sector's ghost record
    expect(state.echoes['baton-1']?.map(echo => [echo.kind, echo.leg, echo.sector])).toEqual([['ghost-record', 2, 0]])
  })

  it('place the first risk-route finisher at the fork once per sector', () => {
    // #given two slower risk-route legs after a faster first leg
    const state = freshNetworkState()
    const first = handoff(1, 'a', { race: race({ timeMs: 60_000 }) })
    const second = handoff(2, 'b', { race: race({ timeMs: 61_000 }) })
    state.handoffs = [handoff(0, 'fast', { race: race({ timeMs: 30_000 }) }), first, second]
    const riskRun = relayRun({ riskRoutes: 1 })
    // #when both leave echoes
    recordLegEchoes(state, first, riskRun)
    recordLegEchoes(state, second, riskRun)
    // #then only the first is the pioneer, standing where the fork opens
    const config = riskRun.issued.config.engineVersion === '5' ? riskRun.issued.config : null
    const forkFrom = config ? relayLeg.buildTrack(config).fork.from : null
    expect(state.echoes['baton-1']?.map(echo => [echo.kind, echo.leg, echo.dist])).toEqual([['risk-pioneer', 1, forkFrom]])
  })

  it('mark near-miss legends, rescues and handoff milestones', () => {
    // #given the tenth handoff rescued a stranded baton with six near misses, behind a faster leg
    const state = freshNetworkState()
    const tenth = handoff(10, 'b', { rescue: true, race: race({ timeMs: 70_000 }) })
    state.handoffs = [handoff(9, 'a', { race: race({ timeMs: 40_000 }) }), tenth]
    // #when it leaves echoes
    recordLegEchoes(state, tenth, relayRun({ nearMisses: 6 }))
    // #then each earned kind is recorded once
    expect(state.echoes['baton-1']?.map(echo => echo.kind).sort()).toEqual(['milestone', 'near-miss-legend', 'rescue'])
  })
})

describe('quick rounds', () => {
  const quickBaton = (scores: Record<string, number>, rounds: number): BatonRecord =>
    batonRecord({ mode: 'quick', quick: { players: ['a', 'b'], bestOf: 3, scores, rounds, winnerId: null, rematchOf: null } })

  it('split a tied round and never invent a match winner', () => {
    // #given a best-of-three at one round each
    const baton = quickBaton({ a: 1, b: 1 }, 2)
    // #when the deciding round ties
    scoreQuickRound(baton, { runnerId: 'a', score: 180_000 }, { runnerId: 'b', score: 180_000 })
    // #then the match completes without a winner
    expect({ status: baton.status, quick: baton.quick }).toEqual({ status: 'completed', quick: { players: ['a', 'b'], bestOf: 3, scores: { a: 1, b: 1 }, rounds: 3, winnerId: null, rematchOf: null } })
  })

  it('award a round to the higher verified score and close a clinched match', () => {
    // #given runner b already won a round
    const baton = quickBaton({ a: 0, b: 1 }, 1)
    // #when b outscores a again
    scoreQuickRound(baton, { runnerId: 'a', score: 150_000 }, { runnerId: 'b', score: 160_000 })
    // #then b clinches the match
    expect([baton.status, baton.quick?.winnerId, baton.quick?.rounds]).toEqual(['completed', 'b', 2])
  })
})

describe('stored network state', () => {
  const legacyRunner = courier('origin')
  const legacy = {
    version: 7,
    batons: {
      later: { id: 'later', code: 'LATER00001', title: 'Coast to coast', mode: 'global', network: 'TestAlbatross', value: 100_000, origin: legacyRunner, holder: courier('b'), createdAt: NOW + 5, updatedAt: NOW + 9, status: 'active', handoffCount: 3, world: 'alpine', previousRunId: 'run-3', crewId: null, rivalId: null, recipientId: 'c', expiresAt: NOW + DAY, lineage: { countries: [], runners: 2, ghostWins: 0 }, quick: null },
      first: { id: 'first', code: 'FIRST00001', title: 'Quick one', mode: 'quick', network: 'TestAlbatross', value: 100_000, origin: legacyRunner, holder: legacyRunner, createdAt: NOW, updatedAt: NOW + 2, status: 'completed', handoffCount: 0, world: 'coast', previousRunId: null, crewId: null, rivalId: null, recipientId: 'b', expiresAt: NOW + DAY, lineage: { countries: [], runners: 1, ghostWins: 0 }, quick: { players: ['origin', 'b'], bestOf: 3, scores: { origin: 0, b: 0 }, rounds: 0, winnerId: null, rematchOf: null } },
      second: { id: 'second', code: 'SECOND0001', title: 'Second relay', mode: 'global', network: 'TestAlbatross', value: 100_000, origin: legacyRunner, holder: legacyRunner, createdAt: NOW + 1, updatedAt: NOW + 1, status: 'active', handoffCount: 0, world: 'coast', previousRunId: null, crewId: null, rivalId: null, recipientId: null, expiresAt: NOW + DAY, lineage: { countries: [], runners: 1, ghostWins: 0 }, quick: null },
    },
    handoffs: [{ id: 'h1', batonId: 'later', leg: 1, from: legacyRunner, to: courier('b'), value: 100_000, txHash: 'b'.repeat(64), network: 'TestAlbatross', at: NOW + 3, runId: 'run-0', resultHash: 'hash', qualified: true, confirmations: 2, blockNumber: 10 }],
    intents: { i1: { id: 'i1', batonId: 'later', runId: 'run-3', recipientId: 'c', recipientName: 'C', sender: 'NQ00B', recipient: 'NQ00C', value: 100_000, data: 'NR1.LATER00001.4.AAAAAAAAAAAAAAAAAAAAAA', network: 'TestAlbatross', leg: 4, status: 'pending', txHash: 'c'.repeat(64), createdAt: NOW, expiresAt: NOW, attemptedAt: NOW, state: 'submitted', failure: 'fetch failed' } },
    notifications: {},
    invites: {},
    rivals: [],
    members: { origin: { consent: false, country: null, firstSeen: NOW, lastSeen: NOW, days: [], foreground: 12, lastHeartbeat: NOW } },
    daily: { '2026-09-15': { origin: { runId: 'daily-run', score: 95_000, timeMs: 50_000 } } },
    dailyIssues: {},
    crewDays: {},
    rematches: 0,
    dirty: false,
  } satisfies StoredNetworkState

  it('numbers batons written before serials in creation order per mode', () => {
    // #when legacy state loads
    const state = normalizeNetworkState(legacy)
    // #then serials and display names follow creation order within each mode
    expect(['first', 'second', 'later'].map(id => [state.batons[id]?.serial, state.batons[id]?.displayName])).toEqual([[1, 'Quick one'], [1, 'Second relay'], [2, 'Coast to coast']])
  })

  it('starts a sector for existing batons at their current leg without a ghost', () => {
    // #when legacy state loads
    const baton = normalizeNetworkState(legacy).batons.later
    // #then the baton continues its world on a standard course that starts now
    expect(baton?.route).toEqual({ seed: sectorSeed('LATER00001', 0), world: 'alpine', tier: 1, sector: 0, sectorStartedLeg: 3 })
  })

  it('treats reservations made after a handoff as accepted and earlier ones as waiting', () => {
    // #when legacy state loads
    const { batons } = normalizeNetworkState(legacy)
    // #then acceptance is only assumed once the match or relay was under way
    expect([batons.later?.recipientAcceptedAt, batons.first?.recipientAcceptedAt, batons.first?.completedAt]).toEqual([NOW + 9, null, NOW + 2])
  })

  it('keeps earlier records readable with explicit gaps for facts never recorded', () => {
    // #when legacy state loads
    const state = normalizeNetworkState(legacy)
    // #then missing race facts are null, old failure text becomes a reason code, and counters start at zero
    expect({
      handoff: [state.handoffs[0]?.sector, state.handoffs[0]?.race, state.handoffs[0]?.rescue],
      failure: state.intents.i1?.failure,
      daily: state.daily['2026-09-15']?.origin,
      member: [state.members.origin?.completedRuns, state.members.origin?.legs],
    }).toEqual({
      handoff: [null, null, false],
      failure: 'RPC_UNAVAILABLE',
      daily: { runId: 'daily-run', score: 95_000, timeMs: 50_000, seed: 'daily-2026-09-15-v4', completed: true },
      member: [0, 0],
    })
  })
})

describe('public traffic counters', () => {
  const traffic = (): TrafficState => ({ day: '', chronicleViews: 0, inviteOpens: 0, shares: 0, openedInvites: [], sharesToday: {} })

  it('count an invitation link once per UTC day', () => {
    // #given one link opened twice today and again tomorrow
    const counters = traffic()
    const counted = [countInviteOpen(counters, 'token-hash', NOW), countInviteOpen(counters, 'token-hash', NOW + 60_000), countInviteOpen(counters, 'token-hash', NOW + DAY)]
    // #then it counts on each day once
    expect({ counted, opens: counters.inviteOpens }).toEqual({ counted: [true, false, true], opens: 2 })
  })

  it('cap shares per actor and anonymous shares across the network', () => {
    // #given a runner sharing 25 times and 250 anonymous devices sharing once each
    const counters = traffic()
    const runnerCounted = Array.from({ length: 25 }, () => countShare(counters, 'runner:a', false, NOW)).filter(Boolean).length
    const anonymousCounted = Array.from({ length: 250 }, (_, index) => countShare(counters, `visitor:${index}`, true, NOW)).filter(Boolean).length
    // #then both caps hold
    expect({ runnerCounted, anonymousCounted, shares: counters.shares }).toEqual({ runnerCounted: 20, anonymousCounted: 200, shares: 220 })
  })
})

describe('handoff reason codes', () => {
  it('report self transfers as recipient mismatches and old failure text as unavailable lookups', () => {
    // #then verifier and stored reasons map onto the fixed code set
    expect([verifierReason('SELF_TRANSFER'), verifierReason('DATA_LEG_MISMATCH'), storedReason('Transaction hash mismatch'), storedReason('INSUFFICIENT_CONFIRMATIONS'), storedReason(null)]).toEqual([
      'RECIPIENT_MISMATCH',
      'DATA_LEG_MISMATCH',
      'RPC_UNAVAILABLE',
      'INSUFFICIENT_CONFIRMATIONS',
      null,
    ])
  })
})
