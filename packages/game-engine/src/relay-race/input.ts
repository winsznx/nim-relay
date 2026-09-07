/**
 * Relay Race (engine v3) input trace. Two channels, one thumb:
 *   steerQ : horizontal intent, quantized to [-64, 64] client-side
 *   boost  : 0 | 1 hold-to-boost
 * Sample `[dtTicks, steerQ, boost]` written on change + forced keyframe every
 * KEYFRAME_TICKS. Sample-and-hold between samples (bit-exact, no interpolation).
 * v1 and v2 trace formats are untouched.
 */

export const STEER_MIN = -64
export const STEER_MAX = 64
export const KEYFRAME_TICKS = 24
export const MAX_RACE_SAMPLES = 6000
export const MAX_RACE_TRACE_BYTES = 32768

export type RaceSample = readonly [number, number, 0 | 1]
export type RaceInputTrace = readonly RaceSample[]

export type RaceTraceErrorCode = 'shape' | 'count' | 'size' | 'first-tick' | 'order' | 'after-end' | 'steer-range' | 'boost-value'
export type RaceTraceValidation =
  | { ok: true; trace: RaceInputTrace }
  | { ok: false; error: { code: RaceTraceErrorCode; index: number } }

export function validateRaceTrace(value: unknown, maxTicks: number): RaceTraceValidation {
  const fail = (code: RaceTraceErrorCode, index = -1): RaceTraceValidation => ({ ok: false, error: { code, index } })
  if (!Array.isArray(value)) return fail('shape')
  if (value.length === 0 || value.length > MAX_RACE_SAMPLES) return fail('count')
  const trace: RaceSample[] = []
  let tick = -1
  let bytes = 2
  for (let i = 0; i < value.length; i++) {
    const s: unknown = value[i]
    if (!Array.isArray(s) || s.length !== 3) return fail('shape', i)
    const [dt, steerQ, boost] = s as [unknown, unknown, unknown]
    if (typeof dt !== 'number' || !Number.isInteger(dt) || dt < 0) return fail('order', i)
    if (i === 0 && dt !== 0) return fail('first-tick', i)
    if (i > 0 && dt < 1) return fail('order', i)
    tick += dt
    if (tick >= maxTicks) return fail('after-end', i)
    if (typeof steerQ !== 'number' || !Number.isInteger(steerQ) || steerQ < STEER_MIN || steerQ > STEER_MAX) return fail('steer-range', i)
    if (boost !== 0 && boost !== 1) return fail('boost-value', i)
    bytes += String(dt).length + String(steerQ).length + 4
    if (bytes > MAX_RACE_TRACE_BYTES) return fail('size', i)
    trace.push([dt, steerQ, boost])
  }
  return { ok: true, trace }
}

interface Resolved {
  ticks: number[]
  steer: number[]
  boost: (0 | 1)[]
}

function resolve(trace: RaceInputTrace): Resolved {
  const ticks: number[] = []
  const steer: number[] = []
  const boost: (0 | 1)[] = []
  let t = 0
  for (let i = 0; i < trace.length; i++) {
    t += i === 0 ? 0 : trace[i]![0]
    ticks.push(t)
    steer.push(trace[i]![1])
    boost.push(trace[i]![2])
  }
  return { ticks, steer, boost }
}

/** Forward cursor for the sim loop. */
export class RaceInputCursor {
  private readonly r: Resolved
  private i = 0
  constructor(trace: RaceInputTrace) {
    this.r = resolve(trace)
  }
  at(tick: number): { steer: number; boost: 0 | 1 } {
    while (this.i + 1 < this.r.ticks.length && this.r.ticks[this.i + 1]! <= tick) this.i++
    if (tick < this.r.ticks[0]!) return { steer: this.r.steer[0]!, boost: this.r.boost[0]! }
    return { steer: this.r.steer[this.i]!, boost: this.r.boost[this.i]! }
  }
}
