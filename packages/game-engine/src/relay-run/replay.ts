import { canonicalJSON, sha256 } from '../replay/hash'
import { RelayInputCursor, validateRelayTrace, type RelayInputTrace, type RelayTraceErrorCode } from './input'
import { createRelayState, stepRelay, totalTicks, validateRelayRunConfig, type RelayRunConfig, type RelayState } from './sim'
import { prevLegSummary, scoreRelayState, type RelayScoreResult } from './score'

/**
 * The function the Worker calls to independently verify a Relay Run (engine
 * v2). Same guarantees as v1 `replay()`: given the same config + trace it
 * returns byte-identical `score` / `breakdown` / `resultHash` on every runtime.
 * The v1 engine and its corpus are untouched.
 */

export class RelayReplayError extends Error {
  constructor(readonly code: RelayTraceErrorCode, readonly index: number) {
    super(`Invalid relay trace: ${code} at ${index}`)
    this.name = 'RelayReplayError'
  }
}

export interface RelayReplayConfig extends RelayRunConfig {
  inputTrace: RelayInputTrace
}

export interface RelayReplayResult extends RelayScoreResult {
  resultHash: string
  ticks: number
  /** carry-state for the next leg (docs §2.7) */
  nextLegSummary: ReturnType<typeof prevLegSummary>
}

export function replayRelayRun(config: RelayReplayConfig): RelayReplayResult {
  validateRelayRunConfig(config)
  const ticks = totalTicks(config)
  const validation = validateRelayTrace(config.inputTrace, ticks)
  if (!validation.ok) throw new RelayReplayError(validation.error.code, validation.error.index)

  const cursor = new RelayInputCursor(validation.trace)
  let state = createRelayState(config)
  for (let tick = 0; tick < ticks; tick++) {
    const { steer, pressed } = cursor.at(tick)
    state = stepRelay(state, { steer, pressed }, tick)
  }
  return finalizeRelay(state, validation.trace)
}

export function finalizeRelay(state: RelayState, inputTrace: RelayInputTrace): RelayReplayResult {
  const ticks = totalTicks(state.config)
  if (state.tick !== ticks) throw new RangeError('relay run not finished')
  const result = scoreRelayState(state)
  const { config, mods: _mods, ...finalState } = state
  void _mods
  const binding = {
    v: 2,
    engineVersion: config.engineVersion,
    challenge: config.challenge,
    challengeVersion: config.challengeVersion,
    seed: config.seed,
    legNumber: config.legNumber,
    sourceRegionId: config.sourceRegionId,
    destRegionId: config.destRegionId,
    prevLeg: config.prevLeg ?? null,
    inputTrace,
    finalState,
    ...result,
  }
  return {
    ...result,
    resultHash: sha256(canonicalJSON(binding)),
    ticks,
    nextLegSummary: prevLegSummary(state),
  }
}
