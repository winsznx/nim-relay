import { describe, expect, it, vi } from 'vitest'
import type { GrantMilestoneView, GrantsView } from '@nim-relay/shared'
import { CONFIRM_WATCH_MS, runClaim, type ClaimDeps, type ClaimPhase } from './claim-flow'

function milestone(overrides: Partial<GrantMilestoneView>): GrantMilestoneView {
  return { id: 'starter', title: 'Starter Baton', requirement: '', luna: 100_000, state: 'available', blocked: null, phase: null, txHash: null, confirmations: null, batonCode: null, updatedAt: null, ...overrides }
}

function view(starter: Partial<GrantMilestoneView>, deviceSignal = true): GrantsView {
  return { network: 'TestAlbatross', enabled: true, paused: false, deviceSignal, claimedLuna: 0, confirmedLuna: 0, capLuna: 500_000, treasuryAddress: null, milestones: [milestone(starter)] }
}

function deps(overrides: Partial<ClaimDeps>, polls: GrantsView[] = []): ClaimDeps {
  const queue = [...polls]
  return {
    loadGrants: vi.fn(async () => queue.shift() ?? view({ state: 'confirmed', batonCode: 'ABC', txHash: 'h' })),
    claimGrant: vi.fn(async () => ({ milestone: milestone({ state: 'pending', phase: 'confirming', txHash: 'h' }), grants: view({ state: 'pending' }) })),
    requestDevice: vi.fn(async () => 'device'),
    linkDevice: vi.fn(async () => ({ deviceSignal: true })),
    loadBaton: vi.fn(async () => ({ name: 'Starter Baton', destination: 'cape-verdigris' })),
    fly: vi.fn(async () => undefined),
    onGrants: vi.fn(),
    wait: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('grant claim flow', () => {
  it('confirms, flies the baton from Genesis Station and reveals it', async () => {
    // #given a runner whose claim confirms on the second poll
    const phases: ClaimPhase[] = []
    const flow = deps({}, [view({ state: 'available' }), view({ state: 'pending', phase: 'confirming', txHash: 'h' })])
    // #when they claim
    const end = await runClaim('starter', flow, phase => phases.push(phase))
    // #then they see sending, confirming, the flight and the reveal, in order
    expect(phases.map(phase => phase.kind)).toEqual(['sending', 'confirming', 'confirming', 'arriving', 'revealed'])
    expect(end).toEqual({ kind: 'revealed', batonCode: 'ABC', batonName: 'Starter Baton', txHash: 'h' })
    expect(flow.fly).toHaveBeenCalledWith('cape-verdigris')
    expect(flow.requestDevice).not.toHaveBeenCalled()
  })

  it('asks Nimiq Pay for the device signal only when the session has none, and stops honestly without it', async () => {
    const declined = deps({ requestDevice: vi.fn(async () => undefined) }, [view({ state: 'locked', blocked: 'no_device_signal' }, false)])
    const end = await runClaim('starter', declined, () => undefined)
    expect(end).toMatchObject({ kind: 'failed', code: 'no_device_signal' })
    expect(declined.claimGrant).not.toHaveBeenCalled()
  })

  it('reports a transfer that never landed as failed and retryable', async () => {
    const flow = deps({}, [view({ state: 'available' }), view({ state: 'failed' })])
    expect(await runClaim('starter', flow, () => undefined)).toMatchObject({ kind: 'failed', code: 'grant_transfer_failed', message: expect.stringContaining('try again') })
  })

  it('passes a server refusal through in player words', async () => {
    const refused = Object.assign(new Error('Your wallet'), { code: 'wallet_already_funded' })
    const flow = deps({ claimGrant: vi.fn(async () => Promise.reject(refused)) }, [view({ state: 'available' })])
    expect(await runClaim('starter', flow, () => undefined)).toMatchObject({ kind: 'failed', code: 'wallet_already_funded', message: expect.stringContaining('already holds') })
  })

  it('stops watching after the watch window without calling the grant failed', async () => {
    let clock = 0
    const pending = view({ state: 'pending', phase: 'confirming', txHash: 'h' })
    const flow = deps({ wait: vi.fn(async () => { clock += CONFIRM_WATCH_MS }) }, [view({ state: 'available' }), pending, pending])
    expect(await runClaim('starter', flow, () => undefined, () => clock)).toEqual({ kind: 'slow', txHash: 'h' })
  })
})
