import { describe, expect, it } from 'vitest'
import { relayLeg, relayLegV5 } from '@nim-relay/game-engine'
import type { BatonHandoff, HandoffRace, NetworkRunner, RelayEcho, RelayEchoKind, RelayLegMoment, RelayLegV5Config, RelayLegV5Metrics, RelayLegV5Result, RelayLegV6Config, RelayLegV6Metrics, RelayLegV6Result } from '@nim-relay/shared'
import type { Run } from '../model'
import { ghostSurvivals, runnerArtifacts, unlockAchievement } from './achievements'
import { scoreQuickRound } from './custody'
import { pickDailyGhostEntry } from './daily'
import { batonEchoes, legEchoes, recordLegEchoes } from './echoes'
import { isRaced } from './lookups'
import { storedReason, verifierReason } from './reasons'
import { atlasRoute, genesisRouteFor, type AtlasRoute } from '@nim-relay/shared'
import { inheritedOpeningFlow, moveToAtlasRoute, nextLegRoute, openingRoute, sectorSeed, tierFor } from './route'
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

/** A pre-Atlas coast sector course, placed on the Genesis route into the coast. */
const LEGACY_COAST_ROUTE = { ...openingRoute(genesisRouteFor('coast')), seed: sectorSeed('CODE000001', 0), tier: 1 as const }

function atlas(id: string): AtlasRoute {
  const route = atlasRoute(id)
  if (!route) throw new Error(`unknown route ${id}`)
  return route
}

function batonRecord(overrides: Partial<BatonRecord> = {}): BatonRecord {
  const origin = courier('origin')
  return {
    id: 'baton-1', code: 'CODE000001', serial: 1, title: '', displayName: 'Global Relay #001', mode: 'global', network: 'TestAlbatross', value: 100_000,
    origin, holder: origin, createdAt: NOW, updatedAt: NOW, completedAt: null, status: 'active', handoffCount: 0, world: 'coast',
    route: LEGACY_COAST_ROUTE, previousRunId: null, crewId: null, rivalId: null,
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
    sector: 0, race: race(), rescue: false, note: null, atlas: { ...LEGACY_COAST_ROUTE, backfilled: true, onCourse: false },
    ...overrides,
  }
}

const NO_V5_METRICS: RelayLegV5Metrics = { perfectGates: 0, totalGates: 0, pulseHits: 0, nearMisses: 0, hits: 0, falls: 0, jumps: 0, cleanLandings: 0, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 0, flowSum: 0, flowPeak: 0 }
const NO_V6_METRICS: RelayLegV6Metrics = {
  perfectGates: 0, totalGates: 0, pulseHits: 0, nearMisses: 0, hits: 0, falls: 0, jumps: 0, cleanLandings: 0, hardLandings: 0, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 0,
  laneChanges: 0, cleanLaneChanges: 0, edgeGrinds: 0, edgeSaves: 0, tetherSaves: 0, draftTicks: 0, overtakes: 0, rushes: 0, rushTicks: 0, flowSum: 0, flowPeak: 0,
}
const METRE = 65_536

function v5Run(metrics: Partial<RelayLegV5Metrics>, result: Partial<Omit<RelayLegV5Result, 'metrics'>> = {}, course: Partial<RelayLegV5Config> = {}): Run {
  const config: RelayLegV5Config = { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'rules-seed', world: 'coast', tier: 1, openingFlow: 0, ...course }
  return {
    issued: { networkRace: true, relayLeg: 0, runId: 'run-1', playerId: 'origin', mode: 'global', config, expiresAt: NOW, target: null, mac: '', ghost: null },
    result: { resultHash: 'hash', ticks: 3_000, timeMs: 50_000, completed: true, score: 180_000, ...result, metrics: { ...NO_V5_METRICS, ...metrics } },
    inputTrace: [[0, 0, 0]],
    at: NOW,
  }
}

const V6_CONFIG: RelayLegV6Config = { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: 'rules-seed', world: 'coast', tier: 1, openingFlow: 0, tetherSaves: 1, ghostline: null }

