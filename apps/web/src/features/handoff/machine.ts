import type { NetworkBaton, NetworkConfirmation, NetworkHandoffIntent } from '@nim-relay/shared'

/**
 * The handoff ceremony as an explicit state machine. The baton only leaves the
 * holder when the server has independently verified the Nimiq transaction; every
 * other outcome keeps custody with the holder and says so.
 */

export interface RunnerChoice {
  id: string
  name: string
  handle: string
}

export interface LaunchParameters {
  angle: number
  power: number
}

export type ChooseNotice = 'recipient-unavailable' | 'match-opponent-only' | 'crew-member-only' | 'recipient-reserved'

export type VerificationFailure =
  | 'SENDER_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'DATA_MALFORMED'
  | 'DATA_RELAY_MISMATCH'
  | 'DATA_LEG_MISMATCH'
  | 'DATA_COMMITMENT_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'EXECUTION_FAILED'
  | 'DUPLICATE_TRANSACTION'
  | 'CUSTODY_CHANGED'
  | 'INTENT_EXPIRED'
  | 'UNKNOWN'

export type HandoffStage =
  | { stage: 'choose'; notice: ChooseNotice | null }
  | { stage: 'aiming'; recipient: RunnerChoice }
  | { stage: 'preparing'; recipient: RunnerChoice }
  | { stage: 'armed'; intent: NetworkHandoffIntent }
  | { stage: 'wallet'; intent: NetworkHandoffIntent }
  | { stage: 'paused'; intent: NetworkHandoffIntent }
  | { stage: 'insufficient'; intent: NetworkHandoffIntent }
  | { stage: 'recovery'; intent: NetworkHandoffIntent; invalidHash: boolean }
  | { stage: 'in-flight'; intent: NetworkHandoffIntent; hash: string; slow: boolean }
  | { stage: 'not-verified'; intent: NetworkHandoffIntent; hash: string; reason: VerificationFailure }
  | { stage: 'confirmed'; intent: NetworkHandoffIntent; hash: string; baton: NetworkBaton | null }
  | { stage: 'failed'; message: string }

export interface TransferRecord {
  id: string
  hash: string | null
  state: 'ready' | 'attempting' | 'sent' | 'verified'
}

export interface HandoffDeps {
  prepare(runId: string, recipientId: string, launch: LaunchParameters): Promise<NetworkHandoffIntent>
  attempt(intentId: string): Promise<NetworkHandoffIntent>
  cancel(intentId: string): Promise<NetworkHandoffIntent>
  confirm(intentId: string, hash: string): Promise<NetworkConfirmation>
  /** Opens native Nimiq Pay approval and resolves with the transaction hash. */
  send(intent: NetworkHandoffIntent): Promise<string>
  readTransfer(id: string): Promise<TransferRecord | undefined>
  saveTransfer(record: TransferRecord): Promise<void>
  wait(ms: number): Promise<void>
}

export type WalletOutcome = 'declined' | 'insufficient' | 'ambiguous'

const TX_HASH = /^[a-f0-9]{64}$/i

/** Nimiq Pay reports errors as `{ type, message }`; anything we cannot classify is treated as possibly broadcast. */
export function classifyWalletError(error: unknown): WalletOutcome {
  const type = typeof error === 'object' && error !== null && 'type' in error ? String((error as { type: unknown }).type) : ''
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const text = `${type} ${message}`
  if (/insufficient|balance|not enough|funds/i.test(text)) return 'insufficient'
  if (/permission ?denied|reject|cancel|denied|declin|abort by user/i.test(text)) return 'declined'
  return 'ambiguous'
}

export function chooseNoticeForError(code: string): ChooseNotice | null {
  switch (code) {
    case 'recipient_unavailable':
    case 'courier_not_found':
    case 'choose_another_courier':
      return 'recipient-unavailable'
    case 'pass_to_match_opponent':
      return 'match-opponent-only'
    case 'choose_a_crew_member':
      return 'crew-member-only'
    case 'recipient_reserved':
      return 'recipient-reserved'
    default:
      return null
  }
}

