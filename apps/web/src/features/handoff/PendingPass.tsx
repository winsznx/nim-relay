import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
import type { NetworkHandoffIntent } from '@nim-relay/shared'
import { failureCopy, formatNim, shortAddress, verificationCopy } from './copy'
import { handoffDeps } from './deps'
import { HandoffOrchestrator, type HandoffStage } from './machine'
import { RelayNoteQuote } from './RelayNoteQuote'
import './handoff.css'

interface PendingPassProps {
  intent: NetworkHandoffIntent
  /** A verified pass: the baton has moved. */
  onConfirmed(stage: Extract<HandoffStage, { stage: 'confirmed' }>): void
  /** The pass was cancelled before it reached Nimiq Pay. */
  onCancelled(): void
}

/**
 * A pass that was locked but not finished, e.g. after leaving the handoff zone or closing the app
 * during approval. It resumes the same locked intent through the same ceremony rules.
 */
export function PendingPass({ intent, onConfirmed, onCancelled }: PendingPassProps) {
  // The intent is locked on the server; later snapshot copies of it must not restart the ceremony. Key this component by intent id.
  const [lockedIntent] = useState(intent)
  const [machine] = useState(() => new HandoffOrchestrator(handoffDeps, lockedIntent.runId))
  const stage = useSyncExternalStore(machine.subscribe, machine.getSnapshot)
  const [hash, setHash] = useState('')
  const [confirmingNothingSent, setConfirmingNothingSent] = useState(false)

  useEffect(() => {
    void machine.resume(lockedIntent)
    return () => machine.dispose()
  }, [machine, lockedIntent])

  // Parents re-render on every network refresh; only a stage transition may notify them.
  const notify = useEffectEvent((next: HandoffStage) => {
    if (next.stage === 'confirmed') onConfirmed(next)
    if (next.stage === 'choose') onCancelled()
  })
  useEffect(() => {
    notify(stage)
  }, [stage])

  const title = `Finish your pass to ${intent.recipientName}`
  const amount = formatNim(intent.value)

  return (
    <section className="nr-panel nr-panel--gold handoff-pending" aria-labelledby={`pending-${intent.id}`} aria-live="polite">
      <h3 id={`pending-${intent.id}`}>{title}</h3>
      {intent.note && <RelayNoteQuote text={intent.note.text} visibility={intent.note.visibility} />}
      {(() => {
        switch (stage.stage) {
          case 'armed':
            return (
              <>
                <p>
                  {amount} on leg {intent.leg}. The runner and amount are locked, so approving can’t send it anywhere else.
                </p>
                <div className="nr-actions">
                  <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                    Approve in Nimiq Pay
                  </button>
                  <button type="button" className="handoff-quiet" onClick={() => void machine.cancelUnattempted()}>
                    Choose a different runner
                  </button>
                </div>
              </>
            )
          case 'wallet':
            return <p className="handoff-status">Approve the pass in Nimiq Pay</p>
          case 'paused':
            return (
              <>
                <p>Pass paused. The baton is still with you.</p>
                <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                  Approve again
                </button>
              </>
            )
          case 'insufficient':
            return (
              <>
                <p>
                  This relay requires {amount} in {shortAddress(stage.intent.sender)}, the account that holds the baton. Move NIM into it in Nimiq Pay, keep it selected, then approve again. The baton is still with you.
                </p>
                <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                  Approve again
                </button>
              </>
            )
          case 'wrong-account':
            return (
              <>
                <p>
                  Nimiq Pay is set to {shortAddress(stage.active)}, but this baton belongs to {shortAddress(stage.intent.sender)}. Switch to that account in Nimiq Pay, then try again.
                </p>
                <button type="button" className="handoff-primary" onClick={() => void machine.launch()}>
                  I’ve switched, try again
                </button>
                <button type="button" className="handoff-quiet" onClick={() => void machine.launch({ skipAccountCheck: true })}>
                  Open Nimiq Pay anyway
                </button>
              </>
            )
          case 'checking':
            return <p className="handoff-status">Checking the Nimiq network for this pass…</p>
          case 'recovery':
            return (
              <form
                className="handoff-recovery"
                onSubmit={event => {
                  event.preventDefault()
                  void machine.submitRecoveredHash(hash)
                }}
              >
                <p>An earlier approval may already be on the network. Find the transfer in your Nimiq Pay activity and paste its reference.</p>
                <p className="handoff-muted">If you declined in Nimiq Pay, choose ‘My wallet shows no transfer’ to approve again, or wait for this pass to expire to choose another runner.</p>
                <label className="nr-field">
                  <span className="nr-field__label">Transaction reference</span>
                  <input className="nr-input" value={hash} onChange={event => setHash(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                </label>
                {stage.invalidHash && <p className="nr-form-error">That doesn’t look like a Nimiq transaction reference.</p>}
                <button type="submit" className="handoff-primary" disabled={!hash.trim()}>
                  Verify the pass
                </button>
                {confirmingNothingSent ? (
                  <div className="handoff-confirm" role="group" aria-label="Confirm nothing was sent">
                    <p>Only continue if your Nimiq Pay activity shows no transfer to {intent.recipientName}. Approving again sends a new transfer.</p>
                    <button type="button" className="handoff-secondary" onClick={() => void machine.confirmNothingSent()}>
                      Nothing was sent, approve again
                    </button>
                  </div>
                ) : (
                  <button type="button" className="handoff-quiet" onClick={() => setConfirmingNothingSent(true)}>
                    My wallet shows no transfer
                  </button>
                )}
              </form>
            )
          case 'in-flight':
            return (
              <>
                <p className="handoff-status">
                  {stage.slow ? 'Confirmation is taking longer than usual. The relay keeps checking and confirms it automatically.' : 'Handoff in flight. Waiting for the network to confirm.'}
                </p>
                {stage.slow && (
                  <button type="button" className="handoff-secondary" onClick={() => void machine.checkAgain()}>
                    Check again
                  </button>
                )}
              </>
            )
          case 'not-verified':
            return (
              <>
                <p>Handoff not verified. {verificationCopy(stage.reason)}</p>
                {stage.resendable ? (
                  <>
                    <p className="handoff-muted">Send it again from {shortAddress(stage.intent.sender)}, the account that holds the baton.</p>
                    <button type="button" className="handoff-primary" onClick={() => void machine.sendAgain()}>
                      Send again
                    </button>
                  </>
                ) : (
                  <p className="handoff-muted">The baton stays with you until a matching transfer is verified.</p>
                )}
              </>
            )
          case 'failed':
            return <p>{failureCopy(stage.message)}</p>
          case 'confirmed':
            return <p className="handoff-status">Handoff confirmed.</p>
          default:
            return <p className="handoff-status">Checking your pass…</p>
        }
      })()}
    </section>
  )
}
