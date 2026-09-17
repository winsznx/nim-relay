import { GHOSTLINE_STEP } from './constants'
import { pathCode } from './geometry'
import { toCentimetres } from './ghost-sample'
import { createState, step } from './sim'
import { InputCursor, validateTrace } from './trace'
import type { Config, Ghostline, InputTrace } from './types'

export { MAX_GHOSTLINE_SAMPLES, ghostlineAt, isValidGhostline, type GhostSample } from './ghost-sample'

export type GhostlineConfig = Omit<Config, 'ghostline'> & { ghostline?: Config['ghostline'] }

/**
 * The route a verified run took, for the next runner to race: every GHOSTLINE_STEP metres of
 * route progress, the path, lateral position (cm) and tick at which the run passed it.
 *
 * Pass the config the trace was verified against, including that runner's own ghostline if
 * they had one: drafting changes FLOW, so replaying without it would take a different route.
 * After a tether respawn the run passes some distances twice; the later pass wins, so ticks
 * never decrease along the line. Pure and deterministic; throws RangeError on an invalid trace.
 */
export function deriveGhostline(config: GhostlineConfig, trace: InputTrace): Ghostline {
  const validation = validateTrace(trace)
  if (!validation.ok) throw new RangeError(validation.error.code)
  const cursor = new InputCursor(validation.trace)
  let state = createState({ ...config, ghostline: config.ghostline ?? null })
  const path: (0 | 1 | 2)[] = [pathCode(state.path)]
  const x: number[] = [toCentimetres(state.x)]
  const tick: number[] = [0]
  let next = 1
  while (!state.finished) {
    const before = state.dist
    state = step(state, cursor.at(state.tick))
    if (state.dist < before) next = Math.trunc((state.dist + GHOSTLINE_STEP - 1) / GHOSTLINE_STEP)
    while (next * GHOSTLINE_STEP <= state.dist) {
      path[next] = pathCode(state.path)
      x[next] = toCentimetres(state.x)
      tick[next] = state.tick
      next++
    }
  }
  return { step: GHOSTLINE_STEP, path, x, tick }
}