const KNOWN_FAILURES = new Set<VerificationFailure>([
  'SENDER_MISMATCH',
  'RECIPIENT_MISMATCH',
  'VALUE_MISMATCH',
  'DATA_MALFORMED',
  'DATA_RELAY_MISMATCH',
  'DATA_LEG_MISMATCH',
  'DATA_COMMITMENT_MISMATCH',
  'NETWORK_MISMATCH',
  'EXECUTION_FAILED',
  'DUPLICATE_TRANSACTION',
  'CUSTODY_CHANGED',
  'INTENT_EXPIRED',
])

export function verificationFailure(reason: string | undefined): VerificationFailure {
  const normalized = (reason ?? '').toUpperCase()
  return KNOWN_FAILURES.has(normalized as VerificationFailure) ? (normalized as VerificationFailure) : 'UNKNOWN'
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return ''
}

/** Confirmation polling schedule in ms. After it is exhausted the ceremony stays in flight and offers a manual check. */
export const CONFIRM_BACKOFF = [2500, 3500, 5000, 6000, 8000, 10000, 12000, 15000, 15000, 20000] as const

export class HandoffOrchestrator {
  private state: HandoffStage = { stage: 'choose', notice: null }
  private listeners = new Set<() => void>()
  private generation = 0

  constructor(
    private readonly deps: HandoffDeps,
    private readonly runId: string,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): HandoffStage => this.state

  /** Stops any confirmation loop from publishing after the ceremony unmounts. */
  dispose(): void {
    this.generation++
    this.listeners.clear()
  }

  private set(next: HandoffStage): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** Restores an intent the server already holds, e.g. after the app was closed mid-handoff. */
  async resume(intent: NetworkHandoffIntent): Promise<void> {
    if (intent.state === 'verified' && intent.txHash) {
      this.set({ stage: 'confirmed', intent, hash: intent.txHash, baton: null })
      return
    }
    const hash = intent.txHash ?? (await this.deps.readTransfer(intent.id))?.hash ?? null
    if (hash) {
      await this.confirmLoop(intent, hash)
      return
    }
    if (intent.state === 'prepared') {
      const record = await this.deps.readTransfer(intent.id)
      this.set(record?.state === 'attempting' ? { stage: 'recovery', intent, invalidHash: false } : { stage: 'armed', intent })
      return
    }
    if (intent.state === 'cancelled' || intent.state === 'expired') {
      this.set({ stage: 'choose', notice: null })
      return
    }
    this.set({ stage: 'recovery', intent, invalidHash: false })
  }

  /** Locks the next runner locally; nothing is sent to the server until the throw. */
  select(recipient: RunnerChoice): void {
    if (this.state.stage !== 'choose' && this.state.stage !== 'aiming') return
    this.set({ stage: 'aiming', recipient })
  }

  changeRunner(): void {
    if (this.state.stage !== 'aiming') return
    this.set({ stage: 'choose', notice: null })
  }

  /** The throw commits the launch parameters into an immutable intent, then opens Nimiq Pay. */
  async throwBaton(launch: LaunchParameters): Promise<void> {
    if (this.state.stage !== 'aiming') return
    const recipient = this.state.recipient
    this.set({ stage: 'preparing', recipient })
    let intent: NetworkHandoffIntent
    try {
      intent = await this.deps.prepare(this.runId, recipient.id, launch)
    } catch (error) {
      const notice = chooseNoticeForError(errorCode(error))
      this.set(notice ? { stage: 'choose', notice } : { stage: 'failed', message: errorCode(error) || 'prepare_failed' })
      return
    }
    if (intent.state !== 'prepared' || intent.txHash) {
      await this.resume(intent)
      return
    }
    this.set({ stage: 'armed', intent })
    await this.launch()
  }

