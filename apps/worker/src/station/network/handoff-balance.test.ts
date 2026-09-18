import { afterEach, describe, expect, it, vi } from 'vitest'
import { NimiqRpcClient } from '@nim-relay/relay-protocol'
import type { NetworkHandoffIntent } from '@nim-relay/shared'
import { api, call, createBaton, joinNetwork, raceLeg, runner } from './testing'

/** A holder who raced their leg and locked a pass to the next runner, before Nimiq Pay opened. */
async function preparedPass(title: string) {
  const [holder, recipient] = [await runner(), await runner()]
  await joinNetwork(holder, recipient)
  const journey = await createBaton(holder, { mode: 'global', title })
  const leg = await raceLeg(holder, journey.baton.id)
  const intent = await call<NetworkHandoffIntent>(holder.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: recipient.p.id })
  return { holder, intent }
}

function holderBalance(luna: bigint | Error) {
  return vi.spyOn(NimiqRpcClient.prototype, 'getAccountBalance').mockImplementation(async () => {
    if (luna instanceof Error) throw luna
    return { luna, blockNumber: 1 }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('holder balance before a pass', () => {
  it('refuses to open Nimiq Pay when the holder account cannot cover the baton, and leaves the pass sendable', async () => {
    // #given a locked pass whose holder account is empty on chain
    const { holder, intent } = await preparedPass('Empty holder')
    const balance = holderBalance(0n)
    // #when the app asks to open Nimiq Pay
    const refused = await api(holder.cookie, '/network/handoff/attempt', { id: intent.id })
    // #then it is told to fund that account instead, and the pass was never marked attempted
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: 'holder_balance_too_low' })
    expect(balance).toHaveBeenCalledWith(intent.sender)
    // #when the holder funds the account and tries again
    holderBalance(BigInt(intent.value))
    const attempted = await call<NetworkHandoffIntent>(holder.cookie, '/network/handoff/attempt', { id: intent.id })
    // #then the pass goes ahead
    expect(attempted.state).toBe('attempting')
  })

  it('never blocks a pass when the balance cannot be read', async () => {
    const { holder, intent } = await preparedPass('Unreadable balance')
    holderBalance(new Error('RPC unavailable'))
    const attempted = await call<NetworkHandoffIntent>(holder.cookie, '/network/handoff/attempt', { id: intent.id })
    expect(attempted.state).toBe('attempting')
  })
})