function v6Run(moments: readonly RelayLegMoment[], result: Partial<Omit<RelayLegV6Result, 'metrics' | 'moments'>> = {}, course: Partial<RelayLegV6Config> = {}): Run {
  return {
    issued: { networkRace: true, relayLeg: 0, runId: 'run-1', playerId: 'origin', mode: 'global', config: { ...V6_CONFIG, ...course }, expiresAt: NOW, target: null, mac: '', ghost: null },
    result: { resultHash: 'hash', ticks: 3_000, timeMs: 50_000, completed: true, failed: false, score: 180_000, ...result, metrics: NO_V6_METRICS, moments },
    inputTrace: [[0, 0, 0, 0]],
    at: NOW,
  }
}

function moment(kind: RelayLegMoment['kind'], metres: number, path: RelayLegMoment['path'] = 'main'): RelayLegMoment {
  return { kind, dist: metres * METRE, tick: metres * 2, path }
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
    const previous = v5Run({ flowSum: 3_000 * 20_000 }, { ticks: 3_000 })
    // #when the next leg inherits from it
    // #then it opens with a quarter of that average
    expect(inheritedOpeningFlow(previous)).toBe(5_000)
  })

  it('never exceeds the engine bound', () => {
    // #given a previous run whose quarter average would exceed the bound
    const previous = v5Run({ flowSum: 3_000 * 100_000 }, { ticks: 3_000 })
    // #then the inherited FLOW is capped
    expect(inheritedOpeningFlow(previous)).toBe(relayLeg.MAX_OPENING_FLOW)
  })

  it('is zero without a previous relay leg run', () => {
    // #given no previous run, and a station v4 run
    const stationRun: Run = { ...v5Run({}), result: { resultHash: 'hash', ticks: 3_000, timeMs: 50_000, completed: true, score: 1, metrics: { hazardsHit: 0, nearMisses: 0, gates: 0, missedGates: 0, beatHits: 0, boostTicks: 0, overheats: 0, jumps: 0, landings: 0, grindTicks: 0, shortcutTicks: 0 } } }
    // #then neither passes FLOW on
    expect([inheritedOpeningFlow(undefined), inheritedOpeningFlow(stationRun)]).toEqual([0, 0])
  })
})

describe('atlas route sectors', () => {
  it('keeps the sector when the next leg races the same route on its own course', () => {
    // #given a baton on the Genesis route to Cape Verdigris after three handoffs
    const route = atlas('genesis-to-cape-verdigris')
    const baton = batonRecord({ handoffCount: 3, route: openingRoute(route) })
    const before = baton.route
    // #when its next leg is sent along the same route
    moveToAtlasRoute(baton, route)
    // #then the course and sector are unchanged, so the next runner chases the ghost
    expect(baton.route).toBe(before)
  })

  it('opens a new sector on the world, tier and seed of the chosen route', () => {
    // #given a baton that reached Cape Verdigris on its third handoff
    const baton = batonRecord({ handoffCount: 3, route: openingRoute(atlas('genesis-to-cape-verdigris')) })
    // #when the next leg is sent on to Meridian Yard
    moveToAtlasRoute(baton, atlas('cape-verdigris-to-meridian-yard'))
    // #then sector 1 starts at this leg on the metro course of that route
    expect({ route: baton.route, world: baton.world }).toEqual({
      route: { seed: 'atlas-v1-cape-verdigris-to-meridian-yard', world: 'metro', tier: 1, sector: 1, sectorStartedLeg: 3, routeId: 'cape-verdigris-to-meridian-yard', origin: 'cape-verdigris', destination: 'meridian-yard' },
      world: 'metro',
    })
  })

  it('moves a pre-Atlas course onto its route course even when the route id matches', () => {
    // #given a legacy coast sector placed on the Genesis route into the coast
    const baton = batonRecord({ handoffCount: 4 })
    // #when the next leg is sent along that same route
    moveToAtlasRoute(baton, atlas(LEGACY_COAST_ROUTE.routeId))
    // #then the leg races the route's own course on a new sector
    expect([baton.route.seed, baton.route.tier, baton.route.sector, baton.route.sectorStartedLeg]).toEqual(['atlas-v1-genesis-to-cape-verdigris', 0, 1, 4])
  })
})

