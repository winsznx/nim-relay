import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IssuedRace, RelayLegV6Config } from '@nim-relay/shared'
import { prepareNetworkHandoff, submitNetworkRace } from './api'

const config: RelayLegV6Config = { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: 'seed', world: 'coast', tier: 1, openingFlow: 0, tetherSaves: 1, ghostline: null }

function recordRequests(response: unknown = {}) {
  const bodies: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined)
      return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return bodies
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay API client', () => {
  it('sends the relay note with the pass, and no note field without one', async () => {
    // #given a server that accepts every request
    const bodies = recordRequests()

    // #when one pass carries a private note and another none
    await prepareNetworkHandoff('run-1', 'yasmine', { angle: 45, power: 80 }, { text: 'Keep it gold', visibility: 'private' })
    await prepareNetworkHandoff('run-2', 'kofi', { angle: 30, power: 60 }, null)
    await prepareNetworkHandoff('run-3', 'ada', { angle: 30, power: 60 }, null, 'cape-verdigris-to-meridian-yard')

    // #then only the first body has a note, and only the third a route
    expect(bodies).toEqual([
      { runId: 'run-1', recipient: 'yasmine', throw: { angle: 45, power: 80 }, note: { text: 'Keep it gold', visibility: 'private' } },
      { runId: 'run-2', recipient: 'kofi', throw: { angle: 30, power: 60 } },
      { runId: 'run-3', recipient: 'ada', throw: { angle: 30, power: 60 }, routeId: 'cape-verdigris-to-meridian-yard' },
    ])
  })

  it('submits the signed issuance without the ghost, sector and echoes', async () => {
    // #given an issued baton leg carrying presentation data
    const bodies = recordRequests({ runId: 'run-1' })
    const issued: IssuedRace = {
      batonId: 'b-1',
      networkRace: true,
      relayLeg: 3,
      runId: 'run-1',
      playerId: 'tim',
      mode: 'global',
      config,
      expiresAt: 1_900_000_000_000,
      target: null,
      mac: 'mac',
      ghost: { runId: 'run-0', name: 'Mariana', runner: { name: 'Mariana', country: null }, timeMs: 44_000, config, inputTrace: [], result: { score: 1, resultHash: 'r', completed: true, ticks: 1, timeMs: 44_000, failed: false, metrics: { perfectGates: 0, totalGates: 0, pulseHits: 0, nearMisses: 0, hits: 0, falls: 0, jumps: 0, cleanLandings: 0, hardLandings: 0, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 0, laneChanges: 0, cleanLaneChanges: 0, edgeGrinds: 0, edgeSaves: 0, tetherSaves: 0, draftTicks: 0, overtakes: 0, rushes: 0, rushTicks: 0, flowSum: 0, flowPeak: 0 }, moments: [] }, verified: true },
      sector: { index: 0, startedLeg: 0, firstLeg: false },
      echoes: [],
    }

    // #when the run is submitted
    await submitNetworkRace(issued, [])

    // #then every signed field is sent as issued and the presentation data stays behind
    expect(bodies).toEqual([
      { issued: { batonId: 'b-1', networkRace: true, relayLeg: 3, runId: 'run-1', playerId: 'tim', mode: 'global', config, expiresAt: 1_900_000_000_000, target: null, mac: 'mac' }, inputTrace: [] },
    ])
  })
})
