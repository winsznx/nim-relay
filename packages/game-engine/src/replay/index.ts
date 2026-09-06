import { CHALLENGE_VERSIONS, RULES } from '../challenges'
import { inputAtTick, validateInputTrace } from '../input'
import type { InputTrace, TraceErrorCode } from '../input'
import { scoreState } from '../scoring'
import { validateConfig, totalTicks } from '../simulation'
import type { GameState, RunConfig } from '../simulation'
import { canonicalJSON, sha256 } from './hash'
export const RULES_HASH = sha256(canonicalJSON(RULES))
export class ReplayError extends Error {
  constructor(readonly code: TraceErrorCode, readonly index: number) { super(`Invalid trace: ${code} at ${index}`); this.name = 'ReplayError' }
}
export interface ReplayConfig extends RunConfig { inputTrace: InputTrace }
export function replay(config: ReplayConfig) {
  const validation = validateInputTrace(config.inputTrace, config.durationMs)
  if (!validation.ok) throw new ReplayError(validation.error.code, validation.error.index)
  validateConfig(config)
  const version = config.challengeVersion ?? '1.0.0'
  if (version !== '1.0.0') throw new RangeError('Unsupported challenge version')
  const handler = CHALLENGE_VERSIONS[config.challenge][version]
  let state = handler.initialState({ engineVersion: config.engineVersion, challenge: config.challenge,
    challengeVersion: config.challengeVersion ?? '1.0.0', seed: config.seed, difficulty: config.difficulty, durationMs: config.durationMs })
  const ticks = totalTicks(config)
  for (let tick = 0; tick < ticks; tick++) state = handler.step(state, inputAtTick(validation.trace, tick), tick)
  return resultForState(state, validation.trace)
}

/** Bind the complete final simulation, so even a one-unit drift is detectable. */
export function resultForState(state: GameState, inputTrace: InputTrace) {
  if (state.tick !== totalTicks(state.config)) throw new RangeError('Cannot finalize an unfinished run')
  const { config, ...finalState } = state
  const result = scoreState(state)
  const binding = { engineVersion: config.engineVersion, challenge: config.challenge,
    challengeVersion: config.challengeVersion, seed: config.seed, difficulty: config.difficulty,
    durationMs: config.durationMs, rulesHash: RULES_HASH, inputTrace, finalState, ...result }
  return { ...result, resultHash: sha256(canonicalJSON(binding)), rulesHash: RULES_HASH }
}
