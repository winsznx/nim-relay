import { describe, expect, it } from 'vitest'
import type { AtlasNextRoute, AtlasRouteStats, AtlasSnapshot } from '@nim-relay/shared'
import { heatBand, journeySteps, lightTheWorld, routeOptions, stationsOnJourney } from './model'

function stats(routeId: string, overrides: Partial<AtlasRouteStats> = {}): AtlasRouteStats {
  return { routeId, verifiedRuns: 0, qualifiedRunners: 0, fastest: null, ghostRecord: null, activeBatons: [], heat: 0, heatLevel: 0, lit: false, lastRunAt: null, ...overrides }
}

function snapshot(routes: AtlasRouteStats[]): AtlasSnapshot {
  return { version: 1, generatedAt: 0, routes, stations: [], lightTheWorld: { stationsLit: 3, stationsTotal: 24, routesLit: 2, routesTotal: 55 } }
}

const NEXT: AtlasNextRoute = {
  policy: 'choose',
  station: 'cape-verdigris',
  routeIds: ['genesis-to-cape-verdigris', 'cape-verdigris-to-meridian-yard'],
  rerunRouteId: 'genesis-to-cape-verdigris',
  defaultRouteId: 'cape-verdigris-to-meridian-yard',
}

describe('atlas route options', () => {
  it('describe each offered route with its destination, world, heat and verified record', () => {
    // #given a hot rerun route with a record and a dark onward route
    const atlas = snapshot([
      stats('genesis-to-cape-verdigris', { lit: true, heatLevel: 0.8, fastest: { runnerName: 'Mariana', runnerHandle: 'mariana', timeMs: 41_200, runId: 'r', batonCode: 'C', leg: 2, at: 0 } }),
      stats('cape-verdigris-to-meridian-yard'),
    ])
    // #then options follow the relay's order and never invent a record
    expect(routeOptions(NEXT, atlas).map(option => [option.destination.name, option.world, option.heat, option.record, option.rerun, option.recommended])).toEqual([
      ['Cape Verdigris', 'Sunbreak Coast', 'blazing', 'Fastest 41.20s by Mariana', true, false],
      ['Meridian Yard', 'Midnight Metro', 'dark', null, false, true],
    ])
  })

  it('treat a route as dark until a qualified leg lights it', () => {
    expect([heatBand(undefined), heatBand(stats('x', { lit: true, heatLevel: 0.1 })), heatBand(stats('x', { lit: true, heatLevel: 0.4 }))]).toEqual(['dark', 'warm', 'hot'])
  })
})

describe('light the world', () => {
  it('shares stations and routes lit, and shows nothing lit before the Atlas loads', () => {
    expect(lightTheWorld(snapshot([]))).toMatchObject({ stationsLit: 3, routesLit: 2, share: 5 / 79 })
    expect(lightTheWorld(undefined)).toMatchObject({ stationsLit: 0, routesLit: 0, stationsTotal: 24, routesTotal: 55, share: 0 })
  })
})

describe('atlas journey', () => {
  it('orders legs and shows a treasury starter baton as a gift, never a handoff', () => {
    const steps = journeySteps([
      { kind: 'treasury_starter_grant', at: 1, toRunner: { name: 'Ada', handle: 'ada' }, txHash: 'a'.repeat(64), station: 'genesis' },
      { kind: 'leg', leg: 1, routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris', runner: { name: 'Ada', handle: 'ada' }, timeMs: 41_000, txHash: 'b'.repeat(64), at: 2, backfilled: false },
      { kind: 'leg', leg: 2, routeId: 'cape-verdigris-to-meridian-yard', origin: 'cape-verdigris', destination: 'meridian-yard', runner: { name: 'Kofi', handle: 'kofi' }, timeMs: null, txHash: null, at: 3, backfilled: false },
    ])
    expect(steps.map(step => [step.kind, step.title, step.detail, step.inProgress])).toEqual([
      ['grant', 'Starter baton from Genesis Station', 'Given to Ada', false],
      ['leg', 'Leg 1: Genesis Station to Cape Verdigris', 'Ada, 41.00s', false],
      ['leg', 'Leg 2: Cape Verdigris to Meridian Yard', 'Kofi is carrying it now', true],
    ])
  })

  it('counts each station once in the order the baton reached it', () => {
    expect(stationsOnJourney([
      { routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' },
      { routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' },
      { routeId: 'cape-verdigris-to-meridian-yard', origin: 'cape-verdigris', destination: 'meridian-yard' },
    ])).toEqual(['genesis', 'cape-verdigris', 'meridian-yard'])
  })
})
