import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isInsideNimiqPay, nimiqPayDeepLink } from '../../lib/nimiq'
import { playerMessage } from './errors'
import { closeOverlay, linkProps } from './router'
import { continueAfterSignIn, signIn, useRunnerGate } from './session'
import { Button, ExternalButton } from './ui/Button'
import { BottomSheet } from './ui/overlays'

/** The single sign-in ceremony, opened only when an action needs a runner identity. */
export function SignInSheet({ open }: { open: boolean }) {
  const client = useQueryClient()
  const reason = useRunnerGate(state => state.reason)
  const clear = useRunnerGate(state => state.clear)
  const [fairPlay, setFairPlay] = useState(false)
  const ceremony = useMutation({
    mutationFn: () => signIn(client, { fairPlay }),
    onSuccess: () => continueAfterSignIn(),
  })
  const inside = isInsideNimiqPay()
  const close = () => {
    clear()
    ceremony.reset()
    closeOverlay()
  }
  const failure = ceremony.isError ? playerMessage(ceremony.error) : null
  return (
    <BottomSheet open={open} title="Set up your runner" onClose={close}>
      <p className="nr-sheet-lead">{reason ?? 'Sign in once to receive batons, race for real and pass them on.'}</p>
      <ul className="nr-promise-list">
        <li>Your wallet and keys stay in Nimiq Pay.</li>
        <li>You approve every pass yourself. Nothing moves without you.</li>
        <li>No exact location. Sharing your country is optional and off by default.</li>
      </ul>
      {inside ? (
        <>
          <label className="nr-check">
            <input type="checkbox" checked={fairPlay} onChange={event => setFairPlay(event.target.checked)} />
            <span>Use a private device signal for fair play on the Daily. The raw identifier is never stored.</span>
          </label>
          {failure && (
            <p className="nr-form-error" role="alert">
              {failure}
            </p>
          )}
          <Button variant="primary" size="lg" block busy={ceremony.isPending} onClick={() => ceremony.mutate()}>
            {ceremony.isPending ? 'Waiting for Nimiq Pay' : 'Sign in with Nimiq Pay'}
          </Button>
        </>
      ) : (
        <>
          <p className="nr-sheet-note">Signing in needs the Nimiq Pay app. Watching relays works in any browser.</p>
          <ExternalButton variant="primary" size="lg" block href={nimiqPayDeepLink(window.location.href)}>
            Open in Nimiq Pay
          </ExternalButton>
        </>
      )}
      <div className="nr-sheet-footer">
        <Button variant="quiet" onClick={close}>
          Not now
        </Button>
        <a className="nr-sheet-link" {...linkProps('/privacy')}>
          How your data is used
        </a>
      </div>
    </BottomSheet>
  )
}
