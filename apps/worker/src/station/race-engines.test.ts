import { describe, expect, it } from 'vitest'
import { relayLeg, relayLegV5, stationRace } from '@nim-relay/game-engine'
import type { RelayLegV5Config, RelayLegV6Config, StationRaceConfig } from '@nim-relay/shared'
import { failingTrace, finishingTrace, withLateSample } from './network/testing'
import { replayRace } from './race-engines'

const V6: RelayLegV6Config = { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: 'late-samples', world: 'coast', tier: 1, openingFlow: 0, tetherSaves: 1, ghostline: null }
const V5: RelayLegV5Config = { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'late-samples', world: 'coast', tier: 1, openingFlow: 0 }
const STATION: StationRaceConfig = { engineVersion: '4', challenge: 'station-race', challengeVersion: '4', seed: 'late-samples', world: 'coast' }

describe('race replay', () => {
  it('refuses samples after a v6 leg finished or failed as a malformed trace', () => {
    // #given a finishing and a failing v6 trace, each with a sample after its leg ended
    const finished = finishingTrace(V6)
    const failed = failingTrace(V6)
    const late = [withLateSample(finished, relayLeg.replay({ ...V6, inputTrace: finished }).ticks), withLateSample(failed, relayLeg.replay({ ...V6, inputTrace: failed }).ticks)]
    // #when both are replayed, next to the traces as they were recorded
    const replays = { late: late.map(trace => replayRace(V6, trace)), recorded: [finished, failed].map(trace => replayRace(V6, trace) !== null) }
    // #then only the recorded traces replay
    expect(replays).toEqual({ late: [null, null], recorded: [true, true] })
  })

  it('refuses samples after the leg ended on the frozen v5 and station engines too', () => {
    // #given hands-off v5 and station traces with a sample after each race ended
    const v5 = withLateSample([[0, 0, 0]], relayLegV5.replay({ ...V5, inputTrace: [[0, 0, 0]] }).ticks)
    const station = withLateSample([[0, 0, 0, 0]], stationRace.replay({ ...STATION, inputTrace: [[0, 0, 0, 0]] }).ticks)
    // #then neither replays
    expect([replayRace(V5, v5), replayRace(STATION, station)]).toEqual([null, null])
  })
})
