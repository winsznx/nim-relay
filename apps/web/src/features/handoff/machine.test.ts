import { describe, expect, it, vi } from 'vitest'
import type { AtlasNextRoute, NetworkConfirmation, NetworkHandoffIntent, RelayNote } from '@nim-relay/shared'
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
    route: null,
    ...overrides,
  }
}

class ApiError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const ROUTES: AtlasNextRoute = {
  policy: 'choose',
  station: 'cape-verdigris',
  routeIds: ['genesis-to-cape-verdigris', 'cape-verdigris-to-meridian-yard', 'cape-verdigris-to-trade-wind-quay'],
  rerunRouteId: 'genesis-to-cape-verdigris',
  defaultRouteId: 'cape-verdigris-to-meridian-yard',
}

function harness(overrides: Partial<HandoffDeps> = {}, routes: AtlasNextRoute | null = null) {
  const records = new Map<string, TransferRecord>()
  const deps: HandoffDeps = {
    prepare: vi.fn(async () => intent()),
    attempt: vi.fn(async () => intent({ state: 'attempting' })),
    cancel: vi.fn(async () => intent({ state: 'cancelled' })),
    confirm: vi.fn(async (): Promise<NetworkConfirmation> => ({ status: 'verified', intent: intent({ state: 'verified', txHash: HASH }) })),
    check: vi.fn(async () => intent({ state: 'attempting', attemptedAt: 1 })),
    send: vi.fn(async () => HASH),
    readTransfer: async id => records.get(id),
    saveTransfer: async record => {
      records.set(record.id, record)
    },
    wait: async () => undefined,
    ...overrides,
  }
  const machine = new HandoffOrchestrator(deps, 'run-1', routes)
  return { deps, machine, records }
}

/** Chooses Mariana and moves past the note step, with or without a note. */
function aim(machine: HandoffOrchestrator, note: RelayNote | null = null): void {
  machine.select(runner)
  machine.attachNote(note)
}

describe('handoff route step', () => {
  it('opens on the route when the holder may choose, and binds the chosen route into the pass', async () => {
    // #given a pass that offers routes out of Cape Verdigris
    const { deps, machine } = harness({}, ROUTES)
    expect(machine.getSnapshot()).toEqual({ stage: 'route', notice: null })
    // #when the holder picks the trade winds route, then a runner, and throws
    machine.chooseRoute('cape-verdigris-to-trade-wind-quay')
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: null })
    aim(machine)
    await machine.throwBaton(launch)
    // #then the pass is prepared with that route
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, null, 'cape-verdigris-to-trade-wind-quay')
  })

  it('ignores a route the relay did not offer and lets the relay pick when asked', async () => {
    const { deps, machine } = harness({}, ROUTES)
    machine.chooseRoute('aurora-ridge-to-fjordgate')
    expect(machine.getSnapshot().stage).toBe('route')
    machine.chooseRoute(null)
    aim(machine)
    await machine.throwBaton(launch)
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, null, null)
  })

  it('goes back to the route from the runner and the throw, keeping the runner step after', () => {
    const { machine } = harness({}, ROUTES)
    machine.chooseRoute('genesis-to-cape-verdigris')
    aim(machine)
    machine.changeRoute()
    expect([machine.getSnapshot(), machine.chosenRoute]).toEqual([{ stage: 'route', notice: null }, 'genesis-to-cape-verdigris'])
  })

  it('returns to the route step when the relay refuses the route', async () => {
    const { machine } = harness({ prepare: vi.fn(async () => Promise.reject(new ApiError('route_not_available'))) }, ROUTES)
    machine.chooseRoute('cape-verdigris-to-meridian-yard')
    aim(machine)
    await machine.throwBaton(launch)
    expect([machine.getSnapshot(), machine.chosenRoute]).toEqual([{ stage: 'route', notice: 'route-unavailable' }, null])
  })

  it('skips the route step when the route is fixed for this pass', () => {
    const { machine } = harness({}, { ...ROUTES, policy: 'fixed', routeIds: ['genesis-to-cape-verdigris'], defaultRouteId: 'genesis-to-cape-verdigris' })
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: null })
    machine.changeRoute()
    expect(machine.getSnapshot().stage).toBe('choose')
  })
})