describe('sector rollover to v6', () => {
  const course = { seed: sectorSeed('CODE000001', 0), world: 'coast', tier: 1 } as const
  const previous = (run: Run): Run => ({ ...run, issued: { ...run.issued, runId: 'previous' } })

  it('continues the sector after a v6 leg on its course', () => {
    // #given a baton three legs into sector 0 whose previous canonical run is v6
    const baton = batonRecord({ handoffCount: 3, previousRunId: 'previous' })
    // #then the next leg races the same route
    expect(nextLegRoute(baton, previous(v6Run([], {}, course)), 2)).toBe(baton.route)
  })

  it('keeps the route for the first leg of a sector whatever raced before it', () => {
    // #given a sector that started at the current leg after a v5 leg
    const baton = batonRecord({ handoffCount: 3, previousRunId: 'previous', route: { ...LEGACY_COAST_ROUTE, sectorStartedLeg: 3 } })
    // #then no new sector opens
    expect(nextLegRoute(baton, previous(v5Run({}, {}, course)), 2)).toBe(baton.route)
  })

  it('starts a new sector on the same world after a v5 leg, or without the previous run', () => {
    // #given a baton three legs into sector 0
    const baton = batonRecord({ handoffCount: 3, previousRunId: 'previous' })
    // #when the previous canonical run is v5, or cannot be loaded
    const routes = [nextLegRoute(baton, previous(v5Run({}, {}, course)), 2), nextLegRoute(baton, undefined, 2)]
    // #then the next leg opens sector 1 at this leg, at the opener's tier, with its own seed
    const rolled = { ...LEGACY_COAST_ROUTE, seed: sectorSeed('CODE000001', 1), world: 'coast', tier: 2, sector: 1, sectorStartedLeg: 3 }
    expect(routes).toEqual([rolled, rolled])
  })

  it('keeps an Atlas course and tier when a new sector opens on it', () => {
    // #given a baton three legs into an Atlas route, whose previous run cannot be loaded
    const route = openingRoute(atlas('meridian-yard-to-fjordgate'))
    const baton = batonRecord({ handoffCount: 3, previousRunId: 'previous', route })
    // #then the new sector races the same route course
    expect(nextLegRoute(baton, undefined, 2)).toEqual({ ...route, sector: 1, sectorStartedLeg: 3 })
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

describe('relay echoes on v5 sectors', () => {
  it('mark the fastest canonical leg on a sector as its ghost record', () => {
    // #given a slower earlier leg and a faster latest leg on sector 0
    const state = freshNetworkState()
    const latest = handoff(2, 'b', { race: race({ timeMs: 41_000 }) })
    state.handoffs = [handoff(1, 'a', { race: race({ timeMs: 45_000 }) }), latest]
    // #when the latest leg leaves its echoes
    recordLegEchoes(state, latest, v5Run({}))
    // #then it holds the sector's ghost record, spanning the leg, with the record time
    expect(state.echoes['baton-1']?.map(echo => [echo.kind, echo.leg, echo.sector, echo.dist, echo.timeMs])).toEqual([['ghost-record', 2, 0, null, 41_000]])
  })

  it('place the first risk-route finisher at the fork once per sector', () => {
    // #given two slower risk-route legs after a faster first leg
    const state = freshNetworkState()
    const first = handoff(1, 'a', { race: race({ timeMs: 60_000 }) })
    const second = handoff(2, 'b', { race: race({ timeMs: 61_000 }) })
    state.handoffs = [handoff(0, 'fast', { race: race({ timeMs: 30_000 }) }), first, second]
    const riskRun = v5Run({ riskRoutes: 1 })
    // #when both leave echoes
    recordLegEchoes(state, first, riskRun)
    recordLegEchoes(state, second, riskRun)
    // #then only the first is the pioneer, standing where the v5 fork opens
    const config = riskRun.issued.config.engineVersion === '5' ? riskRun.issued.config : null
    const forkFrom = config ? relayLegV5.buildTrack(config).fork.from : null
    expect(state.echoes['baton-1']?.map(echo => [echo.kind, echo.leg, echo.dist])).toEqual([['risk-pioneer', 1, forkFrom]])
  })

  it('mark near-miss legends, rescues and handoff milestones', () => {
    // #given the tenth handoff rescued a stranded baton with six near misses, behind a faster leg
    const state = freshNetworkState()
    const tenth = handoff(10, 'b', { rescue: true, race: race({ timeMs: 70_000 }) })
    state.handoffs = [handoff(9, 'a', { race: race({ timeMs: 40_000 }) }), tenth]
    // #when it leaves echoes
    recordLegEchoes(state, tenth, v5Run({ nearMisses: 6 }))
    // #then each earned kind is recorded once
    expect(state.echoes['baton-1']?.map(echo => echo.kind).sort()).toEqual(['milestone', 'near-miss-legend', 'rescue'])
  })
})

describe('relay echoes on v6 sectors', () => {
  const v6Race = (timeMs: number): HandoffRace => race({ engineVersion: '6', timeMs })

  it('leave an edge save where it happened, replaced by the latest leg that saves one', () => {
    // #given two legs on sector 0, each with edge saves, behind a faster leg
    const state = freshNetworkState()
    const first = handoff(1, 'a', { race: v6Race(60_000) })
    const second = handoff(2, 'b', { race: v6Race(61_000) })
    state.handoffs = [handoff(0, 'fast', { race: v6Race(30_000) }), first, second]
    // #when both leave echoes
    recordLegEchoes(state, first, v6Run([moment('edge-save', 300), moment('edge-save', 900, 'safe')]))
    recordLegEchoes(state, second, v6Run([moment('rush', 200), moment('edge-save', 700, 'risk')]))
    // #then the sector keeps the second leg's first save, on its path
    expect(state.echoes['baton-1']?.map(echo => [echo.kind, echo.leg, echo.dist, echo.path])).toEqual([['edge-save', 2, 700 * METRE, 'risk']])
  })

  it('leave the relay cut only for the first leg to finish through it on the sector', () => {
    // #given two slower legs that both took the relay cut
    const state = freshNetworkState()
    const first = handoff(1, 'a', { race: v6Race(60_000) })
    const second = handoff(2, 'b', { race: v6Race(61_000) })
    state.handoffs = [handoff(0, 'fast', { race: v6Race(30_000) }), first, second]
    // #when both leave echoes
    recordLegEchoes(state, first, v6Run([moment('relay-cut', 1_200, 'risk')]))
    recordLegEchoes(state, second, v6Run([moment('relay-cut', 1_250, 'risk')]))
    // #then the cut belongs to the first leg
    expect(state.echoes['baton-1']?.map(echo => [echo.kind, echo.leg, echo.dist, echo.path])).toEqual([['relay-cut', 1, 1_200 * METRE, 'risk']])
  })

  it('stand a ghost record at its relay cut, or on the finish approach when it took none', () => {
    // #given a record leg through the relay cut, then a faster record leg without it
    const state = freshNetworkState()
    const cutter = handoff(1, 'a', { race: v6Race(50_000) })
    const safe = handoff(2, 'b', { race: v6Race(40_000) })
    state.handoffs = [cutter]
    recordLegEchoes(state, cutter, v6Run([moment('relay-cut', 1_200, 'risk')]))
    const atCut = state.echoes['baton-1']?.find(echo => echo.kind === 'ghost-record')?.dist
    state.handoffs = [cutter, safe]
    // #when the faster leg leaves its echoes
    recordLegEchoes(state, safe, v6Run([]))
    // #then each record stood where its own leg earned it
    const finish = relayLeg.buildTrack(V6_CONFIG).segments.find(segment => segment.kind === 'finish')?.from
    expect({ atCut, onApproach: state.echoes['baton-1']?.find(echo => echo.kind === 'ghost-record')?.dist, finishFound: finish !== undefined }).toEqual({ atCut: 1_200 * METRE, onApproach: finish, finishFound: true })
  })

  it('issue at most four echoes with a leg, most meaningful first', () => {
    // #given sector 0 holding one echo of each v6 kind, placed in the reverse order
    const state = freshNetworkState()
    const kinds: RelayEchoKind[] = ['milestone', 'rescue', 'edge-save', 'relay-cut', 'ghost-record']
    state.echoes['baton-1'] = kinds.map((kind, index): RelayEcho => ({ id: kind, batonId: 'baton-1', kind, runner: { id: 'a', name: 'A' }, leg: index + 1, runId: `run-${index}`, sector: 0, dist: null, at: NOW - index }))
    // #then the leg gets the four that matter most
    expect(legEchoes(state, 'baton-1', 0).map(echo => echo.kind)).toEqual(['ghost-record', 'relay-cut', 'edge-save', 'rescue'])
  })

  it('keep at most twelve echoes on a baton, every echo of the newest sector first', () => {
    // #given five sectors whose legs each leave a record, a cut, a save and a milestone
    const state = freshNetworkState()
    for (let sector = 0; sector < 5; sector++) {
      const leg = handoff(10 * (sector + 1), 'a', { sector, race: v6Race(50_000) })
      state.handoffs = [leg]
      recordLegEchoes(state, leg, v6Run([moment('edge-save', 300), moment('relay-cut', 1_200, 'risk')]))
    }
    // #then twelve remain and the newest sector keeps all of its echoes
    const echoes = batonEchoes(state, 'baton-1')
    expect({ stored: state.echoes['baton-1']?.length, newest: echoes.filter(echo => echo.sector === 4).map(echo => echo.kind).sort() }).toEqual({
      stored: 12,
      newest: ['edge-save', 'ghost-record', 'milestone', 'relay-cut'],
    })
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
    expect(baton?.route).toEqual({ seed: sectorSeed('LATER00001', 0), world: 'alpine', tier: 1, sector: 0, sectorStartedLeg: 3, routeId: 'genesis-to-highland-kibo', origin: 'genesis', destination: 'highland-kibo' })
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
    // #then missing race facts and notes are null, old failure text becomes a reason code, and counters start at zero
    expect({
      handoff: [state.handoffs[0]?.sector, state.handoffs[0]?.race, state.handoffs[0]?.rescue, state.handoffs[0]?.note],
      intent: [state.intents.i1?.failure, state.intents.i1?.note],
      daily: state.daily['2026-09-15']?.origin,
      member: [state.members.origin?.completedRuns, state.members.origin?.legs],
    }).toEqual({
      handoff: [null, null, false, null],
      intent: ['RPC_UNAVAILABLE', null],
      daily: { runId: 'daily-run', score: 95_000, timeMs: 50_000, seed: 'daily-2026-09-15-v4', completed: true },
      member: [0, 0],
    })
  })
})

describe('public traffic counters', () => {
  const traffic = (): TrafficState => ({ day: '', chronicleViews: 0, inviteOpens: 0, shares: 0, openedInvites: [], sharesToday: {}, shareTalliesSince: NOW, sharesBySurface: {}, sharesByDay: {} })

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
    const runnerCounted = Array.from({ length: 25 }, () => countShare(counters, { actorKey: 'runner:a', anonymous: false, surface: 'result' }, NOW)).filter(Boolean).length
    const anonymousCounted = Array.from({ length: 250 }, (_, index) => countShare(counters, { actorKey: `visitor:${index}`, anonymous: true, surface: 'chronicle' }, NOW)).filter(Boolean).length
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
