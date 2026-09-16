import { describe, expect, it } from 'vitest'
import { isRelayLegGhost, isRelayLegResult, isStationRaceGhost, type CanonicalGhost, type RelayLegResult, type StationRaceResult } from './station'

const relayLegResult: RelayLegResult = {
  score: 180_000, resultHash: 'hash', completed: true, ticks: 3_000, timeMs: 50_000,
  metrics: { perfectGates: 1, totalGates: 2, pulseHits: 0, nearMisses: 3, hits: 0, falls: 0, jumps: 1, cleanLandings: 1, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 1, flowSum: 90_000, flowPeak: 20_000 },
}
const stationRaceResult: StationRaceResult = {
  score: 95_000, resultHash: 'hash', completed: true, ticks: 3_100, timeMs: 51_666,
  metrics: { hazardsHit: 0, nearMisses: 2, gates: 10, missedGates: 1, beatHits: 2, boostTicks: 40, overheats: 0, jumps: 1, landings: 1, grindTicks: 0, shortcutTicks: 0 },
}

function ghost(engine: '4' | '5'): CanonicalGhost {
  const base = { runId: `run-v${engine}`, name: 'Courier', runner: { name: 'Courier', country: null }, timeMs: 50_000, verified: true as const }
  return engine === '5'
    ? { ...base, config: { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'seed', world: 'metro', tier: 1, openingFlow: 0 }, inputTrace: [[0, 0, 0]], result: relayLegResult }
    : { ...base, config: { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed: 'seed', world: 'metro' }, inputTrace: [[0, 0, 0, 0]], result: stationRaceResult }
}

describe('race engine guards', () => {
  it('tells relay leg results from station race results by their metrics', () => {
    expect([isRelayLegResult(relayLegResult), isRelayLegResult(stationRaceResult)]).toEqual([true, false])
  })

  it('tells ghosts apart by the engine version of their config', () => {
    const ghosts = [ghost('5'), ghost('4')]
    expect(ghosts.map(candidate => [isRelayLegGhost(candidate), isStationRaceGhost(candidate)])).toEqual([[true, false], [false, true]])
  })
})
