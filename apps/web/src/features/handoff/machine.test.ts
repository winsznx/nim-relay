import { describe, expect, it, vi } from 'vitest'
import type { NetworkConfirmation, NetworkHandoffIntent, RelayNote } from '@nim-relay/shared'
import { classifyWalletError, HandoffOrchestrator, noteLength, type HandoffDeps, type TransferRecord } from './machine'

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
    note: null,
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

/** Chooses Mariana and moves past the note step, with or without a note. */
function aim(machine: HandoffOrchestrator, note: RelayNote | null = null): void {
  machine.select(runner)
  machine.attachNote(note)
}

describe('handoff ceremony', () => {
  it('locks the recipient, opens Nimiq Pay once, and confirms only after server verification', async () => {
    const { deps, machine, records } = harness()
    machine.select(runner)
    expect(machine.getSnapshot()).toEqual({ stage: 'note', recipient: runner, draft: null, refusal: null })
    machine.attachNote(null)
    expect(machine.getSnapshot()).toEqual({ stage: 'aiming', recipient: runner, note: null })
    await machine.throwBaton(launch)
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, null)
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
    aim(machine)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('paused')
    await machine.launch()
    expect(deps.prepare).toHaveBeenCalledTimes(1)
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('reports insufficient balance distinctly from a decline', async () => {
    const { machine } = harness({ send: vi.fn(async () => Promise.reject(Object.assign(new Error('Insufficient balance'), { type: 'InvalidTransactionError' }))) })
    aim(machine)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('insufficient')
  })

  it('never reopens Nimiq Pay after an ambiguous wallet outcome', async () => {
    const { deps, machine } = harness({ send: vi.fn(async () => Promise.reject(new Error('Request timed out'))) })
    aim(machine)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('recovery')
    await machine.launch()
    expect(deps.send).toHaveBeenCalledTimes(1)
    await machine.submitRecoveredHash('not-a-hash')
    expect(machine.getSnapshot()).toMatchObject({ stage: 'recovery', invalidHash: true })
    await machine.submitRecoveredHash(HASH.toUpperCase())
    expect(machine.getSnapshot()).toMatchObject({ stage: 'confirmed', hash: HASH })
  })

  it('re-arms the same intent only after the holder confirms nothing was sent', async () => {
    let calls = 0
    const { deps, machine } = harness({
      send: vi.fn(async () => {
        calls++
        if (calls === 1) throw new Error('Request timed out')
        return HASH
      }),
    })
    aim(machine)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot().stage).toBe('recovery')
    await machine.confirmNothingSent()
    expect(machine.getSnapshot().stage).toBe('armed')
    await machine.launch()
    expect(deps.prepare).toHaveBeenCalledTimes(1)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'confirmed', hash: HASH })
  })

  it('stays in flight while the chain confirms, then verifies', async () => {
    let checks = 0
    const { machine } = harness({
      confirm: vi.fn(async (): Promise<NetworkConfirmation> => (++checks < 3 ? { status: 'pending', reason: 'INSUFFICIENT_CONFIRMATIONS' } : { status: 'verified' })),
    })
    aim(machine)
    await machine.throwBaton(launch)
    expect(checks).toBe(3)
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('keeps the baton with the holder when verification rejects the transaction', async () => {
    const { machine } = harness({ confirm: vi.fn(async (): Promise<NetworkConfirmation> => ({ status: 'rejected', reason: 'RECIPIENT_MISMATCH' })) })
    aim(machine)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'not-verified', reason: 'RECIPIENT_MISMATCH' })
  })

  it('flags a transaction that was already used for another handoff', async () => {
    const { machine } = harness({ confirm: vi.fn(async () => Promise.reject(new ApiError('transaction_already_used'))) })
    aim(machine)
    await machine.throwBaton(launch)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'not-verified', reason: 'DUPLICATE_TRANSACTION' })
  })

  it('returns to runner selection when the chosen runner is unavailable', async () => {
    const { machine } = harness({ prepare: vi.fn(async () => Promise.reject(new ApiError('recipient_unavailable'))) })
    aim(machine)
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

describe('relay note', () => {
  it('travels with the throw, trimmed, with the visibility the holder chose', async () => {
    // #given a holder who writes a private note for Mariana
    const { deps, machine } = harness()
    machine.select(runner)
    machine.attachNote({ text: '  Don’t drop the baton.  ', visibility: 'private' })
    expect(machine.getSnapshot()).toEqual({ stage: 'aiming', recipient: runner, note: { text: 'Don’t drop the baton.', visibility: 'private' } })

    // #when they throw
    await machine.throwBaton(launch)

    // #then the prepared intent carries exactly that note
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, { text: 'Don’t drop the baton.', visibility: 'private' })
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('treats a blank note as no note', async () => {
    const { deps, machine } = harness()
    aim(machine, { text: '   ', visibility: 'public' })
    expect(machine.getSnapshot()).toEqual({ stage: 'aiming', recipient: runner, note: null })
    await machine.throwBaton(launch)
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, null)
  })

  it('holds a note over the limit on the note step before anything is sent', () => {
    // #given 49 code points, where emoji count once each
    const text = `${'🏃'.repeat(9)}${'a'.repeat(40)}`
    expect(noteLength(text)).toBe(49)
    const { deps, machine } = harness()

    // #when the holder tries to attach it
    machine.select(runner)
    machine.attachNote({ text, visibility: 'public' })

    // #then the draft stays with the refusal and nothing reached the relay
    expect(machine.getSnapshot()).toEqual({ stage: 'note', recipient: runner, draft: { text, visibility: 'public' }, refusal: 'note_too_long' })
    expect(deps.prepare).not.toHaveBeenCalled()
  })

  it('counts a 48-emoji note as within the limit', () => {
    const { machine } = harness()
    aim(machine, { text: '🏃'.repeat(48), visibility: 'public' })
    expect(machine.getSnapshot().stage).toBe('aiming')
  })

  it('returns to the note step with the draft when moderation refuses it, then passes with a new note', async () => {
    // #given the relay refuses the first note
    let calls = 0
    const { deps, machine } = harness({
      prepare: vi.fn(async () => {
        calls++
        if (calls === 1) throw new ApiError('note_not_allowed')
        return intent({ note: { text: 'Go fast', visibility: 'public' } })
      }),
    })
    const refused: RelayNote = { text: 'something rude', visibility: 'public' }
    aim(machine, refused)

    // #when the holder throws
    await machine.throwBaton(launch)

    // #then the ceremony is back on the note step with the refused draft, and no wallet opened
    expect(machine.getSnapshot()).toEqual({ stage: 'note', recipient: runner, draft: refused, refusal: 'note_not_allowed' })
    expect(deps.send).not.toHaveBeenCalled()

    // #when they rewrite it and throw again
    machine.attachNote({ text: 'Go fast', visibility: 'public' })
    await machine.throwBaton(launch)

    // #then the new note is prepared and the pass goes through once
    expect(deps.prepare).toHaveBeenLastCalledWith('run-1', runner.id, launch, { text: 'Go fast', visibility: 'public' })
    expect(deps.send).toHaveBeenCalledTimes(1)
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('keeps a server length refusal on the note step too', async () => {
    const { machine } = harness({ prepare: vi.fn(async () => Promise.reject(new ApiError('note_too_long'))) })
    aim(machine, { text: 'Café au lait, extra long', visibility: 'public' })
    await machine.throwBaton(launch)
    expect(machine.getSnapshot()).toMatchObject({ stage: 'note', refusal: 'note_too_long', draft: { text: 'Café au lait, extra long' } })
  })

  it('lets the holder reopen the note from the launch pad without losing it', () => {
    const { machine } = harness()
    const note: RelayNote = { text: 'Keep it gold', visibility: 'public' }
    aim(machine, note)
    machine.editNote()
    expect(machine.getSnapshot()).toEqual({ stage: 'note', recipient: runner, draft: note, refusal: null })
  })

  it('drops the note when the holder goes back to choose another runner', () => {
    const { machine } = harness()
    aim(machine, { text: 'For you', visibility: 'private' })
    machine.changeRunner()
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: null })
    machine.select({ id: 'runner-c', name: 'Yasmine', handle: 'yasmine' })
    expect(machine.getSnapshot()).toMatchObject({ stage: 'note', draft: null })
  })

  it('ignores note actions outside the note step', async () => {
    const { deps, machine } = harness()
    machine.attachNote({ text: 'Too early', visibility: 'public' })
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: null })
    machine.select(runner)
    await machine.throwBaton(launch)
    expect(deps.prepare).not.toHaveBeenCalled()
    expect(machine.getSnapshot().stage).toBe('note')
  })
})
