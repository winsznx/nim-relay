/**
 * Relay Run (engine v2) input trace — deterministic quantized analog steering
 * plus a binary pressed channel. See docs/RELAY_GAME_V2.md §7.1.
 *
 * A sample is `[tickDelta, steerQ, pressed]`:
 *   - tickDelta: ticks since the previous sample (>= 1, except the first which
 *     is at tick 0 so tickDelta 0)
 *   - steerQ: horizontal intent quantized to [STEER_MIN, STEER_MAX] (7-bit),
 *     quantized client-side before entering the trace
 *   - pressed: 0 | 1 contextual action
 *
 * Samples are written only when steerQ or pressed changes, plus a forced
 * keyframe every KEYFRAME_TICKS. Between samples the sim uses sample-and-hold
 * (piecewise constant) — no interpolation, bit-exact on every runtime.
 *
 * The v1 binary trace format (`../input`) is untouched; this is a separate
 * format used only by version-2 challenges.
 */

export const STEER_MIN = -64
export const STEER_MAX = 64
export const KEYFRAME_TICKS = 30
export const MAX_RELAY_SAMPLES = 4096
export const MAX_RELAY_TRACE_BYTES = 24576

export type RelaySample = readonly [number, number, 0 | 1]
export type RelayInputTrace = readonly RelaySample[]

export type RelayTraceErrorCode =
  | 'shape'
  | 'count'
  | 'size'
  | 'first-tick'
  | 'order'
  | 'after-end'
  | 'steer-range'
  | 'pressed-value'

export type RelayTraceValidation =
  | { ok: true; trace: RelayInputTrace; totalTicks: number }
  | { ok: false; error: { code: RelayTraceErrorCode; index: number } }

/** Validate a relay input trace against a run length in ticks. Never throws. */
export function validateRelayTrace(value: unknown, totalTicks: number): RelayTraceValidation {
  const fail = (code: RelayTraceErrorCode, index = -1): RelayTraceValidation => ({ ok: false, error: { code, index } })
  if (!Array.isArray(value)) return fail('shape')
  if (value.length === 0 || value.length > MAX_RELAY_SAMPLES) return fail('count')

  const trace: RelaySample[] = []
  let tick = -1
  let bytes = 2
  for (let index = 0; index < value.length; index++) {
    const s: unknown = value[index]
    if (!Array.isArray(s) || s.length !== 3) return fail('shape', index)
    const [dt, steerQ, pressed] = s as [unknown, unknown, unknown]
    if (typeof dt !== 'number' || !Number.isInteger(dt) || dt < 0) return fail('order', index)
    if (index === 0 && dt !== 0) return fail('first-tick', index)
    if (index > 0 && dt < 1) return fail('order', index)
    tick += dt
    if (tick >= totalTicks) return fail('after-end', index)
    if (typeof steerQ !== 'number' || !Number.isInteger(steerQ) || steerQ < STEER_MIN || steerQ > STEER_MAX) {
      return fail('steer-range', index)
    }
    if (pressed !== 0 && pressed !== 1) return fail('pressed-value', index)
    bytes += String(dt).length + String(steerQ).length + 4
    if (bytes > MAX_RELAY_TRACE_BYTES) return fail('size', index)
    trace.push([dt, steerQ, pressed])
  }
  return { ok: true, trace, totalTicks }
}

interface Resolved {
  ticks: number[]
  steer: number[]
  pressed: (0 | 1)[]
}

function resolve(trace: RelayInputTrace): Resolved {
  const ticks: number[] = []
  const steer: number[] = []
  const pressed: (0 | 1)[] = []
  let tick = 0
  for (let i = 0; i < trace.length; i++) {
    tick += i === 0 ? 0 : trace[i]![0]
    ticks.push(tick)
    steer.push(trace[i]![1])
    pressed.push(trace[i]![2])
  }
  return { ticks, steer, pressed }
}

function lastAtOrBefore(ticks: number[], tick: number): number {
  let lo = 0
  let hi = ticks.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ticks[mid]! <= tick) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** A cursor that walks a trace forward tick-by-tick (O(1) amortised) for the sim loop. */
export class RelayInputCursor {
  private readonly r: Resolved
  private i = 0

  constructor(trace: RelayInputTrace) {
    this.r = resolve(trace)
  }

  at(tick: number): { steer: number; pressed: 0 | 1 } {
    while (this.i + 1 < this.r.ticks.length && this.r.ticks[this.i + 1]! <= tick) this.i++
    if (tick < this.r.ticks[0]!) return { steer: this.r.steer[0]!, pressed: this.r.pressed[0]! }
    return { steer: this.r.steer[this.i]!, pressed: this.r.pressed[this.i]! }
  }
}

/** Random-access lookup (used by tests and the ghost). */
export function steerAtTick(trace: RelayInputTrace, tick: number): number {
  const r = resolve(trace)
  const idx = Math.max(0, lastAtOrBefore(r.ticks, tick))
  return r.steer[idx] ?? 0
}

export function pressedAtTick(trace: RelayInputTrace, tick: number): 0 | 1 {
  const r = resolve(trace)
  const idx = Math.max(0, lastAtOrBefore(r.ticks, tick))
  return r.pressed[idx] ?? 0
}
