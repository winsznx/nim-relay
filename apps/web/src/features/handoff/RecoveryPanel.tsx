import { useState } from 'react'

interface RecoveryPanelProps {
  titleId: string
  invalidHash: boolean
  recipientName: string
  onSubmit(hash: string): void
  onNothingSent(): void
  onLeave(): void
}

/** Nimiq Pay gave no clear answer: the holder recovers the transfer from wallet activity instead of paying twice. */
export function RecoveryPanel({ titleId, invalidHash, recipientName, onSubmit, onNothingSent, onLeave }: RecoveryPanelProps) {
  const [hash, setHash] = useState('')
  const [confirmingNothingSent, setConfirmingNothingSent] = useState(false)
  return (
    <form
      className="handoff-recovery"
      onSubmit={event => {
        event.preventDefault()
        onSubmit(hash)
      }}
    >
      <h2 id={titleId} className="handoff-title handoff-title--plate">
        Check your wallet
      </h2>
      <p className="handoff-body">Nimiq Pay didn’t tell us whether the pass was sent. Don’t send it again yet. Open your wallet activity and paste the transaction reference.</p>
      <label className="handoff-label">
        Transaction reference
        <input className="handoff-input" value={hash} onChange={event => setHash(event.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" />
      </label>
      {invalidHash && <p className="handoff-notice">That doesn’t look like a Nimiq transaction reference.</p>}
      <button type="submit" className="handoff-primary" disabled={!hash.trim()}>
        Verify the pass
      </button>
      {confirmingNothingSent ? (
        <div className="handoff-confirm" role="group" aria-label="Confirm nothing was sent">
          <p className="handoff-body">Only continue if your Nimiq Pay activity shows no transfer to {recipientName}. Approving again sends a new transfer.</p>
          <button type="button" className="handoff-secondary" onClick={onNothingSent}>
            Nothing was sent, approve again
          </button>
          <button type="button" className="handoff-quiet" onClick={() => setConfirmingNothingSent(false)}>
            Keep checking
          </button>
        </div>
      ) : (
        <button type="button" className="handoff-quiet" onClick={() => setConfirmingNothingSent(true)}>
          My wallet shows no transfer
        </button>
      )}
      <button type="button" className="handoff-quiet" onClick={onLeave}>
        Leave for now, the baton stays with you
      </button>
    </form>
  )
}
