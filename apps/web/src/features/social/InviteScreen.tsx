import { useQuery } from '@tanstack/react-query'
import * as api from '../relays/api'
import { relayKeys, useNetwork, useNow, useRefreshNetwork } from '../relays/data'
import { formatNim, formatSince } from '../relays/format'
import { playerMessage } from '../shell/errors'
import { navigate, pathFor } from '../shell/router'
import { useRequireRunner, useSession } from '../shell/session'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { EmptyState, Loading } from '../shell/ui/primitives'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { Screen } from '../shell/ui/Screen'
import './social.css'

export function InviteScreen({ token, entryKey }: { token: string; entryKey: string }) {
  const invite = useQuery({
    queryKey: relayKeys.invite(token),
    queryFn: () => api.openNetworkInvite(token),
    retry: (count, error) => !(error instanceof api.NetworkApiError && error.status < 500) && count < 1,
  })
  const { snapshot } = useNetwork()
  const { player } = useSession()
  const requireRunner = useRequireRunner()
  const action = useAction()
  const refresh = useRefreshNetwork()
  const now = useNow()
  const data = invite.data
  const baton = data ? snapshot?.batons.find(item => item.id === data.batonId) : undefined

  const accept = () =>
    requireRunner('Sign in to accept this invitation and receive the baton.', () =>
      action.run(async () => {
        const detail = await api.claimNetworkInvite(token)
        refresh()
        navigate(pathFor('relay', { code: detail.baton.code }))
      }),
    )

  return (
    <Screen title="Invitation" entryKey={entryKey}>
      {data ? (
        <div className="nr-invite">
          <RunnerAvatar name={data.from.name} wallet={data.from.wallet} country={data.from.country} holder size={72} />
          <h2 className="nr-invite__headline">{data.from.name} wants you to carry the next leg</h2>
          <p className="nr-lede">
            {baton ? `${baton.displayName} is carrying ${formatNim(baton.value)}.` : 'A relay is waiting for its next runner.'} Accept to reserve the next pass. You’ll race {data.from.name}’s verified ghost, then pass the baton on.
          </p>
          <p className="nr-note">
            Sent {formatSince(data.createdAt, now)}. Invitations expire after 24 hours.
          </p>
          {data.claimedBy && data.claimedBy !== player?.id ? (
            <p className="nr-form-error">Another runner already accepted this invite.</p>
          ) : (
            <div className="nr-actions nr-actions--stack">
              <Button variant="primary" size="lg" block busy={action.pending} onClick={accept}>
                {data.claimedBy === player?.id ? 'Open the relay' : 'Accept invitation'}
              </Button>
              {baton && (
                <LinkButton variant="secondary" block to={pathFor('relay', { code: baton.code })}>
                  See the journey first
                </LinkButton>
              )}
            </div>
          )}
        </div>
      ) : invite.isPending ? (
        <Loading label="Opening the invitation" />
      ) : (
        <EmptyState title={errorTitle(invite.error)} body={playerMessage(invite.error) ?? ''}>
          <LinkButton variant="secondary" to="/">
            Explore live relays
          </LinkButton>
        </EmptyState>
      )}
    </Screen>
  )
}

function errorTitle(error: unknown): string {
  if (error instanceof api.NetworkApiError && error.code === 'invite_expired') return 'This invitation expired'
  if (error instanceof api.NetworkApiError && error.code === 'invite_not_found') return 'Invitation not found'
  return 'The invitation didn’t open'
}
