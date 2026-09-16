import { runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatonDetail, NetworkSnapshot } from '@nim-relay/shared'
import { api, call, chainTransfer, confirmWith, createBaton, joinNetwork, prepareAndAttempt, raceLeg, randomTxHash, runner, stationRoom } from './testing'

const DAY = 86_400_000

/** Moves the Worker clock; Durable Objects share this isolate, so reconciliation sees the same time. */
function travelTo(time: number): void {
  vi.setSystemTime(time)
}

describe('recipient reservations', () => {
  let start: number

  beforeEach(() => {
    start = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    travelTo(start)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('release an unaccepted Quick opponent after 24 hours so the holder can seat another runner', async () => {
    // #given a Quick match whose invited opponent never accepts
    const [a, b, c] = [await runner(), await runner(), await runner()]
    await joinNetwork(a, b, c)
    const match = await createBaton(a, { mode: 'quick', recipient: b.p.id, bestOf: 3 })
    const leg = await raceLeg(a, match.baton.id)
    const beforeRelease = await api(a.cookie, '/network/handoff/prepare', { runId: leg.issued.runId, recipient: c.p.id })
    // #when a day passes and reconciliation runs
    travelTo(start + DAY + 60_000)
    await runDurableObjectAlarm(stationRoom())
    const intent = await prepareAndAttempt(a, c, leg.issued.runId)
    const hash = randomTxHash()
    const confirmation = await confirmWith(a, intent, hash, chainTransfer(intent, hash))
    const inbox = (await call<NetworkSnapshot>(a.cookie, '/network')).inbox
    // #then the holder was told, and the runner who received the baton took the opponent seat
    expect({
      beforeRelease: beforeRelease.status,
      told: inbox.some(notification => notification.type === 'recipient_timeout' && notification.batonId === match.baton.id),
      verified: confirmation.status,
      players: confirmation.baton?.quick?.players,
    }).toEqual({ beforeRelease: 400, told: true, verified: 'verified', players: [a.p.id, c.p.id] })
  })

  it('keep an accepted Global reservation past 24 hours', async () => {
    // #given a Global baton reserved for runner b, who accepts
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Accepted in time', recipient: b.p.id })
    await call<BatonDetail>(b.cookie, '/network/accept', { batonId: journey.baton.id })
    // #when a day passes and reconciliation runs
    travelTo(start + DAY + 60_000)
    await runDurableObjectAlarm(stationRoom())
    // #then the reservation holds
    const detail = await call<BatonDetail>('', `/network/batons/${journey.baton.id}`)
    expect([detail.baton.recipientId, detail.baton.recipientAcceptedAt]).toEqual([b.p.id, start])
  })

  it('release an unaccepted Global reservation only once 24 hours have passed', async () => {
    // #given a Global baton reserved for runner b, who never accepts
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Waiting for b', recipient: b.p.id })
    // #when reconciliation runs just before and just after the window
    travelTo(start + DAY - 60_000)
    await runDurableObjectAlarm(stationRoom())
    const early = await call<BatonDetail>('', `/network/batons/${journey.baton.id}`)
    await call(a.cookie, '/network')
    travelTo(start + DAY + 60_000)
    await runDurableObjectAlarm(stationRoom())
    const late = await call<BatonDetail>('', `/network/batons/${journey.baton.id}`)
    // #then only the second run releases it
    expect([early.baton.recipientId, late.baton.recipientId]).toEqual([b.p.id, null])
  })
})
