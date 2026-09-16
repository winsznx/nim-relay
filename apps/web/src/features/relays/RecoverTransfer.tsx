import { useEffect, useState } from 'react'
import type { NetworkHandoffIntent } from '@nim-relay/shared'
import { NimiqPayError, sendRelayHandoff } from '../../lib/nimiq'
import { readTransfer, saveTransfer } from '../../station/transfer-store'
import { confirmationMessage, playerMessage } from '../shell/errors'
import { Button } from '../shell/ui/Button'
import * as api from './api'
import { formatNim } from './format'

const HASH_PATTERN = /^[a-f0-9]{64}$/i

/**
 * Finishes a pass that was prepared but never confirmed, for example after the
 * app closed during wallet approval. The recipient and amount stay locked; an
 * ambiguous earlier request is recovered by reference, never resent blindly.
 */
export function RecoverTransfer({ intent, onDone }: { intent: NetworkHandoffIntent; onDone(): void }) {
  const [hash, setHash] = useState(intent.txHash ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    readTransfer(intent.id)
      .then(record => {
        if (active && record?.hash) setHash(record.hash)
      })
      .catch((error: unknown) => {
        if (active) setMessage(playerMessage(error) ?? '')
      })
    return () => {
      active = false
    }
  }, [intent.id])

  async function recover(): Promise<void> {
    setBusy(true)
    setMessage('')
    try {
      let transaction = hash.trim()
      if (transaction && !HASH_PATTERN.test(transaction)) throw new Error('A transaction reference is 64 letters and digits. Copy it from your wallet activity.')
      if (!transaction) {
        const saved = await readTransfer(intent.id)
        if (intent.state !== 'prepared' && saved?.state !== 'ready') {
          throw new Error('An earlier approval may already be on the network. Find the transfer in your Nimiq Pay activity and paste its reference here.')
        }
        await saveTransfer({ id: intent.id, hash: null, state: 'attempting' })
        await api.attemptNetworkHandoff(intent.id)
        transaction = await sendRelayHandoff(intent)
        setHash(transaction)
        await saveTransfer({ id: intent.id, hash: transaction, state: 'sent' })
      }
      const result = await api.confirmNetworkHandoff(intent.id, transaction)
      if (result.status === 'verified') {
        await saveTransfer({ id: intent.id, hash: transaction, state: 'verified' })
        onDone()
      } else setMessage(confirmationMessage(result.reason, result.status))
    } catch (error) {
      if (error instanceof NimiqPayError && error.approvalDeclined) await saveTransfer({ id: intent.id, hash: null, state: 'ready' })
      setMessage(playerMessage(error) ?? '')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    setBusy(true)
    try {
      await api.cancelNetworkHandoff(intent.id)
      onDone()
    } catch (error) {
      setMessage(playerMessage(error) ?? '')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="nr-panel nr-panel--gold" aria-labelledby={`recover-${intent.id}`}>
      <h3 id={`recover-${intent.id}`}>Finish your pass to {intent.recipientName}</h3>
      <p>
        {formatNim(intent.value)} on leg {intent.leg}. The runner and amount are locked, so approving again can’t send it anywhere else.
      </p>
      <label className="nr-field nr-field--spaced">
        <span className="nr-field__label">Transaction reference</span>
        <input className="nr-input" placeholder="Only if you already approved it" value={hash} onChange={event => setHash(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      {message && (
        <p className="nr-form-error" role="status">
          {message}
        </p>
      )}
      <div className="nr-actions">
        <Button variant="primary" busy={busy} onClick={() => void recover()}>
          {hash ? 'Check confirmation' : intent.state === 'prepared' ? 'Approve in Nimiq Pay' : 'Recover transfer'}
        </Button>
        {intent.state === 'prepared' && (
          <Button variant="secondary" disabled={busy} onClick={() => void cancel()}>
            Cancel this pass
          </Button>
        )}
      </div>
    </section>
  )
}
