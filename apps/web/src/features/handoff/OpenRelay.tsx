import { lazy, Suspense, useRef, useState } from 'react'
import { trackShare } from '../relays/data'
import { playerMessage } from '../shell/errors'
import { copyText, shareLink } from '../shell/share'
import { showToast } from '../shell/toast'
import { Icon } from '../shell/ui/Icon'
import { HoloCard } from './holo'

// The QR encoder only loads once a holder asks for the code.
const InviteQr = lazy(() => import('./InviteQr').then(module => ({ default: module.InviteQr })))

type InviteLink = { status: 'idle' } | { status: 'creating' } | { status: 'ready'; url: string } | { status: 'failed'; message: string }

export interface InviteLinkControls {
  link: InviteLink
  /** The invite URL for this ceremony, created on first use and reused after that. */
  ensure(): Promise<string>
}

/**
 * One invite per handoff ceremony, created only when the holder asks for it: every invite counts toward the
 * holder's open invites and the network's invite numbers.
 */
export function useInviteLink(create: () => Promise<string>): InviteLinkControls {
  const [link, setLink] = useState<InviteLink>({ status: 'idle' })
  const pending = useRef<Promise<string> | null>(null)
  const ensure = (): Promise<string> => {
    if (!pending.current) {
      setLink({ status: 'creating' })
      pending.current = create().then(
        url => {
          setLink({ status: 'ready', url })
          return url
        },
        (error: unknown) => {
          pending.current = null
          setLink({ status: 'failed', message: playerMessage(error) ?? 'The invite link could not be created. Try again.' })
          throw error
        },
      )
    }
    return pending.current
  }
  return { link, ensure }
}

interface OpenRelayProps {
  batonName: string
  invite: InviteLinkControls
}

/** Anyone can take this pass: share the invite, or show its code to a runner standing next to you. */
export function OpenRelay({ batonName, invite }: OpenRelayProps) {
  const [showQr, setShowQr] = useState(false)
  const { link } = invite
  const url = link.status === 'ready' ? link.url : null

  const share = async () => {
    let inviteUrl: string
    try {
      inviteUrl = await invite.ensure()
    } catch {
      // The plate already says why the invite could not be created.
      return
    }
    try {
      await shareLink(`Carry ${batonName} next`, inviteUrl)
      trackShare('handoff')
    } catch (error) {
      // A share sheet the holder closed has no message.
      const message = playerMessage(error)
      if (message) showToast(message, 'error')
    }
  }

  const toggleQr = async () => {
    if (showQr) {
      setShowQr(false)
      return
    }
    setShowQr(true)
    try {
      await invite.ensure()
    } catch {
      // The plate already says why; fold the code away again.
      setShowQr(false)
    }
  }

  const copy = async () => {
    if (!url) return
    try {
      await copyText(url, 'Invite link copied.')
    } catch (error) {
      showToast(playerMessage(error) ?? 'The link could not be copied.', 'error')
    }
  }

  return (
    <HoloCard className="handoff-open" order={1} role="region" labelledBy="handoff-open-title">
      <div className="handoff-open__row">
        <div className="handoff-open__text">
          <h3 id="handoff-open-title" className="handoff-title handoff-title--plate">
            Open relay
          </h3>
          <p className="handoff-muted">Anyone with the invite can take the next leg.</p>
        </div>
        <button type="button" className="handoff-icon" aria-label="Share invite link" aria-busy={link.status === 'creating' || undefined} onClick={() => void share()}>
          <Icon name="share" size={20} />
          <span aria-hidden="true">Link</span>
        </button>
        <button type="button" className="handoff-icon" aria-label={showQr ? 'Hide QR code' : 'Show QR code'} aria-expanded={showQr} onClick={() => void toggleQr()}>
          <QrGlyph />
          <span aria-hidden="true">QR</span>
        </button>
      </div>
      {link.status === 'failed' && (
        <p className="handoff-notice" role="alert">
          {link.message}
        </p>
      )}
      {showQr && (
        <div className="handoff-open__code" ref={revealCode}>
          <div className="handoff-qr" data-ready={url ? 'true' : 'false'}>
            {url ? (
              <Suspense fallback={<span className="handoff-qr__loading" role="status">Drawing the code</span>}>
                <InviteQr url={url} />
              </Suspense>
            ) : (
              <span className="handoff-qr__loading" role="status">
                Creating the invite
              </span>
            )}
          </div>
          {url && (
            <button type="button" className="handoff-quiet handoff-quiet--inline" onClick={() => void copy()}>
              Copy link
            </button>
          )}
        </div>
      )}
    </HoloCard>
  )
}

/** The code opens below the fold of the projection area; bring it into view as it appears. */
function revealCode(node: HTMLDivElement | null): void {
  node?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

function QrGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
      <path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 18.5h1.5V20H14zM18.5 14H20v1.5h-1.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}
