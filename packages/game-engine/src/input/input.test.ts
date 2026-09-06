import { describe, expect, it } from 'vitest'
import { inputAtTick, MAX_INPUT_EVENTS, validateInputTrace } from './index'

describe('bounded canonical input transitions', () => {
  const malformed: [unknown, string][] = [
    [null, 'shape'], [{ inputs: [] }, 'shape'], [[[0, 1, 2]], 'shape'], [[null], 'shape'],
    [[[-1, 1]], 'timestamp'], [[[0.5, 1]], 'timestamp'], [[[NaN, 1]], 'timestamp'], [[[Infinity, 1]], 'timestamp'], [[[Number.MAX_SAFE_INTEGER + 1, 1]], 'timestamp'], [[['0', 1]], 'timestamp'],
    [[[100, 1], [99, 0]], 'order'], [[[0, 1], [0, 0]], 'order'],
    [[[20000, 1]], 'after-end'], [[[20001, 1]], 'after-end'],
    [[[0, 2]], 'value'], [[[0, true]], 'value'], [[[0, 0]], 'transition'], [[[0, 1], [20, 1]], 'transition'],
    [Array.from({ length: MAX_INPUT_EVENTS + 1 }, (_, i) => [i, i % 2 === 0 ? 1 : 0]), 'count'],
    [Array.from({ length: MAX_INPUT_EVENTS }, (_, i) => [10000 + i, i % 2 === 0 ? 1 : 0]), 'size'],
  ]
  for (const [index, [input, code]] of malformed.entries()) {
    it(`rejects malformed class ${code} (${index}) without throwing`, () => {
      expect(() => validateInputTrace(input, 20000)).not.toThrow()
      expect(validateInputTrace(input, 20000)).toMatchObject({ ok: false, error: { code } })
    })
  }
  it('counts canonical JSON bytes exactly at the artifact limit', () => {
    const events = Array.from({ length: 3276 }, (_, i) => [10000 + i, i % 2 === 0 ? 1 : 0])
    expect(JSON.stringify(events).length).toBe(32761)
    expect(validateInputTrace(events, 20000).ok).toBe(true)
    events.push([13276, 1])
    expect(validateInputTrace(events, 20000)).toMatchObject({ ok: false, error: { code: 'size' } })
  })
  it('rejects impossible run durations', () => {
    for (const duration of [0, 14999, 30001, Infinity, 20000.1]) expect(validateInputTrace([], duration)).toMatchObject({ ok: false, error: { code: 'duration' } })
  })
  it('copies valid traces, allows held final input, and assigns integer milliseconds to exact tick boundaries', () => {
    const source = [[0, 1], [17, 0], [19999, 1]]
    const result = validateInputTrace(source, 20000)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Valid fixture rejected')
    source[0] = [0, 0]
    expect(result.trace[0]).toEqual([0, 1])
    expect(inputAtTick(result.trace, 0)).toBe(1)
    expect(inputAtTick(result.trace, 1)).toBe(1)
    expect(inputAtTick(result.trace, 2)).toBe(0)
    expect(inputAtTick([], 100)).toBe(0)
    expect(validateInputTrace([], 15000)).toEqual({ ok: true, trace: [] })
  })
})
