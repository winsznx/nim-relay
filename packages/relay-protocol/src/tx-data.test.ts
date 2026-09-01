import { describe, expect, it } from 'vitest'
import { decodeTxData, deriveCommitment, encodeTxData, legCodeToNumber, legNumberToCode } from './tx-data'

describe('tx-data commitment codec (PRD section 9.5)', () => {
  it('derives a 128-bit (22-char base64url) commitment deterministically', async () => {
    const a = await deriveCommitment('deadbeef')
    const b = await deriveCommitment('deadbeef')
    expect(a).toBe(b)
    expect(a).toHaveLength(22)
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('different intents produce different commitments (collision target)', async () => {
    const a = await deriveCommitment('deadbeef')
    const b = await deriveCommitment('deadbeee')
    expect(a).not.toBe(b)
  })

  it('round-trips leg number <-> leg code', () => {
    for (const n of [0, 1, 35, 36, 1_000_000]) {
      expect(legCodeToNumber(legNumberToCode(n))).toBe(n)
    }
  })

  it('encodes and decodes deterministically, staying under the 64-byte budget', async () => {
    const commitment = await deriveCommitment('deadbeef')
    const encoded = encodeTxData({ relayCode: 'GLOBAL01', legNumber: 42, commitment })
    const byteLength = new TextEncoder().encode(encoded).length
    expect(byteLength).toBeLessThanOrEqual(64)
    expect(encoded.startsWith('NR1.')).toBe(true)

    const decoded = decodeTxData(encoded)
    expect(decoded).toEqual({ version: 'NR1', relayCode: 'GLOBAL01', legNumber: 42, commitment })

    // Deterministic: encoding the same input twice yields the same bytes.
    expect(encodeTxData({ relayCode: 'GLOBAL01', legNumber: 42, commitment })).toBe(encoded)
  })

  it('rejects malformed relay codes and commitments at encode time', async () => {
    const commitment = await deriveCommitment('deadbeef')
    expect(() => encodeTxData({ relayCode: 'bad code!', legNumber: 1, commitment })).toThrow()
    expect(() => encodeTxData({ relayCode: 'OK', legNumber: 1, commitment: 'too-short' })).toThrow()
    expect(() => encodeTxData({ relayCode: 'OK', legNumber: -1, commitment })).toThrow()
  })

  it('decodeTxData never throws on garbage input - returns null', () => {
    const garbage = [
      '',
      'not-the-right-shape',
      'NR1.only.three',
      'NR0.GLOBAL01.a.' + 'x'.repeat(22),
      'NR1.bad code.a.' + 'x'.repeat(22),
      'NR1.GLOBAL01.!!!.' + 'x'.repeat(22),
      'NR1.GLOBAL01.a.tooshort',
      'NR1.GLOBAL01.a.' + 'x'.repeat(21), // one char short
      'NR1.GLOBAL01.a.' + 'x'.repeat(23), // one char long
    ]
    for (const g of garbage) {
      expect(decodeTxData(g)).toBeNull()
    }
  })

  it('rejects an oversized relay code that would blow the 64-byte budget', async () => {
    const commitment = await deriveCommitment('deadbeef')
    // relayCode pattern caps at 12 chars so this should fail pattern validation first.
    expect(() => encodeTxData({ relayCode: 'A'.repeat(13), legNumber: 1, commitment })).toThrow()
  })
})
