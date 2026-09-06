export type InputTrace = readonly (readonly [number, 0 | 1])[]
export type TraceErrorCode = 'duration' | 'shape' | 'count' | 'size' | 'timestamp' | 'order' | 'after-end' | 'value' | 'transition'
export type TraceValidation = { ok: true; trace: InputTrace } | { ok: false; error: { code: TraceErrorCode; index: number } }
export const MAX_INPUT_EVENTS = 4096
export const MAX_TRACE_BYTES = 32768
export function validateInputTrace(value: unknown, durationMs: number): TraceValidation {
  const fail = (code: TraceErrorCode, index = -1): TraceValidation => ({ ok: false, error: { code, index } })
  if (!Number.isInteger(durationMs) || durationMs < 15000 || durationMs > 30000) return fail('duration')
  if (!Array.isArray(value)) return fail('shape')
  if (value.length > MAX_INPUT_EVENTS) return fail('count')
  let previousTime = -1
  let previousInput = 0
  let bytes = 2
  const trace: [number, 0 | 1][] = []
  for (let index = 0; index < value.length; index++) {
    const event: unknown = value[index]
    if (!Array.isArray(event) || event.length !== 2) return fail('shape', index)
    const time: unknown = event[0]
    const input: unknown = event[1]
    if (typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0) return fail('timestamp', index)
    if (time <= previousTime) return fail('order', index)
    if (time >= durationMs) return fail('after-end', index)
    if (input !== 0 && input !== 1) return fail('value', index)
    if (input === previousInput) return fail('transition', index)
    bytes += String(time).length + 4 + (index > 0 ? 1 : 0)
    if (bytes > MAX_TRACE_BYTES) return fail('size', index)
    trace.push([time, input]); previousTime = time; previousInput = input
  }
  return { ok: true, trace }
}
export function inputAtTick(trace: InputTrace, tick: number): 0 | 1 {
  let low = 0
  let high = trace.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const event = trace[mid]
    if (event && event[0] * 60 <= tick * 1000) low = mid + 1
    else high = mid
  }
  return trace[low - 1]?.[1] ?? 0
}
