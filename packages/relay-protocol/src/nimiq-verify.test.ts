import { describe, expect, it } from 'vitest'
import { bytesToHex, deriveNimiqAddress, hexToBytes, verifyNimiqSignedMessage } from './nimiq-verify'

/**
 * Golden vector generated with the real @nimiq/core (Node.js build,
 * offline-only per DECISIONS.md D-001) - NOT hand-derived. This is an
 * independent cross-check of our pure-JS re-implementation against the
 * actual Nimiq crypto library, not just a self-consistency test.
 * Regeneration script: evidence/testnet/phase2-nimiq-signature-vector.md
 */
const VECTOR = {
  message: 'NIM Relay login\norigin: https://nim-relay.example\nnonce: test-nonce-123',
  publicKeyHex: 'af760135a20ffd2ba887e3b781f21282abb699d7391ca3516347890fe11bdec6',
  signatureHex:
    '7106f1c7567c3084bf82439094ff0eb29d73ed35fcdd893073d4520414535f5049ce96d0d3768894da13df574987025f4192be184ef500ea1cefcaa9b40d2503',
  addressHex: 'bcf3fee801c0cd2ebfe72c062978210276a8b543',
}

describe('verifyNimiqSignedMessage (cross-checked against real @nimiq/core)', () => {
  it('verifies a real Nimiq-signed message', async () => {
    const valid = await verifyNimiqSignedMessage({
      message: VECTOR.message,
      signatureHex: VECTOR.signatureHex,
      publicKeyHex: VECTOR.publicKeyHex,
    })
    expect(valid).toBe(true)
  })

  it('derives the exact same address @nimiq/core computed', () => {
    const derived = bytesToHex(deriveNimiqAddress(hexToBytes(VECTOR.publicKeyHex)))
    expect(derived).toBe(VECTOR.addressHex)
  })

  it('rejects a tampered message', async () => {
    const valid = await verifyNimiqSignedMessage({
      message: `${VECTOR.message} tampered`,
      signatureHex: VECTOR.signatureHex,
      publicKeyHex: VECTOR.publicKeyHex,
    })
    expect(valid).toBe(false)
  })

  it('rejects a signature from the wrong key', async () => {
    const wrongKey = VECTOR.publicKeyHex.replace(/^../, '00')
    const valid = await verifyNimiqSignedMessage({
      message: VECTOR.message,
      signatureHex: VECTOR.signatureHex,
      publicKeyHex: wrongKey,
    })
    expect(valid).toBe(false)
  })

  it('never throws on malformed hex input - returns false', async () => {
    await expect(
      verifyNimiqSignedMessage({ message: 'x', signatureHex: 'not-hex', publicKeyHex: 'also-not-hex' }),
    ).resolves.toBe(false)
    await expect(
      verifyNimiqSignedMessage({ message: 'x', signatureHex: '', publicKeyHex: '' }),
    ).resolves.toBe(false)
  })
})
