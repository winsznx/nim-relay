import { MAX_TICKS, NUDGE_RANGE, type Input, type InputTrace, type Sample } from './types'

export const MAX_TRACE_BYTES = 65536

export type TraceErrorCode = 'count' | 'shape' | 'order' | 'after-end' | 'input' | 'size'
export type TraceValidation =
  | { ok: true; trace: InputTrace }
  | { ok: false; error: { code: TraceErrorCode; index: number } }

/**
 * Samples are `[ticksSincePreviousSample, shift, nudge, action]`. The first sample is at
 * tick 0 and every later one strictly after its predecessor. Every sample must start
 * before `maxTicks` (the leg's final tick when finalizing). Validation never throws.
 */
export function validateTrace(value: unknown, maxTicks = MAX_TICKS): TraceValidation {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TICKS) return failure('count', -1)
  const trace: Sample[] = []
  let tick = 0
  let bytes = 2
  for (let i = 0; i < value.length; i++) {
    const sample: unknown = value[i]
    if (!Array.isArray(sample) || sample.length !== 4) return failure('shape', i)
    const [dt, shift, nudge, action] = sample as readonly unknown[]
    if (!isValidDelta(dt, i)) return failure('order', i)
    tick += dt
    if (tick >= maxTicks) return failure('after-end', i)
    if (!isValidShift(shift) || !isValidNudge(nudge) || !isValidAction(action)) return failure('input', i)
    bytes += JSON.stringify(sample).length + (i === 0 ? 0 : 1)
    if (bytes > MAX_TRACE_BYTES) return failure('size', i)
    trace.push([dt, shift, nudge, action])
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

function isValidShift(shift: unknown): shift is -1 | 0 | 1 {
  return shift === -1 || shift === 0 || shift === 1
}

function isValidNudge(nudge: unknown): nudge is number {
  return typeof nudge === 'number' && Number.isInteger(nudge) && nudge >= -NUDGE_RANGE && nudge <= NUDGE_RANGE
}

function isValidAction(action: unknown): action is 0 | 1 | 2 {
  return action === 0 || action === 1 || action === 2
}

/**
 * Reads a validated trace tick by tick. Nudge holds until the next sample; shift and
 * action are impulses that fire only on their sample's tick. Ticks must be requested in
 * non-decreasing order.
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
    const onSample = tick === this.sampleTick
    return { shift: onSample ? sample[1] : 0, nudge: sample[2], action: onSample ? sample[3] : 0 }
  }
}
