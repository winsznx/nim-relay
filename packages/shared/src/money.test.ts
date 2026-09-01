import { describe, expect, it } from 'vitest'
import { GLOBAL_RELAY_BATON_LUNA, lunaToNim, nimToLuna } from './money'

describe('money conversion', () => {
  it('converts 1 NIM to exactly 100000 Luna', () => {
    expect(nimToLuna(1)).toBe(100_000n)
    expect(nimToLuna(1)).toBe(GLOBAL_RELAY_BATON_LUNA)
  })

  it('round-trips without float drift', () => {
    expect(lunaToNim(nimToLuna(0.5))).toBeCloseTo(0.5, 10)
    expect(nimToLuna(0)).toBe(0n)
  })

  it('rejects negative amounts', () => {
    expect(() => nimToLuna(-1)).toThrow()
    expect(() => lunaToNim(-1n)).toThrow()
  })
})
