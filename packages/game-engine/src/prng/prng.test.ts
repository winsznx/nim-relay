import { expect, it } from 'vitest'
import { seedState, splitmix64 } from './index'

it('matches SplitMix64 seed-zero reference vectors, including 64-bit wraparound', () => {
  let state = 0n
  for (const expected of ['e220a8397b1dcdaf', '6e789e6aa1b965f4', '06c45d188009454f', 'f88bb8a8724c81ec', '1b39896a51a8749b']) {
    const result = splitmix64(state)
    expect(result.value.toString(16).padStart(16, '0')).toBe(expected)
    state = result.state
  }
  expect(splitmix64((1n << 64n) - 1n)).toEqual(splitmix64(-1n))
  expect(splitmix64(1n << 64n)).toEqual(splitmix64(0n))
})
it('binds every UTF-16 seed code unit without runtime encoders', () => {
  expect(seedState('hello')).toBe(0xa430d84680aabd0bn)
  expect(seedState('hello')).not.toBe(seedState('Hello'))
  expect(seedState('🚀')).toBe(seedState('\ud83d\ude80'))
})
