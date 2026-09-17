import { Button } from '../shell/ui/Button'
import { useClaimFlow } from './claim-flow'
import { useGrants, useOpenGrant } from './data'

/**
 * The World home offer for a signed-in runner who can claim the Starter Baton, shown only when no handoff needs them.
 * While the grant confirms it turns into a quiet status line that reopens the claim.
 */
export function StarterBatonBanner() {
  const grants = useGrants(true)
  const openGrant = useOpenGrant()
  const running = useClaimFlow(state => state.running && state.grantId === 'starter')
  const starter = grants.data?.milestones.find(item => item.id === 'starter')
  const claimable = starter && (starter.state === 'available' || (starter.state === 'locked' && starter.blocked === 'no_device_signal'))
  const pending = starter?.state === 'pending' || running
  if (!grants.data?.enabled || (!claimable && !pending)) return null
  return (
    <div className="nr-banner nr-banner--grant" role="status" data-tour="starter-baton-banner">
      <div className="nr-banner__text">
        <p className="nr-banner__eyebrow">Relay Grants</p>
        <p className="nr-banner__title">{pending ? 'Confirming your Starter Baton' : 'Your first relay is on us'}</p>
      </div>
      <Button variant={pending ? 'secondary' : 'primary'} size="sm" onClick={() => openGrant('starter')}>
        {pending ? 'View' : 'Claim'}
      </Button>
    </div>
  )
}
