import { expect, test } from 'vitest'
import { paymentAddress } from './address'
test('formats the canonical zero address and preserves native addresses', () => {
  expect(paymentAddress('00'.repeat(20))).toBe('NQ0700000000000000000000000000000000')
  expect(paymentAddress('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe('NQ0700000000000000000000000000000000')
})
