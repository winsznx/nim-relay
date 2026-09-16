import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { describeLeg, LegUnavailable, prepareLeg, type Leg } from '../leg/prepare'
import { LegRun } from '../leg/LegRun'
import { useNetwork, useRefreshNetwork } from '../relays/data'
import { playerMessage } from './errors'
import { goBack, navigate, pathFor } from './router'
import { useRequireRunner, useSession } from './session'
import { Button } from './ui/Button'
import './leg-host.css'

export { describeLeg } from '../leg/prepare'

/** Hosts one relay leg: a practice ride, the Daily, a verified replay, or a real baton leg that ends in a handoff. */

function fallbackFor(leg: Leg | null, relayCode: string | null): string {
  if (leg?.kind === 'baton') return pathFor('relay', { code: leg.code })
  if (relayCode) return pathFor('relay', { code: relayCode })
  if (leg?.kind === 'daily') return pathFor('daily')
  return '/'
}

function FullscreenMessage({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="nr-leg-message">
      <div className="nr-leg-message__card" role="alert">
        <h1>{title}</h1>
        <p>{body}</p>
        <div className="nr-actions nr-actions--stack">{children}</div>
      </div>
    </main>
  )
}

export function LegHost({ code, search }: { code: string; search: string }) {
  const params = new URLSearchParams(search)
  const leg = describeLeg(code, params)
  const relayCode = params.get('relay')
  const back = fallbackFor(leg, relayCode)
  const { player, checking } = useSession()
  const { snapshot, failed } = useNetwork()
  const refresh = useRefreshNetwork()
  const requireRunner = useRequireRunner()
  const [attempt, setAttempt] = useState(0)
  const needsRunner = leg?.kind === 'baton' || (leg?.kind === 'daily' && !leg.practice)
  const daily = snapshot?.daily

  const session = useQuery({
    queryKey: ['leg', code, search, player?.id ?? null, attempt],
    queryFn: () => (leg ? prepareLeg(leg, player !== null, daily) : Promise.reject(new LegUnavailable('This leg link is incomplete.'))),
    // Signed-out Daily practice needs today's course from the network; a failed load falls back to a practice course.
    enabled: !checking && (!needsRunner || player !== null) && (leg?.kind !== 'daily' || player !== null || daily !== undefined || failed),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  if (!leg) {
    return (
      <FullscreenMessage title="This leg link is incomplete" body="It’s missing the ride to open. Pick a relay or practice from the world instead.">
        <Button variant="primary" block onClick={() => navigate('/', { replace: true })}>
          Go to the world
        </Button>
      </FullscreenMessage>
    )
  }
  if (needsRunner && !player && !checking) {
    return (
      <FullscreenMessage title={leg.kind === 'baton' ? 'Sign in to carry this leg' : 'Sign in for the official Daily'} body="Real legs and official rides are tied to your runner, so the result can count and the baton can move.">
        <Button variant="primary" block onClick={() => requireRunner('Sign in to ride this leg.', () => setAttempt(value => value + 1))}>
          Set up my runner
        </Button>
        <Button variant="secondary" block onClick={() => navigate('/leg/practice', { replace: true })}>
          Practice instead
        </Button>
      </FullscreenMessage>
    )
  }
  if (session.isError) {
    const message = session.error instanceof LegUnavailable ? session.error.message : (playerMessage(session.error) ?? 'Try again in a moment.')
    return (
      <FullscreenMessage title="This leg can’t start" body={message}>
        <Button variant="primary" block onClick={() => setAttempt(value => value + 1)}>
          Try again
        </Button>
        <Button variant="secondary" block onClick={() => goBack(back)}>
          Back
        </Button>
      </FullscreenMessage>
    )
  }
  if (!session.data) {
    return (
      <main className="nr-leg-message" aria-busy="true">
        <p className="nr-leg-message__loading" role="status">
          {leg.kind === 'watch' ? 'Loading the verified ride' : 'Preparing your leg'}
        </p>
      </main>
    )
  }

  return (
    <LegRun
      key={`${attempt}-${session.data.issued?.runId ?? 'local'}`}
      setup={session.data}
      snapshot={snapshot}
      playerId={player?.id ?? null}
      onRefresh={refresh}
      onReissue={() => setAttempt(value => value + 1)}
      onExit={() => {
        refresh()
        goBack(back)
      }}
    />
  )
}
