import { describe, expect, it } from 'vitest'
import { abs, add, sub, mul, div, sqrt, clamp, lerp, ratio, quotient, ONE, HALF } from './index'

describe('integer Q16.16 arithmetic', () => {
  it('adds, subtracts and clamps exact units', () => {
    expect(add(ONE, HALF)).toBe(98304)
    expect(sub(HALF, ONE)).toBe(-32768)
    expect(clamp(-1)).toBe(0)
    expect(clamp(ONE + 1)).toBe(ONE)
    expect(clamp(HALF)).toBe(HALF)
    expect(abs(-HALF)).toBe(HALF)
  })
  it('uses BigInt intermediates and truncates towards zero, including negatives', () => {
    expect(mul(98304, 98304)).toBe(147456)
    expect(mul(-1, HALF)).toBe(0)
    expect(mul(2147483647, ONE)).toBe(2147483647)
    expect(div(ONE, 3 * ONE)).toBe(21845)
    expect(div(-ONE, 3 * ONE)).toBe(-21845)
    expect(ratio(1, 3)).toBe(21845)
    expect(quotient(-7, 3)).toBe(-2)
  })
  it('computes floored square roots and bounded interpolation', () => {
    expect(sqrt(0)).toBe(0)
    expect(sqrt(ONE)).toBe(ONE)
    expect(sqrt(4 * ONE)).toBe(2 * ONE)
    expect(sqrt(2 * ONE)).toBe(92681)
    expect(sqrt(1)).toBe(256)
    expect(lerp(0, ONE, HALF)).toBe(HALF)
    expect(lerp(ONE, 0, ONE)).toBe(0)
  })
  it('rejects undefined math and unsafe integer inputs', () => {
    expect(() => div(ONE, 0)).toThrow(RangeError)
    expect(() => sqrt(-1)).toThrow(RangeError)
    expect(() => add(0.5, 0)).toThrow(RangeError)
    expect(() => mul(Number.MAX_SAFE_INTEGER, ONE * 2)).toThrow(RangeError)
  })
})
