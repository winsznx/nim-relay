import type { GrantMilestoneView } from '@nim-relay/shared'
import { explorerUrl, formatNim, shortHash } from '../relays/format'
import { pathFor } from '../shell/router'
import { Button, LinkButton } from '../shell/ui/Button'
import { Pill, SectionHeader } from '../shell/ui/primitives'
import { lockedLine } from './GrantClaimSheet'
import { useGrants, useOpenGrant } from './data'
import './grants.css'

/** Profile section: every Relay Grant milestone with what it takes, and NIM claimed against the per-runner cap. */
export function RelayGrantsPanel() {
  const grants = useGrants(true)
  const openGrant = useOpenGrant()
  const view = grants.data
  if (!view) {
    if (!grants.isError) return null
    return (
      <section className="nr-section" aria-labelledby="relay-grants">
        <SectionHeader id="relay-grants" title="Relay Grants" />
        <p className="nr-note">Your grants didn’t load. Your wallet is unchanged.</p>
      </section>
    )
  }
  return (
    <section className="nr-section nr-grants" aria-labelledby="relay-grants" data-tour="relay-grants">
      <SectionHeader id="relay-grants" title="Relay Grants" detail={`${formatNim(view.claimedLuna).replace(' NIM', '')} / ${formatNim(view.capLuna)} claimed`} />
      {!view.enabled && <p className="nr-note">Relay Grants are switched off on this network right now.</p>}
      {view.enabled && view.paused && <p className="nr-note">Relay Grants are paused for a moment. Claims open again soon.</p>}
      <ol className="nr-grants__list">
        {view.milestones.map(milestone => (
          <li key={milestone.id} className={`nr-grants__item nr-grants__item--${milestone.state}`}>
            <div className="nr-grants__text">
              <p className="nr-grants__title">
                {milestone.title} <span className="nr-grants__amount">{formatNim(milestone.luna)}</span>
              </p>
              <p className="nr-grants__line">{line(milestone)}</p>
              {milestone.txHash && milestone.state !== 'locked' && (
                <a className="nr-grants__tx" href={explorerUrl(view.network, milestone.txHash)} target="_blank" rel="noreferrer">
                  {shortHash(milestone.txHash)}
                </a>
              )}
            </div>
            <Action milestone={milestone} enabled={view.enabled && !view.paused} onClaim={() => openGrant(milestone.id)} />
          </li>
        ))}
      </ol>
      <p className="nr-note">Grants come from a small NIM Relay treasury, up to {formatNim(view.capLuna)} per runner and device. Big leg milestones earn artifacts, not NIM.</p>
    </section>
  )
}

function line(milestone: GrantMilestoneView): string {
  switch (milestone.state) {
    case 'confirmed':
      return 'Received.'
    case 'pending':
      return milestone.phase === 'confirming' ? 'Confirming on Nimiq.' : 'Sending.'
    case 'failed':
      return 'The transfer didn’t land. Your claim was released.'
    case 'available':
      return milestone.requirement
    case 'locked':
      return lockedLine(milestone)
  }
}

function Action({ milestone, enabled, onClaim }: { milestone: GrantMilestoneView; enabled: boolean; onClaim: () => void }) {
  if (milestone.state === 'confirmed') {
    return milestone.batonCode ? (
      <LinkButton variant="quiet" size="sm" to={pathFor('relay', { code: milestone.batonCode })}>
        Baton
      </LinkButton>
    ) : (
      <Pill tone="verified">Received</Pill>
    )
  }
  if (milestone.state === 'pending') return <Pill tone="live">Confirming</Pill>
  const claimable = milestone.state === 'available' || milestone.state === 'failed' || milestone.blocked === 'no_device_signal'
  if (!claimable || !enabled) return <Pill>Locked</Pill>
  return (
    <Button variant="primary" size="sm" onClick={onClaim}>
      {milestone.state === 'failed' ? 'Try again' : 'Claim'}
    </Button>
  )
}
