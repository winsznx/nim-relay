import { relayLeg, relayLegV5, stationRace } from '@nim-relay/game-engine'
import type {
  CanonicalGhost,
  GhostRunner,
  IssuedRace,
  RaceConfig,
  RaceResult,
  RaceTrace,
  RelayLegGhostline,
  RelayLegMoment,
  RelayLegPath,
  RelayLegV5Config,
  RelayLegV5Metrics,
  RelayLegV5Result,
  RelayLegV5Trace,
  RelayLegV6Config,
  RelayLegV6Metrics,
  RelayLegV6Result,
  RelayLegV6Trace,
} from '@nim-relay/shared'
import type { Run } from './model'

/** Shared mirrors the engine contracts by hand; these fail to compile when either pair drifts apart. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition
export type RelayLegV5ContractMirror = [
  Assert<Exact<RelayLegV5Config, relayLegV5.Config>>,
  Assert<Exact<RelayLegV5Trace, relayLegV5.InputTrace>>,
  Assert<Exact<RelayLegV5Metrics, relayLegV5.Metrics>>,
  Assert<Exact<RelayLegV5Result, relayLegV5.Result>>,
  Assert<Exact<RelayLegPath, relayLegV5.Path>>,
]
export type RelayLegV6ContractMirror = [
  Assert<Exact<RelayLegV6Config, relayLeg.Config>>,
  Assert<Exact<RelayLegGhostline, relayLeg.Ghostline>>,
  Assert<Exact<RelayLegV6Trace, relayLeg.InputTrace>>,
  Assert<Exact<RelayLegV6Metrics, relayLeg.Metrics>>,
  Assert<Exact<RelayLegMoment, relayLeg.Moment>>,
  Assert<Exact<RelayLegV6Result, relayLeg.Result>>,
  Assert<Exact<RelayLegPath, relayLeg.Path>>,
]

export interface VerifiedReplay {
  inputTrace: RaceTrace
  result: RaceResult
}

/** A run replayed by Relay Leg v6. Runs keep the trace and result of the engine their config names, so the config decides. */
export interface RelayLegV6Run extends Run {
  issued: IssuedRace & { config: RelayLegV6Config }
  inputTrace: RelayLegV6Trace
  result: RelayLegV6Result
}

export function isRelayLegV6Run(run: Run): run is RelayLegV6Run {
  return run.issued.config.engineVersion === '6'
}

/**
 * Replays a submitted trace with the engine named by the signed config. Null when the engine refuses the trace, up front
 * or only once the replay reaches it, as with samples after the leg ended.
 */
export function replayRace(config: RaceConfig, submittedTrace: unknown): VerifiedReplay | null {
  try {
    return replayWithEngine(config, submittedTrace)
  } catch (error) {
    // Every engine refuses a trace, config or input with a RangeError; anything else is a fault and must surface.
    if (error instanceof RangeError) return null
    throw error
  }
}

function replayWithEngine(config: RaceConfig, submittedTrace: unknown): VerifiedReplay | null {
  switch (config.engineVersion) {
    case '6': {
      const checked = relayLeg.validateTrace(submittedTrace)
      return checked.ok ? { inputTrace: checked.trace, result: relayLeg.replay({ ...config, inputTrace: checked.trace }) } : null
    }
    case '5': {
      const checked = relayLegV5.validateTrace(submittedTrace)
      return checked.ok ? { inputTrace: checked.trace, result: relayLegV5.replay({ ...config, inputTrace: checked.trace }) } : null
    }
    case '4': {
      const checked = stationRace.validateTrace(submittedTrace)
      return checked.ok ? { inputTrace: checked.trace, result: stationRace.replay({ ...config, inputTrace: checked.trace }) } : null
    }
  }
}

/** The verified route a later leg races: derived from the run's canonical replay on exactly the config it was issued. */
export function deriveGhostline(run: RelayLegV6Run): RelayLegGhostline {
  return relayLeg.deriveGhostline(run.issued.config, run.inputTrace)
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
