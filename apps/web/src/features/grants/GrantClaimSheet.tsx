import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { GrantMilestoneView } from '@nim-relay/shared'
import { isInsideNimiqPay, nimiqPayDeepLink } from '../../lib/nimiq'
import { BatonEmblem } from '../baton/BatonEmblem'
import { explorerUrl, formatNim, shortHash } from '../relays/format'
import { closeOverlay, navigate, pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { Button, ExternalButton } from '../shell/ui/Button'
import { BottomSheet } from '../shell/ui/overlays'
import { grantMessage, useClaimFlow, type ClaimPhase } from './claim-flow'
import { useGrants, useGrantSheet, useStartClaim } from './data'
import './grants.css'

/** Why a locked grant can't be claimed yet, in one line. */
export function lockedLine(milestone: GrantMilestoneView): string {
  if (milestone.blocked === null || milestone.blocked === 'requirement_not_met') return milestone.requirement
  if (milestone.blocked === 'no_device_signal') return 'Claiming asks Nimiq Pay for a private device signal first.'
  return grantMessage(milestone.blocked) ?? milestone.requirement
}

/**
 * The claim, from offer to reveal. While the baton flies in from Genesis Station the sheet steps aside for the globe
 * and leaves a caption; the reveal comes back up as its own sheet.
 */
export function GrantClaimSheet({ open }: { open: boolean }) {
  const { player } = useSession()
  const grants = useGrants(player !== null)
  const grantId = useGrantSheet(state => state.grantId)
  const flow = useClaimFlow()
  const reset = useClaimFlow(state => state.reset)
  const start = useStartClaim()
  const milestone = grants.data?.milestones.find(item => item.id === grantId) ?? null
  const phase = flow.grantId === grantId ? flow.phase : { kind: 'idle' as const }
  const starter = grantId === 'starter'
  const close = () => {
    reset()
    closeOverlay()
  }
  const title = phase.kind === 'revealed' ? (starter ? 'You received your first baton' : 'Grant received') : starter ? 'Starter Baton' : (milestone?.title ?? 'Relay Grant')

  return (
    <>
      <BottomSheet open={open && phase.kind !== 'arriving'} title={title} onClose={close}>
        <div className="nr-grant" data-tour="grant-claim" data-phase={phase.kind}>
          {phase.kind === 'idle' ? (
            <Offer milestone={milestone} starter={starter} loading={grants.isPending} onClaim={() => start(grantId)} />
          ) : (
            <Progress phase={phase} starter={starter} luna={milestone?.luna ?? null} network={grants.data?.network ?? null} onRetry={() => start(grantId)} onClose={close} onReset={reset} />
          )}
        </div>
      </BottomSheet>
      <AnimatePresence>{flow.phase.kind === 'arriving' && <FlightCaption key="flight" />}</AnimatePresence>
    </>
  )
}

function Offer({ milestone, starter, loading, onClaim }: { milestone: GrantMilestoneView | null; starter: boolean; loading: boolean; onClaim: () => void }) {
  const amount = milestone ? formatNim(milestone.luna) : null
  if (!isInsideNimiqPay()) {
    return (
      <>
        <p className="nr-sheet-lead">Your first relay is on us. Claiming needs the Nimiq Pay app.</p>
        <ExternalButton variant="primary" size="lg" block href={nimiqPayDeepLink(window.location.href)}>
          Open in Nimiq Pay
        </ExternalButton>
      </>
    )
  }
  return (
    <>
      <p className="nr-sheet-lead">{starter ? 'Your first relay is on us.' : milestone?.requirement}</p>
      {starter && (
        <ul className="nr-promise-list">
          <li>{amount ?? '1 NIM'} from the NIM Relay grant treasury goes to your wallet, enough to pass your first baton.</li>
          <li>You also get a baton to carry, starting at Genesis Station.</li>
          <li>One per wallet and one per device. A private device signal checks that; the raw identifier is never stored.</li>
          <li>Your own passes still need your approval in Nimiq Pay.</li>
        </ul>
      )}
      {milestone && milestone.state !== 'available' && milestone.state !== 'failed' && <p className="nr-grant__note">{milestone.state === 'locked' ? lockedLine(milestone) : milestone.state === 'confirmed' ? 'You already received this grant.' : 'This grant is on its way.'}</p>}
      <Button variant="primary" size="lg" block busy={loading} disabled={!milestone || (milestone.state !== 'available' && milestone.state !== 'failed' && milestone.blocked !== 'no_device_signal')} onClick={onClaim}>
        {starter ? 'Claim Starter Baton' : `Claim ${amount ?? 'grant'}`}
      </Button>
    </>
  )
}

function Progress({ phase, starter, luna, network, onRetry, onClose, onReset }: { phase: Exclude<ClaimPhase, { kind: 'idle' }>; starter: boolean; luna: number | null; network: 'TestAlbatross' | 'MainAlbatross' | null; onRetry: () => void; onClose: () => void; onReset: () => void }) {
  switch (phase.kind) {
    case 'device':
      return <Status busy title="Waiting for Nimiq Pay" body="Approve sharing the private device signal. Nothing is sent until the relay checks it." />
    case 'sending':
      return <Status busy title="Sending your grant" body="The relay is signing a transfer from the grant treasury." />
    case 'confirming':
      return (
        <>
          <Status busy title="Confirming on Nimiq" body={phase.confirmations ? `${phase.confirmations} of 2 confirmations.` : 'Waiting for the transfer to reach a block. This usually takes a few seconds.'} />
          <TransferLink network={network} txHash={phase.txHash} />
          <p className="nr-grant__note">You can close this. The relay keeps checking.</p>
        </>
      )
    case 'slow':
      return (
        <>
          <Status title="Still confirming on Nimiq" body="The transfer hasn’t confirmed yet. The relay keeps checking and your profile shows when it lands." />
          <TransferLink network={network} txHash={phase.txHash} />
          <Button variant="secondary" block onClick={onClose}>
            Close
          </Button>
        </>
      )
    case 'arriving':
      return null
    case 'revealed':
      return <Reveal phase={phase} starter={starter} luna={luna} network={network} onClose={onClose} onReset={onReset} />
    case 'failed':
      return (
        <>
          <p className="nr-form-error" role="alert">
            {phase.message}
          </p>
          <div className="nr-actions nr-actions--stack">
            {RETRYABLE.has(phase.code ?? '') && (
              <Button variant="primary" block onClick={onRetry}>
                Try again
              </Button>
            )}
            <Button variant="quiet" block onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )
  }
}

const RETRYABLE = new Set(['grant_transfer_failed', 'treasury_unavailable', 'wallet_balance_unknown', 'no_device_signal', 'request_failed', 'station_unavailable'])

function Status({ title, body, busy = false }: { title: string; body: string; busy?: boolean }) {
  return (
    <div className="nr-grant__status" role="status" aria-live="polite">
      {busy && <span className="nr-grant__pulse" aria-hidden="true" />}
      <div>
        <p className="nr-grant__status-title">{title}</p>
        <p className="nr-grant__status-body">{body}</p>
      </div>
    </div>
  )
}

function TransferLink({ network, txHash }: { network: 'TestAlbatross' | 'MainAlbatross' | null; txHash: string | null }) {
  if (!network || !txHash) return null
  return (
    <a className="nr-grant__tx" href={explorerUrl(network, txHash)} target="_blank" rel="noreferrer">
      Transfer {shortHash(txHash)}
    </a>
  )
}

function Reveal({ phase, starter, luna, network, onClose, onReset }: { phase: Extract<ClaimPhase, { kind: 'revealed' }>; starter: boolean; luna: number | null; network: 'TestAlbatross' | 'MainAlbatross' | null; onClose: () => void; onReset: () => void }) {
  const reduced = useReducedMotion()
  const code = phase.batonCode
  return (
    <>
      <motion.div className="nr-grant__reveal" initial={reduced ? false : { scale: 0.6, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', damping: 14, stiffness: 160 }}>
        <BatonEmblem size={96} label={phase.batonName ?? 'Starter Baton'} />
      </motion.div>
      <p className="nr-grant__reveal-name">{phase.batonName ?? 'Relay Grant'}</p>
      <p className="nr-sheet-lead nr-grant__reveal-lead">
        {starter ? `${luna ? formatNim(luna) : 'Your grant'} is in your wallet and the baton is yours to carry from Genesis Station.` : `${luna ? formatNim(luna) : 'Your grant'} is in your wallet.`}
      </p>
      <TransferLink network={network} txHash={phase.txHash} />
      <div className="nr-actions nr-actions--stack">
        {code && (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => {
              // Navigating from an open overlay replaces its history entry; closing it first would undo the navigation.
              onReset()
              navigate(pathFor('leg', { code }))
            }}
          >
            Carry it
          </Button>
        )}
        <Button variant="quiet" block onClick={onClose}>
          Later
        </Button>
      </div>
    </>
  )
}

function FlightCaption() {
  return (
    <motion.div className="nr-grant-flight" role="status" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <p className="nr-grant-flight__title">Leaving Genesis Station</p>
      <p className="nr-grant-flight__body">Your first baton is on its way.</p>
    </motion.div>
  )
}
