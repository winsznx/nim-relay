import { describe, expect, it } from 'vitest'
import { encodeTxData } from './tx-data'
import type { NimiqTransaction } from './nimiq-rpc'
import { verifyHandoffTransaction, type ExpectedHandoffTransaction } from './verify-transaction'

const COMMITMENT = 'AAAAAAAAAAAAAAAAAAAAAA' // 22 base64url chars = 128 bits
const OTHER_COMMITMENT = 'BBBBBBBBBBBBBBBBBBBBBB'

const SENDER = 'NQ07 1111 1111 1111 1111 1111 1111 1111 1111'
const RECIPIENT = 'NQ42 2222 2222 2222 2222 2222 2222 2222 2222'

const expected: ExpectedHandoffTransaction = {
  senderWallet: SENDER,
  recipientWallet: RECIPIENT,
  valueLuna: 500_000n,
  relayCode: 'GLOBAL01',
  legNumber: 3,
  commitment: COMMITMENT,
  network: 'TestAlbatross',
  minConfirmations: 3,
}

function goodTx(overrides: Partial<NimiqTransaction> = {}): NimiqTransaction {
  return {
    hash: 'deadbeef',
    sender: SENDER.replace(/\s+/g, ''),
    recipient: RECIPIENT.toLowerCase(),
    value: '500000',
    data: encodeTxData({ relayCode: 'GLOBAL01', legNumber: 3, commitment: COMMITMENT }),
    network: 'test-albatross',
    blockNumber: 4_000_000,
    confirmations: 6,
    executionResult: true,
    ...overrides,
  }
}

describe('verifyHandoffTransaction', () => {
  it('accepts a fully matching, sufficiently-confirmed transaction', () => {
    const result = verifyHandoffTransaction(goodTx(), expected)
    expect(result).toEqual({ ok: true, confirmations: 6, blockNumber: 4_000_000 })
  })

  it('normalizes address spacing and case on both sides', () => {
    const result = verifyHandoffTransaction(
      goodTx({ sender: `  ${SENDER.toLowerCase()}  ` }),
      expected,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a wrong sender', () => {
    const result = verifyHandoffTransaction(goodTx({ sender: 'NQ07 9999' }), expected)
    expect(result).toMatchObject({ ok: false, reason: 'SENDER_MISMATCH' })
  })

  it('rejects a wrong recipient', () => {
    const result = verifyHandoffTransaction(goodTx({ recipient: 'NQ42 9999' }), expected)
    expect(result).toMatchObject({ ok: false, reason: 'RECIPIENT_MISMATCH' })
  })

  it('rejects a self-transfer even when it matches the (misconfigured) expectation', () => {
    const result = verifyHandoffTransaction(
      goodTx({ sender: SENDER, recipient: SENDER }),
      { ...expected, recipientWallet: SENDER },
    )
    expect(result).toMatchObject({ ok: false, reason: 'SELF_TRANSFER' })
  })

  it('rejects a wrong value', () => {
    const result = verifyHandoffTransaction(goodTx({ value: '499999' }), expected)
    expect(result).toMatchObject({ ok: false, reason: 'VALUE_MISMATCH' })
  })

  it('rejects an unparseable value without throwing', () => {
    const result = verifyHandoffTransaction(goodTx({ value: 'not-a-number' }), expected)
    expect(result).toMatchObject({ ok: false, reason: 'VALUE_MISMATCH' })
  })

  it('rejects malformed / missing tx data', () => {
    expect(verifyHandoffTransaction(goodTx({ data: null }), expected)).toMatchObject({
      ok: false,
      reason: 'DATA_MALFORMED',
    })
    expect(verifyHandoffTransaction(goodTx({ data: 'garbage' }), expected)).toMatchObject({
      ok: false,
      reason: 'DATA_MALFORMED',
    })
  })

  it('rejects a commitment for a different relay', () => {
    const result = verifyHandoffTransaction(
      goodTx({ data: encodeTxData({ relayCode: 'OTHER99', legNumber: 3, commitment: COMMITMENT }) }),
      expected,
    )
    expect(result).toMatchObject({ ok: false, reason: 'DATA_RELAY_MISMATCH' })
  })

  it('rejects a commitment for a different leg (replay onto another leg)', () => {
    const result = verifyHandoffTransaction(
      goodTx({ data: encodeTxData({ relayCode: 'GLOBAL01', legNumber: 4, commitment: COMMITMENT }) }),
      expected,
    )
    expect(result).toMatchObject({ ok: false, reason: 'DATA_LEG_MISMATCH' })
  })

  it('rejects a mismatched intent commitment', () => {
    const result = verifyHandoffTransaction(
      goodTx({ data: encodeTxData({ relayCode: 'GLOBAL01', legNumber: 3, commitment: OTHER_COMMITMENT }) }),
      expected,
    )
    expect(result).toMatchObject({ ok: false, reason: 'DATA_COMMITMENT_MISMATCH' })
  })

  it('rejects a transaction on the wrong network', () => {
    expect(verifyHandoffTransaction(goodTx({ network: 'main-albatross' }), expected)).toMatchObject({
      ok: false,
      reason: 'NETWORK_MISMATCH',
    })
    expect(verifyHandoffTransaction(goodTx({ network: null }), expected)).toMatchObject({
      ok: false,
      reason: 'NETWORK_MISMATCH',
    })
  })

  it('rejects a not-yet-included transaction', () => {
    const result = verifyHandoffTransaction(
      goodTx({ blockNumber: null, confirmations: null }),
      expected,
    )
    expect(result).toMatchObject({ ok: false, reason: 'NOT_INCLUDED' })
  })

  it('rejects an included-but-reverted transaction', () => {
    const result = verifyHandoffTransaction(goodTx({ executionResult: false }), expected)
    expect(result).toMatchObject({ ok: false, reason: 'EXECUTION_FAILED' })
  })

  it('rejects an under-confirmed transaction', () => {
    expect(verifyHandoffTransaction(goodTx({ confirmations: 2 }), expected)).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_CONFIRMATIONS',
    })
    expect(verifyHandoffTransaction(goodTx({ confirmations: null }), expected)).toMatchObject({
      ok: false,
      reason: 'INSUFFICIENT_CONFIRMATIONS',
    })
  })

  it('accepts exactly at the confirmation threshold', () => {
    expect(verifyHandoffTransaction(goodTx({ confirmations: 3 }), expected).ok).toBe(true)
  })
})
