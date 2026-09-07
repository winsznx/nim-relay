import { canonicalJSON, sha256 } from '../replay/hash'
import { RaceInputCursor, validateRaceTrace, type RaceInputTrace, type RaceTraceErrorCode } from './input'
import { createRaceState, stepRace, totalTicks, validateRaceConfig, type RaceConfig, type RaceState } from './sim'
import { scoreRace, type RaceResult } from './score'

/** The function the Worker calls to independently verify a Relay Race run. */
export class RaceReplayError extends Error {
  constructor(readonly code: RaceTraceErrorCode, readonly index: number) {
    super(`Invalid race trace: ${code} at ${index}`)
    this.name = 'RaceReplayError'
  }
}

export interface RaceReplayConfig extends RaceConfig {
  inputTrace: RaceInputTrace
}
export interface RaceReplayResult extends RaceResult {
  resultHash: string
  ticks: number
}

export function replayRaceRun(config: RaceReplayConfig): RaceReplayResult {
  validateRaceConfig(config)
  const validation = validateRaceTrace(config.inputTrace, totalTicks())
  if (!validation.ok) throw new RaceReplayError(validation.error.code, validation.error.index)
  const cursor = new RaceInputCursor(validation.trace)
  let state = createRaceState(config)
  while (state.finished === 0) {
    const { steer, boost } = cursor.at(state.tick)
    state = stepRace(state, { steer, boost }, state.tick)
  }
  return finalizeRace(state, validation.trace)
}

export function finalizeRace(state: RaceState, inputTrace: RaceInputTrace): RaceReplayResult {
  if (state.finished !== 1) throw new RangeError('race not finished')
  const result = scoreRace(state)
  const { config, track: _track, ...finalState } = state
  void _track
  const binding = { v: 3, seed: config.seed, inputTrace, finalState, ...result }
  return { ...result, resultHash: sha256(canonicalJSON(binding)), ticks: state.finishTick }
}