describe('handoff ceremony', () => {
  it('locks the recipient, opens Nimiq Pay once, and confirms only after server verification', async () => {
    const { deps, machine, records } = harness()
    machine.select(runner)
    expect(machine.getSnapshot()).toEqual({ stage: 'note', recipient: runner, draft: null, refusal: null })
    machine.attachNote(null)
    expect(machine.getSnapshot()).toEqual({ stage: 'aiming', recipient: runner, note: null })
    await machine.throwBaton(launch)
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, null, null)
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

  it('never checks the chain for a pass whose hash this device kept', async () => {
    // #given a sent pass the relay still sees as attempting
    const { deps, machine, records } = harness()
    records.set('intent-1', { id: 'intent-1', hash: HASH, state: 'sent' })
    // #when it resumes
    await machine.resume(intent({ state: 'attempting', attemptedAt: 1 }))
    // #then the kept hash is confirmed directly
    expect([vi.mocked(deps.check).mock.calls, vi.mocked(deps.confirm).mock.calls]).toEqual([[], [['intent-1', HASH]]])
  })

  it('reports a pass that expired unsent as not verified', async () => {
    // #given the relay ended the pass before its late transfer was confirmed
    const { machine } = harness({ confirm: vi.fn(async (): Promise<NetworkConfirmation> => ({ status: 'rejected', reason: 'NOT_SENT' })) })
    // #when the holder throws and approves
    aim(machine)
    await machine.throwBaton(launch)
    // #then the reason survives to the copy
    expect(machine.getSnapshot()).toMatchObject({ stage: 'not-verified', reason: 'NOT_SENT' })
  })

  it('classifies Nimiq Pay errors', () => {
    expect(classifyWalletError(Object.assign(new Error('User rejected'), { type: 'PermissionDeniedError' }))).toBe('declined')
    expect(classifyWalletError(new Error('Insufficient funds'))).toBe('insufficient')
    expect(classifyWalletError(new Error('Network error while broadcasting'))).toBe('ambiguous')
  })
})

describe('resuming an attempted pass without a transaction hash', () => {
  const attempted = intent({ state: 'attempting', attemptedAt: 1 })

  it('shows the relay checking the chain before anything else', async () => {
    // #given a relay that has not answered the check yet
    let answer: (checked: NetworkHandoffIntent) => void = () => undefined
    const { machine } = harness({
      check: vi.fn(
        () =>
          new Promise<NetworkHandoffIntent>(resolve => {
            answer = resolve
          }),
      ),
    })
    // #when the pass resumes
    const resumed = machine.resume(attempted)
    await vi.waitFor(() => expect(machine.getSnapshot().stage).toBe('checking'))
    answer(attempted)
    await resumed
    // #then recovery is offered only once the check found nothing
    expect(machine.getSnapshot()).toEqual({ stage: 'recovery', intent: attempted, invalidHash: false })
  })

  it('confirms a transfer the relay found and verified on chain', async () => {
    // #given the relay found the approval that went through
    const { deps, machine } = harness({ check: vi.fn(async () => intent({ state: 'verified', status: 'verified', txHash: HASH, attemptedAt: 1 })) })
    // #when the pass resumes
    await machine.resume(attempted)
    // #then it is confirmed without opening Nimiq Pay
    expect([machine.getSnapshot(), vi.mocked(deps.check).mock.calls, vi.mocked(deps.send).mock.calls.length]).toMatchObject([{ stage: 'confirmed', hash: HASH }, [['intent-1']], 0])
  })

  it('follows a found transfer that still waits for confirmations', async () => {
    // #given the relay bound a transfer that is not confirmed yet
    const { deps, machine } = harness({ check: vi.fn(async () => intent({ state: 'submitted', txHash: HASH, attemptedAt: 1 })) })
    // #when the pass resumes
    await machine.resume(attempted)
    // #then it confirms through the bound hash
    expect([machine.getSnapshot().stage, vi.mocked(deps.confirm).mock.calls]).toEqual(['confirmed', [['intent-1', HASH]]])
  })

  it('returns to choosing a runner when the pass expired unsent', async () => {
    // #given the relay proved no transfer can arrive anymore
    const { machine } = harness({ check: vi.fn(async () => intent({ state: 'expired', failure: 'NOT_SENT', attemptedAt: 1 })) })
    // #when the pass resumes
    await machine.resume(attempted)
    // #then the holder chooses again with the baton still theirs
    expect(machine.getSnapshot()).toEqual({ stage: 'choose', notice: null })
  })

  it('offers recovery when the check fails, and never reopens Nimiq Pay', async () => {
    // #given a relay that cannot be reached
    const { deps, machine } = harness({ check: vi.fn(async () => Promise.reject(new ApiError('station_unavailable'))) })
    // #when the pass resumes
    await machine.resume(attempted)
    // #then the holder recovers the pass by hand
    expect([machine.getSnapshot().stage, vi.mocked(deps.send).mock.calls.length]).toEqual(['recovery', 0])
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
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, { text: 'Don’t drop the baton.', visibility: 'private' }, null)
    expect(machine.getSnapshot().stage).toBe('confirmed')
  })

  it('treats a blank note as no note', async () => {
    const { deps, machine } = harness()
    aim(machine, { text: '   ', visibility: 'public' })
    expect(machine.getSnapshot()).toEqual({ stage: 'aiming', recipient: runner, note: null })
    await machine.throwBaton(launch)
    expect(deps.prepare).toHaveBeenCalledWith('run-1', runner.id, launch, null, null)
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
    expect(deps.prepare).toHaveBeenLastCalledWith('run-1', runner.id, launch, { text: 'Go fast', visibility: 'public' }, null)
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
