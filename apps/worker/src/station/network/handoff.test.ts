import { describe, expect, it } from 'vitest'
import { TransactionNotFoundError, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { HandoffReasonCode, NetworkHandoffIntent } from '@nim-relay/shared'
import { api, call, chainTransfer, confirmWith, createBaton, joinNetwork, passBaton, prepareAndAttempt, raceLeg, randomTxHash, runner, type TestRunner } from './testing'

async function attemptedHandoff(): Promise<{ a: TestRunner; b: TestRunner; intent: NetworkHandoffIntent }> {
  const [a, b] = [await runner(), await runner()]
  await joinNetwork(a, b)
  const journey = await createBaton(a, { mode: 'global', title: 'Verification codes' })
  const leg = await raceLeg(a, journey.baton.id)
  return { a, b, intent: await prepareAndAttempt(a, b, leg.issued.runId) }
}

function withData(intent: NetworkHandoffIntent, part: 'relay' | 'leg' | 'commitment'): string {
  const [version, relay, leg, commitment] = intent.data.split('.')
  if (part === 'relay') return [version, 'OTHERRELAY1', leg, commitment].join('.')
  if (part === 'leg') return [version, relay, 'z', commitment].join('.')
  return [version, relay, leg, 'A'.repeat(22)].join('.')
}

const REJECTIONS: [HandoffReasonCode, (intent: NetworkHandoffIntent) => Partial<NimiqTransaction>][] = [
  ['RECIPIENT_MISMATCH', () => ({ recipient: 'NQ00 ANOTHER RUNNER' })],
  ['VALUE_MISMATCH', intent => ({ value: String(intent.value - 1) })],
  ['DATA_MALFORMED', () => ({ data: 'not a relay commitment' })],
  ['DATA_RELAY_MISMATCH', intent => ({ data: withData(intent, 'relay') })],
  ['DATA_LEG_MISMATCH', intent => ({ data: withData(intent, 'leg') })],
  ['DATA_COMMITMENT_MISMATCH', intent => ({ data: withData(intent, 'commitment') })],
  ['NETWORK_MISMATCH', () => ({ network: 'MainAlbatross' })],
  ['EXECUTION_FAILED', () => ({ executionResult: false })],
]

describe('handoff confirmation reason codes', () => {
  it('verifies a pass paid from another address, as Nimiq Pay does', async () => {
    // #given an attempted handoff, and a wallet that pays from an internal address rather than the sign-in address
    const { a, intent } = await attemptedHandoff()
    const hash = randomTxHash()
    // #when that transfer carries the pass's commitment to the chosen runner
    const verified = await confirmWith(a, intent, hash, chainTransfer(intent, hash, { sender: 'NQ59 NIMIQ PAY INTERNAL' }))
    // #then it counts
    expect(verified.status).toBe('verified')
  })

  it.each(REJECTIONS)('rejects a transfer with %s and waits for the correct one', async (reason, mismatch) => {
    // #given an attempted handoff
    const { a, intent } = await attemptedHandoff()
    const wrongHash = randomTxHash()
    // #when the submitted transaction does not match the intent
    const rejected = await confirmWith(a, intent, wrongHash, chainTransfer(intent, wrongHash, mismatch(intent)))
    // #then it is rejected with its code and the intent still accepts the real transfer
    const rightHash = randomTxHash()
    const verified = await confirmWith(a, intent, rightHash, chainTransfer(intent, rightHash))
    expect([rejected.status, rejected.reason, rejected.intent?.state, rejected.intent?.txHash, verified.status]).toEqual(['rejected', reason, 'attempting', null, 'verified'])
  })

  it.each([
    ['NOT_INCLUDED', (intent: NetworkHandoffIntent, hash: string) => chainTransfer(intent, hash, { blockNumber: null, confirmations: 0 })],
    ['INSUFFICIENT_CONFIRMATIONS', (intent: NetworkHandoffIntent, hash: string) => chainTransfer(intent, hash, { confirmations: 1 })],
    ['NOT_INCLUDED', (_intent: NetworkHandoffIntent, hash: string) => new TransactionNotFoundError(hash)],
    ['RPC_UNAVAILABLE', () => new Error('fetch failed')],
  ] as const)('keeps a transfer pending with %s and binds its hash', async (reason, chain) => {
    // #given an attempted handoff
    const { a, intent } = await attemptedHandoff()
    const hash = randomTxHash()
    // #when the chain cannot confirm it yet
    const pending = await confirmWith(a, intent, hash, chain(intent, hash))
    // #then it stays pending on the same transaction
    const otherHash = await api(a.cookie, '/network/handoff/confirm', { id: intent.id, txHash: randomTxHash() })
    expect([pending.status, pending.reason, pending.intent?.state, pending.intent?.txHash, otherHash.status]).toEqual(['pending', reason, 'submitted', hash, 409])
  })

  it('rejects a cancelled intent as expired', async () => {
    // #given a prepared handoff the holder cancelled before opening the wallet
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Cancelled' })
    const leg = await raceLeg(a, journey.baton.id)
    const intent = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: b.p.id })
    await call(a.cookie, '/network/handoff/cancel', { id: intent.id })
    // #when a transaction is submitted for it
    const hash = randomTxHash()
    const confirmation = await confirmWith(a, intent, hash, chainTransfer(intent, hash))
    // #then it can never verify
    expect([confirmation.status, confirmation.reason]).toEqual(['rejected', 'INTENT_EXPIRED'])
  })

  it('rejects a transaction already used by another handoff', async () => {
    // #given a verified handoff on one baton and an attempted handoff on another
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const first = await createBaton(a, { mode: 'global', title: 'First transfer' })
    const used = await passBaton(a, b, first.baton.id)
    const second = await createBaton(a, { mode: 'global', title: 'Second transfer' })
    const leg = await raceLeg(a, second.baton.id)
    const intent = await prepareAndAttempt(a, b, leg.issued.runId)
    // #when the first transfer's hash is submitted again
    const duplicate = await confirmWith(a, intent, used.txHash, chainTransfer(intent, used.txHash))
    // #then it is rejected and the baton stays with its holder
    const detail = await call<{ baton: { holder: { id: string } } }>('', `/network/batons/${second.baton.id}`)
    expect([duplicate.status, duplicate.reason, duplicate.intent?.txHash, detail.baton.holder.id]).toEqual(['rejected', 'DUPLICATE_TRANSACTION', null, a.p.id])
  })

  it('confirms a verified handoff again without moving custody twice', async () => {
    // #given a verified handoff
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Idempotent confirmation' })
    const pass = await passBaton(a, b, journey.baton.id)
    // #when the same transaction is confirmed again
    const again = await confirmWith(a, pass.intent, pass.txHash, chainTransfer(pass.intent, pass.txHash))
    // #then it is still verified at the same handoff count
    expect([again.status, again.baton?.handoffCount, again.baton?.holder.id]).toEqual(['verified', 1, b.p.id])
  })
})
