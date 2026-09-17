import { describe, expect, it } from 'vitest'
import { genesisRouteFor, outgoingRoutes, type BatonHandoff, type HandoffAtlas, type HandoffRace, type NetworkRunner } from '@nim-relay/shared'
import { atlasProgressFor, atlasSnapshot, recordAtlasLeg, ROUTE_CHOICE_MODES, starterRoute } from './atlas'
import { ATLAS_HEAT_HALF_LIFE_MS } from './constants'
import { freshNetworkState, normalizeNetworkState, type StoredNetworkState } from './state'
import type { NetworkState } from './types'

const NOW = Date.UTC(2026, 8, 17, 12)
const ROUTE = genesisRouteFor('coast')
const ON_COURSE: HandoffAtlas = { routeId: ROUTE.id, origin: ROUTE.from, destination: ROUTE.to, backfilled: false, onCourse: true }

function courier(id: string): NetworkRunner {
  return { id, handle: `runner-${id}`, name: `Runner ${id}`, wallet: `NQ00${id.toUpperCase()}`, country: null, countrySource: null }
}

function race(timeMs: number, overrides: Partial<HandoffRace> = {}): HandoffRace {
  return { engineVersion: '6', world: ROUTE.world, timeMs, score: 200_000 - timeMs, completed: true, ghostRunId: null, ghostTimeMs: null, beatGhost: null, ...overrides }
}

function handoff(leg: number, fromId: string, overrides: Partial<BatonHandoff> = {}): BatonHandoff {
  return {
    id: `handoff-${leg}`, batonId: 'baton-1', leg, from: courier(fromId), to: courier(`${fromId}-next`), value: 100_000, txHash: 'a'.repeat(64), network: 'TestAlbatross',
    at: NOW + leg, runId: `run-${leg}`, resultHash: 'hash', qualified: true, confirmations: 2, blockNumber: 100 + leg, sector: 0, race: race(50_000), rescue: false, note: null,
    atlas: ON_COURSE,
    ...overrides,
  }
}

function stateWith(...handoffs: BatonHandoff[]): NetworkState {
  const state = freshNetworkState()
  for (const recorded of handoffs) {
    state.handoffs.push(recorded)
    recordAtlasLeg(state, 'CODE000001', recorded)
  }
  return state
}

const statsOf = (state: NetworkState, now = NOW) => atlasSnapshot(state, now).routes.find(route => route.routeId === ROUTE.id)!

describe('atlas route stats', () => {
  it('count qualified legs and distinct runners, keeping the fastest on-course run and the latest ghost win', () => {
    // #given three qualified legs by two runners, one of which beat a ghost, and an unqualified record
    const state = stateWith(
      handoff(1, 'a', { race: race(52_000) }),
      handoff(2, 'b', { race: race(48_000, { beatGhost: true, ghostTimeMs: 52_000, ghostRunId: 'run-1' }) }),
      handoff(3, 'a', { race: race(50_000) }),
      handoff(4, 'c', { qualified: false, race: race(10_000) }),
    )
    const stats = statsOf(state)
    // #then only the qualified legs count
    expect({ runs: stats.verifiedRuns, runners: stats.qualifiedRunners, fastest: stats.fastest?.timeMs, ghost: [stats.ghostRecord?.runnerHandle, stats.ghostRecord?.ghostTimeMs], lit: stats.lit }).toEqual({
      runs: 3,
      runners: 2,
      fastest: 48_000,
      ghost: ['runner-b', 52_000],
      lit: true,
    })
  })

  it('never takes a record from a leg raced off the route course', () => {
    // #given a backfilled legacy leg with a very fast time
    const state = stateWith(handoff(1, 'a', { race: race(20_000), atlas: { ...ON_COURSE, backfilled: true, onCourse: false } }))
    // #then it counts as a run but sets no record
    expect([statsOf(state).verifiedRuns, statsOf(state).fastest]).toEqual([1, null])
  })

  it('halves heat every half-life without verified activity', () => {
    // #given two legs at the same moment
    const state = stateWith(handoff(0, 'a'), handoff(0, 'b', { id: 'other' }))
    // #then heat decays from 2 to 1 over one half-life and brightness falls with it
    const fresh = statsOf(state, NOW)
    const later = statsOf(state, NOW + ATLAS_HEAT_HALF_LIFE_MS)
    expect([fresh.heat, later.heat, later.heatLevel < fresh.heatLevel]).toEqual([2, 1, true])
  })

  it('lights the world only through qualified legs', () => {
    // #given one qualified leg, and a state whose only record is unqualified, like a treasury grant that is no leg
    const lit = atlasSnapshot(stateWith(handoff(1, 'a')), NOW).lightTheWorld
    const dark = atlasSnapshot(stateWith(handoff(1, 'a', { qualified: false })), NOW).lightTheWorld
    // #then the qualified leg lights its route and both stations; nothing else lights anything
    expect([lit.routesLit, lit.stationsLit, dark.routesLit, dark.stationsLit]).toEqual([1, 2, 0, 0])
  })
})

