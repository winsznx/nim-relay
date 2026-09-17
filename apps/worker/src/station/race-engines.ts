import { relayLegV5, stationRace } from '@nim-relay/game-engine'
import type { GhostRunner, CanonicalGhost, RaceConfig, RaceResult, RaceTrace, RelayLegConfig, RelayLegMetrics, RelayLegPath, RelayLegTrace } from '@nim-relay/shared'
import type { Run } from './model'

/** Shared mirrors the engine contract by hand; these fail to compile when the two drift apart. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition
export type RelayLegContractMirror = [
  Assert<Exact<RelayLegConfig, relayLegV5.Config>>,
  Assert<Exact<RelayLegTrace, relayLegV5.InputTrace>>,
  Assert<Exact<RelayLegMetrics, relayLegV5.Metrics>>,
  Assert<Exact<RelayLegPath, relayLegV5.Path>>,
]

export interface VerifiedReplay {
  inputTrace: RaceTrace
  result: RaceResult
}

/** Replays a submitted trace with the engine named by the signed config. Null when the trace is malformed. */
export function replayRace(config: RaceConfig, submittedTrace: unknown): VerifiedReplay | null {
  if (config.engineVersion === '5') {
    const checked = relayLegV5.validateTrace(submittedTrace)
    if (!checked.ok) return null
    return { inputTrace: checked.trace, result: relayLegV5.replay({ ...config, inputTrace: checked.trace }) }
  }
  const checked = stationRace.validateTrace(submittedTrace)
  if (!checked.ok) return null
  return { inputTrace: checked.trace, result: stationRace.replay({ ...config, inputTrace: checked.trace }) }
}

export function canonicalGhost(run: Run, runner: GhostRunner): CanonicalGhost {
  return {
    runId: run.issued.runId,
    name: runner.name,
    runner,
    timeMs: run.result.timeMs,
    config: run.issued.config,
    inputTrace: run.inputTrace,
    result: run.result,
    verified: true,
  }
}
