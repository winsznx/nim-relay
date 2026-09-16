import { MAX_TICKS, type Input, type InputTrace, type Sample } from './types'

export const MAX_TRACE_BYTES = 65536

export type TraceErrorCode = 'count' | 'shape' | 'order' | 'after-end' | 'input' | 'size'
export type TraceValidation =
  | { ok: true; trace: InputTrace }
  | { ok: false; error: { code: TraceErrorCode; index: number } }

/**
 * Samples are `[ticksSincePreviousSample, steer, action]`. The first sample is
 * at tick 0 and every later one strictly after its predecessor. Every sample
 * must start before `maxTicks` (the leg's final tick when finalizing).
 * Validation never throws.
 */
export function validateTrace(value: unknown, maxTicks = MAX_TICKS): TraceValidation {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TICKS) return failure('count', -1)
  const trace: Sample[] = []
  let tick = 0
  let bytes = 2
  for (let i = 0; i < value.length; i++) {
    const sample: unknown = value[i]
    if (!Array.isArray(sample) || sample.length !== 3) return failure('shape', i)
    const [dt, steer, action] = sample as readonly unknown[]
    if (!isValidDelta(dt, i)) return failure('order', i)
    tick += dt
    if (tick >= maxTicks) return failure('after-end', i)
    if (!isValidSteer(steer) || !isValidAction(action)) return failure('input', i)
    bytes += JSON.stringify(sample).length + (i === 0 ? 0 : 1)
    if (bytes > MAX_TRACE_BYTES) return failure('size', i)
    trace.push([dt, steer, action])
  }
  return { ok: true, trace }
}

function failure(code: TraceErrorCode, index: number): TraceValidation {
  return { ok: false, error: { code, index } }
}

function isValidDelta(dt: unknown, index: number): dt is number {
  if (typeof dt !== 'number' || !Number.isSafeInteger(dt)) return false
  return index === 0 ? dt === 0 : dt > 0
}

function isValidSteer(steer: unknown): steer is number {
  return typeof steer === 'number' && Number.isInteger(steer) && steer >= -64 && steer <= 64
}

function isValidAction(action: unknown): action is 0 | 1 | 2 {
  return action === 0 || action === 1 || action === 2
}

/**
 * Reads a validated trace tick by tick. Steer holds until the next sample;
 * actions are impulses that fire only on their sample's tick.
 * Ticks must be requested in non-decreasing order.
 */
export class InputCursor {
  private index = 0
  private sampleTick = 0

  constructor(private readonly trace: InputTrace) {
    const validation = validateTrace(trace)
    if (!validation.ok) throw new RangeError(validation.error.code)
  }

  at(tick: number): Input {
    while (this.index + 1 < this.trace.length && this.sampleTick + this.trace[this.index + 1]![0] <= tick) {
      this.index++
      this.sampleTick += this.trace[this.index]![0]
    }
    const sample = this.trace[this.index]!
    return { steer: sample[1], action: tick === this.sampleTick ? sample[2] : 0 }
  }
}
