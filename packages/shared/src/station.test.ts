import { describe, expect, it } from 'vitest'
import { isFailedLeg, isRelayLegGhost, isRelayLegResult, isRelayLegV6Ghost, isRelayLegV6Result, isStationRaceGhost, type CanonicalGhost, type RelayLegV5Result, type RelayLegV6Result, type StationRaceResult } from './station'

const relayLegV5Result: RelayLegV5Result = {
  score: 180_000, resultHash: 'hash', completed: true, ticks: 3_000, timeMs: 50_000,
  metrics: { perfectGates: 1, totalGates: 2, pulseHits: 0, nearMisses: 3, hits: 0, falls: 0, jumps: 1, cleanLandings: 1, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 1, flowSum: 90_000, flowPeak: 20_000 },
}
const relayLegV6Result: RelayLegV6Result = {
  score: 190_000, resultHash: 'hash', completed: true, failed: false, ticks: 3_000, timeMs: 50_000,
  metrics: {
    perfectGates: 1, totalGates: 2, pulseHits: 0, nearMisses: 3, hits: 0, falls: 1, jumps: 1, cleanLandings: 1, hardLandings: 0, slides: 0, railTicks: 0, boostPadTicks: 0, riskRoutes: 1,
    laneChanges: 4, cleanLaneChanges: 4, edgeGrinds: 1, edgeSaves: 1, tetherSaves: 1, draftTicks: 120, overtakes: 1, rushes: 0, rushTicks: 0, flowSum: 90_000, flowPeak: 20_000,
  },
  moments: [{ kind: 'edge-save', dist: 400 * 65_536, tick: 900, path: 'main' }],
}
const stationRaceResult: StationRaceResult = {
  score: 95_000, resultHash: 'hash', completed: true, ticks: 3_100, timeMs: 51_666,
  metrics: { hazardsHit: 0, nearMisses: 2, gates: 10, missedGates: 1, beatHits: 2, boostTicks: 40, overheats: 0, jumps: 1, landings: 1, grindTicks: 0, shortcutTicks: 0 },
}

function ghost(engine: '4' | '5' | '6'): CanonicalGhost {
  const base = { runId: `run-v${engine}`, name: 'Courier', runner: { name: 'Courier', country: null }, timeMs: 50_000, verified: true as const }
  if (engine === '6') {
    return { ...base, config: { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: 'seed', world: 'metro', tier: 1, openingFlow: 0, tetherSaves: 1, ghostline: null }, inputTrace: [[0, 0, 0, 0]], result: relayLegV6Result }
  }
  return engine === '5'
    ? { ...base, config: { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'seed', world: 'metro', tier: 1, openingFlow: 0 }, inputTrace: [[0, 0, 0]], result: relayLegV5Result }
    : { ...base, config: { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed: 'seed', world: 'metro' }, inputTrace: [[0, 0, 0, 0]], result: stationRaceResult }
}

describe('race engine guards', () => {
  it('tells relay leg results of either engine from station race results by their metrics', () => {
    expect([isRelayLegResult(relayLegV5Result), isRelayLegResult(relayLegV6Result), isRelayLegResult(stationRaceResult)]).toEqual([true, true, false])
  })

  it('tells v6 results apart by their verified moments', () => {
    expect([isRelayLegV6Result(relayLegV6Result), isRelayLegV6Result(relayLegV5Result), isRelayLegV6Result(stationRaceResult)]).toEqual([true, false, false])
  })

  it('reports only a v6 leg that fell with no tether save left as failed', () => {
    expect([isFailedLeg({ ...relayLegV6Result, completed: false, failed: true }), isFailedLeg(relayLegV6Result), isFailedLeg({ ...relayLegV5Result, completed: false })]).toEqual([true, false, false])
  })

  it('tells ghosts apart by the engine version of their config', () => {
    const ghosts = [ghost('6'), ghost('5'), ghost('4')]
    expect(ghosts.map(candidate => [isRelayLegGhost(candidate), isRelayLegV6Ghost(candidate), isStationRaceGhost(candidate)])).toEqual([
      [true, true, false],
      [true, false, false],
      [false, false, true],
    ])
  })
})