describe('atlas progression', () => {
  it('counts stations, routes, discovered routes, journeys and missions per runner', () => {
    // #given runner a raced the Genesis coast route twice on one baton, and a runner who never raced
    const state = stateWith(handoff(1, 'a'), handoff(2, 'a'))
    const progress = atlasProgressFor(state, 'a')
    const discovered = new Set([ROUTE.id, ...outgoingRoutes(ROUTE.from).map(route => route.id), ...outgoingRoutes(ROUTE.to).map(route => route.id)]).size
    // #then their visits and discoveries follow the legs, and the newcomer has none
    expect([progress, atlasProgressFor(state, 'nobody')]).toEqual([
      { stationsVisited: 2, routesCompleted: 1, routesDiscovered: discovered, journeys: 1 },
      { stationsVisited: 0, routesCompleted: 0, routesDiscovered: 0, journeys: 0 },
    ])
    expect(state.atlas.players.a?.missions).toEqual({ lamplighter: NOW + 1 })
  })

  it('completes EXPLORER on the third distinct route', () => {
    // #given legs on three different routes out of Genesis Station
    const routes = outgoingRoutes('genesis').slice(0, 3)
    const state = stateWith(...routes.map((route, index) => handoff(index + 1, 'a', { atlas: { routeId: route.id, origin: route.from, destination: route.to, backfilled: false, onCourse: true } })))
    // #then the mission completes at the third leg
    expect(state.atlas.players.a?.missions.explorer).toBe(NOW + 3)
  })
})

describe('atlas rules', () => {
  it('let every baton mode choose a route and never the Daily', () => {
    expect(ROUTE_CHOICE_MODES).toEqual({ global: true, quick: true, crew: true, rival: true, daily: false })
  })

  it('start treasury starter batons on the first route out of Genesis Station', () => {
    expect(starterRoute()).toEqual({ routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' })
  })
})

describe('atlas backfill', () => {
  it('places legacy legs on the Genesis route into the world they raced and rebuilds the ledger', () => {
    // #given state written before the Atlas: an alpine baton with one verified leg raced on its alpine sector
    const legacy = {
      version: 3,
      batons: {
        old: {
          id: 'old', code: 'OLD0000001', title: 'Old', mode: 'global', network: 'TestAlbatross', value: 100_000, origin: courier('a'), holder: courier('b'),
          createdAt: NOW, updatedAt: NOW, status: 'active', handoffCount: 1, world: 'alpine', previousRunId: 'run-1', crewId: null, rivalId: null,
          recipientId: null, expiresAt: NOW, lineage: { countries: [], runners: 2, ghostWins: 0 }, quick: null,
          route: { seed: 'relay-OLD0000001-s0', world: 'alpine', tier: 1, sector: 0, sectorStartedLeg: 0 },
        },
      },
      handoffs: [{ id: 'h1', batonId: 'old', leg: 1, from: courier('a'), to: courier('b'), value: 100_000, txHash: 'b'.repeat(64), network: 'TestAlbatross', at: NOW, runId: 'run-1', resultHash: 'hash', qualified: true, confirmations: 2, blockNumber: 10, sector: 0, race: race(40_000, { world: 'alpine' }), rescue: false, note: null }],
      intents: {}, notifications: {}, invites: {}, rivals: [], members: {}, daily: {}, dailyIssues: {}, crewDays: {}, rematches: 0, dirty: false,
    } satisfies StoredNetworkState
    // #when it loads
    const state = normalizeNetworkState(legacy)
    const alpine = genesisRouteFor('alpine')
    // #then the leg and the baton sit on the Genesis alpine route, the leg counts, and it sets no record
    expect({
      handoff: state.handoffs[0]?.atlas,
      baton: [state.batons.old?.route.routeId, state.batons.old?.route.seed],
      route: [state.atlas.routes[alpine.id]?.runs, state.atlas.routes[alpine.id]?.fastest],
      progress: atlasProgressFor(state, 'a').routesCompleted,
    }).toEqual({
      handoff: { routeId: alpine.id, origin: 'genesis', destination: alpine.to, backfilled: true, onCourse: false },
      baton: [alpine.id, 'relay-OLD0000001-s0'],
      route: [1, null],
      progress: 1,
    })
  })
})
