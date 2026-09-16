import { describe, expect, it, vi } from 'vitest'
import type { NetworkConfirmation, NetworkHandoffIntent } from '@nim-relay/shared'
import { classifyWalletError, HandoffOrchestrator, type HandoffDeps, type TransferRecord } from './machine'

const HASH = 'a'.repeat(64)
const runner = { id: 'runner-b', name: 'Mariana', handle: 'mariana' }
const launch = { angle: 45, power: 75 }

function intent(overrides: Partial<NetworkHandoffIntent> = {}): NetworkHandoffIntent {
  return {
    id: 'intent-1',
    batonId: 'baton-1',
    runId: 'run-1',
    recipientId: runner.id,
    recipientName: runner.name,
    sender: 'NQ00 SENDER',
    recipient: 'NQ00 RECIPIENT',
    value: 100000,
    data: 'NR1.CODE.1.commitment',
    network: 'TestAlbatross',
    leg: 1,
    status: 'pending',
    state: 'prepared',
    txHash: null,
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    attemptedAt: null,
    failure: null,
    ...overrides,
  }
}

class ApiError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

function harness(overrides: Partial<HandoffDeps> = {}) {
  const records = new Map<string, TransferRecord>()
  const deps: HandoffDeps = {
    prepare: vi.fn(async () => intent()),
    attempt: vi.fn(async () => intent({ state: 'attempting' })),
    cancel: vi.fn(async () => intent({ state: 'cancelled' })),
    confirm: vi.fn(async (): Promise<NetworkConfirmation> => ({ status: 'verified', intent: intent({ state: 'verified', txHash: HASH }) })),
    send: vi.fn(async () => HASH),
    readTransfer: async id => records.get(id),
    saveTransfer: async record => {
      records.set(record.id, record)
    },
    wait: async () => undefined,
    ...overrides,
  }
  const machine = new HandoffOrchestrator(deps, 'run-1')
  return { deps, machine, records }
}

describe('handoff ceremony', () => {
  it('locks the recipient, opens Nimiq Pay once, and confirms only after server verification', async () => {
    const { deps, machine, records } = harness()
    machine.select(runner)
    expect(machine.getSnapshot().stage).toBe('aiming')
    await machine.throwBaton(launch)
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch)
    expect(deps.send).toHaveBeenCalledTimes(1)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'confirmed', hash: HASH })
    expect(records.get('intent-1')).toEqual({ id: 'intent-1', hash: HASH, state: 'verified' })
  })

  it('pauses on an explicit wallet decline and lets the holder retry the same intent', async () => {
    let calls = 0
    const { deps, machine } = harness({
      send: vi.fn(async () => {
        calls++
        if (calls === 1) throw Object.assign(new Error('User rejected the confirmation dialog'), { type: 'PermissionDeniedError' })
        return HASH
      }),
    })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('paused')
    await machine.launch()
    expect(deps.prepare).toHaveBeenCalledTimes(1)
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('reports insufficient balance distinctly from a decline', async () => {
    const { machine } = harness({ send: vi.fn(async () => Promise.reject(Object.assign(new Error('Insufficient balance'), { type: 'InvalidTransactionError' }))) })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('insufficient')
  })

  it('never reopens Nimiq Pay after an ambiguous wallet outcome', async () => {
    const { deps, machine } = harness({ send: vi.fn(async () => Promise.reject(new Error('Request timed out'))) })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('recovery')
    await machine.launch()
    expect(deps.send).toHaveBeenCalledTimes(1)
    await machine.submitRecoveredHash('not-a-hash')
    expect(machine.getSnapshot()).toMatchObject({ stage: 'recovery', invalidHash: true })
    await machine.submitRecoveredHash(HASH.toUpperCase())
    expect(machine.getSnapshot()).toMatchObject({ stage: 'confirmed', hash: HASH })
  })

  it('stays in flight while the chain confirms, then verifies', async () => {
    let checks = 0
    const { machine } = harness({
      confirm: vi.fn(async (): Promise<NetworkConfirmation> => (++checks < 3 ? { status: 'pending', reason: 'INSUFFICIENT_CONFIRMATIONS' } : { status: 'verified' })),
    })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(checks).toBe(3)
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('keeps the baton with the holder when verification rejects the transaction', async () => {
    const { machine } = harness({ confirm: vi.fn(async (): Promise<NetworkConfirmation> => ({ status: 'rejected', reason: 'RECIPIENT_MISMATCH' })) })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'not-verified', reason: 'RECIPIENT_MISMATCH' })
  })

  it('flags a transaction that was already used for another handoff', async () => {
    const { machine } = harness({ confirm: vi.fn(async () => Promise.reject(new ApiError('transaction_already_used'))) })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'not-verified', reason: 'DUPLICATE_TRANSACTION' })
  })

  it('returns to runner selection when the chosen runner is unavailable', async () => {
    const { machine } = harness({ prepare: vi.fn(async () => Promise.reject(new ApiError('recipient_unavailable'))) })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: 'recipient-unavailable' })
  })

  it('resumes a sent handoff from local recovery without paying again', async () => {
    const { deps, machine, records } = harness()
    records.set('intent-1', { id: 'intent-1', hash: HASH, state: 'sent' })
    await machine.resume(intent({ state: 'attempting' }))
    expect(deps.send).not.toHaveBeenCalled()
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('treats an attempt that never recorded a hash as needing wallet recovery', async () => {
    const { machine, records } = harness()
    records.set('intent-1', { id: 'intent-1', hash: null, state: 'attempting' })
    await machine.resume(intent())
    expect(machine.getSnapshot().stage).toBe('recovery')
  })

  it('cancels only an unattempted pass', async () => {
    const { deps, machine } = harness()
    await machine.resume(intent())
    expect(machine.getSnapshot().stage).toBe('armed')
    await machine.cancelUnattempted()
    expect(deps.cancel).toHaveBeenCalledWith('intent-1')
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: null })
  })

  it('classifies Nimiq Pay errors', () => {
    expect(classifyWalletError(Object.assign(new Error('User rejected'), { type: 'PermissionDeniedError' }))).toBe('declined')
    expect(classifyWalletError(new Error('Insufficient funds'))).toBe('insufficient')
    expect(classifyWalletError(new Error('Network error while broadcasting'))).toBe('ambiguous')
  })
})