  /** Opens Nimiq Pay for a locked intent: after a throw, or when retrying a paused or resumed pass. */
  async launch(): Promise<void> {
    const current = this.state
    if (current.stage !== 'armed' && current.stage !== 'paused' && current.stage !== 'insufficient') return
    const intent = current.intent
    const record = await this.deps.readTransfer(intent.id)
    if (record?.hash) {
      await this.confirmLoop(intent, record.hash)
      return
    }
    if (record?.state === 'attempting') {
      this.set({ stage: 'recovery', intent, invalidHash: false })
      return
    }

    await this.deps.saveTransfer({ id: intent.id, hash: null, state: 'attempting' })
    this.set({ stage: 'wallet', intent })
    try {
      await this.deps.attempt(intent.id)
    } catch (error) {
      await this.deps.saveTransfer({ id: intent.id, hash: null, state: 'ready' })
      const code = errorCode(error)
      this.set(code === 'handoff_expired' ? { stage: 'not-verified', intent, hash: '', reason: 'INTENT_EXPIRED' } : { stage: 'failed', message: code || 'attempt_failed' })
      return
    }

    let hash: string
    try {
      hash = (await this.deps.send(intent)).trim().toLowerCase()
    } catch (error) {
      const outcome = classifyWalletError(error)
      if (outcome === 'ambiguous') {
        this.set({ stage: 'recovery', intent, invalidHash: false })
        return
      }
      await this.deps.saveTransfer({ id: intent.id, hash: null, state: 'ready' })
      this.set(outcome === 'insufficient' ? { stage: 'insufficient', intent } : { stage: 'paused', intent })
      return
    }

    if (!TX_HASH.test(hash)) {
      this.set({ stage: 'recovery', intent, invalidHash: true })
      return
    }
    await this.deps.saveTransfer({ id: intent.id, hash, state: 'sent' })
    await this.confirmLoop(intent, hash)
  }

  /** A holder who already approved in Nimiq Pay can supply the transaction reference instead of paying twice. */
  async submitRecoveredHash(value: string): Promise<void> {
    if (this.state.stage !== 'recovery') return
    const intent = this.state.intent
    const hash = value.trim().toLowerCase()
    if (!TX_HASH.test(hash)) {
      this.set({ stage: 'recovery', intent, invalidHash: true })
      return
    }
    await this.deps.saveTransfer({ id: intent.id, hash, state: 'sent' })
    await this.confirmLoop(intent, hash)
  }

  async checkAgain(): Promise<void> {
    if (this.state.stage !== 'in-flight') return
    await this.confirmLoop(this.state.intent, this.state.hash)
  }

  /** Only an intent that never reached Nimiq Pay may be cancelled; the baton stays with the holder. */
  async cancelUnattempted(): Promise<void> {
    const current = this.state
    if (current.stage !== 'armed' && current.stage !== 'paused' && current.stage !== 'insufficient') return
    try {
      await this.deps.cancel(current.intent.id)
      this.set({ stage: 'choose', notice: null })
    } catch (error) {
      this.set({ stage: 'failed', message: errorCode(error) || 'cancel_failed' })
    }
  }

  private async confirmLoop(intent: NetworkHandoffIntent, hash: string): Promise<void> {
    const generation = ++this.generation
    this.set({ stage: 'in-flight', intent, hash, slow: false })
    for (let attempt = 0; attempt <= CONFIRM_BACKOFF.length; attempt++) {
      if (generation !== this.generation) return
      let confirmation: NetworkConfirmation | null = null
      try {
        confirmation = await this.deps.confirm(intent.id, hash)
      } catch (error) {
        const code = errorCode(error)
        if (code === 'transaction_already_used' || code === 'different_transaction') {
          this.set({ stage: 'not-verified', intent, hash, reason: 'DUPLICATE_TRANSACTION' })
          return
        }
        if (code === 'custody_changed') {
          this.set({ stage: 'not-verified', intent, hash, reason: 'CUSTODY_CHANGED' })
          return
        }
      }
      if (generation !== this.generation) return
      if (confirmation?.status === 'verified') {
        await this.deps.saveTransfer({ id: intent.id, hash, state: 'verified' })
        this.set({ stage: 'confirmed', intent: confirmation.intent ?? intent, hash, baton: confirmation.baton ?? null })
        return
      }
      if (confirmation?.status === 'rejected') {
        this.set({ stage: 'not-verified', intent, hash, reason: verificationFailure(confirmation.reason) })
        return
      }
      const delay = CONFIRM_BACKOFF[attempt]
      if (delay === undefined) break
      if (attempt >= 4) this.set({ stage: 'in-flight', intent, hash, slow: true })
      await this.deps.wait(delay)
    }
    if (generation === this.generation) this.set({ stage: 'in-flight', intent, hash, slow: true })
  }
}
