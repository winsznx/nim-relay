import type { GrantMilestoneId, GrantMilestoneView, GrantsView } from '@nim-relay/shared'
import { create } from 'zustand'
import { errorCode, playerMessage } from '../shell/errors'
import { GRANT_API_COPY } from './copy'

/**
 * One grant claim from the tap to the reveal. The server signs and sends the transfer; this only asks for the device
 * signal when the session has none, names the milestone, and follows the grant until the chain confirms it.
 */

export type ClaimPhase =
  | { kind: 'idle' }
  /** Nimiq Pay is asking to share the device signal. */
  | { kind: 'device' }
  /** The relay is signing and sending the treasury transfer. */
  | { kind: 'sending' }
  | { kind: 'confirming'; txHash: string | null; confirmations: number | null }
  /** Still unconfirmed after the watch window; the relay keeps checking on its own. */
  | { kind: 'slow'; txHash: string | null }
  /** The baton flies from Genesis Station. */
  | { kind: 'arriving' }
  | { kind: 'revealed'; batonCode: string | null; batonName: string | null; txHash: string | null }
  | { kind: 'failed'; message: string; code: string | null }

export interface ClaimDeps {
  loadGrants(): Promise<GrantsView>
  claimGrant(grantId: GrantMilestoneId): Promise<{ milestone: GrantMilestoneView; grants: GrantsView }>
  requestDevice(): Promise<string | undefined>
  linkDevice(deviceId: string): Promise<unknown>
  /** The starter baton's first stop, to fly to. */
  loadBaton(code: string): Promise<{ name: string; destination: string }>
  fly(to: string): Promise<void>
  onGrants(view: GrantsView): void
  wait(ms: number): Promise<void>
}

export const CONFIRM_POLL_MS = 3_000
export const CONFIRM_WATCH_MS = 4 * 60_000

class ClaimRefused extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export async function runClaim(grantId: GrantMilestoneId, deps: ClaimDeps, report: (phase: ClaimPhase) => void, now: () => number = Date.now): Promise<ClaimPhase> {
  const settle = (phase: ClaimPhase) => {
    report(phase)
    return phase
  }
  try {
    const current = await deps.loadGrants()
    if (!current.deviceSignal) {
      report({ kind: 'device' })
      const deviceId = await deps.requestDevice()
      if (!deviceId) throw new ClaimRefused('no_device_signal')
      await deps.linkDevice(deviceId)
    }
    report({ kind: 'sending' })
    const claimed = await deps.claimGrant(grantId)
    deps.onGrants(claimed.grants)
    let milestone = claimed.milestone
    const watchUntil = now() + CONFIRM_WATCH_MS
    while (milestone.state === 'pending') {
      report({ kind: 'confirming', txHash: milestone.phase === 'confirming' ? milestone.txHash : null, confirmations: milestone.confirmations })
      if (now() >= watchUntil) return settle({ kind: 'slow', txHash: milestone.txHash })
      await deps.wait(CONFIRM_POLL_MS)
      const grants = await deps.loadGrants()
      deps.onGrants(grants)
      milestone = grants.milestones.find(item => item.id === grantId) ?? milestone
    }
    if (milestone.state === 'failed') throw new ClaimRefused('grant_transfer_failed')
    if (milestone.state !== 'confirmed') throw new ClaimRefused(milestone.blocked ?? 'grant_transfer_failed')
    if (!milestone.batonCode) return settle({ kind: 'revealed', batonCode: null, batonName: null, txHash: milestone.txHash })
    report({ kind: 'arriving' })
    const baton = await deps.loadBaton(milestone.batonCode)
    await deps.fly(baton.destination)
    return settle({ kind: 'revealed', batonCode: milestone.batonCode, batonName: baton.name, txHash: milestone.txHash })
  } catch (error) {
    const code = error instanceof ClaimRefused ? error.code : errorCode(error)
    return settle({ kind: 'failed', code, message: grantMessage(code) ?? playerMessage(error) ?? 'The grant didn’t go through. Try again.' })
  }
}


export function grantMessage(code: string | null): string | null {
  return code ? (GRANT_API_COPY[code] ?? null) : null
}

interface ClaimStore {
  grantId: GrantMilestoneId | null
  phase: ClaimPhase
  running: boolean
  start(grantId: GrantMilestoneId, deps: ClaimDeps): void
  reset(): void
}

/** App-wide, so closing the sheet mid-claim never loses track of a transfer that is already on its way. */
export const useClaimFlow = create<ClaimStore>((set, get) => ({
  grantId: null,
  phase: { kind: 'idle' },
  running: false,
  start(grantId, deps) {
    if (get().running) return
    set({ grantId, running: true, phase: { kind: 'sending' } })
    void runClaim(grantId, deps, phase => set({ phase })).finally(() => set({ running: false }))
  },
  reset() {
    if (!get().running) set({ grantId: null, phase: { kind: 'idle' } })
  },
}))
