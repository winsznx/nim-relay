import { describe, expect, it } from 'vitest'
import { preferredTourRecord, TOUR_ID_PATTERN, TOUR_STEP_ID_PATTERN, TOUR_VERSION_PATTERN, tourVersionNumber, type TourProgressRecord } from './tour'

const record = (state: TourProgressRecord['state'], updatedAt: number): TourProgressRecord => ({ state, updatedAt })

describe('tour progress merge', () => {
  it('lets completed and skipped beat started, whatever the times', () => {
    const started = record('started', 3_000)
    expect(preferredTourRecord(started, record('completed', 1_000))).toEqual(record('completed', 1_000))
    expect(preferredTourRecord(record('skipped', 1_000), started)).toEqual(record('skipped', 1_000))
  })

  it('keeps the later record between two of the same kind, and the current one on a tie', () => {
    expect(preferredTourRecord(record('skipped', 1_000), record('completed', 2_000))).toEqual(record('completed', 2_000))
    expect(preferredTourRecord(record('completed', 2_000), record('skipped', 1_000))).toEqual(record('completed', 2_000))
    expect(preferredTourRecord(record('started', 1_000), record('started', 5_000))).toEqual(record('started', 5_000))
    const current = record('completed', 4_000)
    expect(preferredTourRecord(current, record('skipped', 4_000))).toBe(current)
  })

  it('takes whichever record exists when the other is missing', () => {
    expect(preferredTourRecord(null, record('started', 1))).toEqual(record('started', 1))
    expect(preferredTourRecord(record('skipped', 1), undefined)).toEqual(record('skipped', 1))
    expect(preferredTourRecord(null, null)).toBeNull()
  })
})

describe('tour identifiers', () => {
  it('accepts short lowercase ids and v-numbered versions only', () => {
    expect(['core', 'gameplay', 'relay-2'].every(id => TOUR_ID_PATTERN.test(id))).toBe(true)
    expect(['', 'Core', 'core tour', 'a'.repeat(41), 'core:v1'].some(id => TOUR_ID_PATTERN.test(id))).toBe(false)
    expect(['v1', 'v12', 'v999'].every(version => TOUR_VERSION_PATTERN.test(version))).toBe(true)
    expect(['1', 'v', 'v1000', 'V1', 'v1.2'].some(version => TOUR_VERSION_PATTERN.test(version))).toBe(false)
    expect(TOUR_STEP_ID_PATTERN.test('open-journey')).toBe(true)
  })

  it('reads the number of a version and refuses anything else', () => {
    expect([tourVersionNumber('v1'), tourVersionNumber('v42'), tourVersionNumber('beta')]).toEqual([1, 42, -1])
  })
})
