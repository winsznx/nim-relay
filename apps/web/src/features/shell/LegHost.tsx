import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isStationRaceGhost, type IssuedRace, type NetworkDaily } from '@nim-relay/shared'
import { StationController } from '../../station/controller'
import { RaceView, type RaceSession } from '../../station/RaceView'
import { RelayAudio } from '../../station/audio'
import * as api from '../relays/api'
import { useNetwork, useRefreshNetwork, useStationProfile } from '../relays/data'
import { practicePath } from '../relays/JourneyRoute'
import { playArrival } from '../world/globe-bridge'
import { playerMessage } from './errors'
import { goBack, navigate, pathFor } from './router'
import { useRequireRunner, useSession } from './session'
import { soundEnabled } from './sound'
import { Button } from './ui/Button'
import '../../station/station.css'
import './leg-host.css'

/**
 * Hosts one relay leg: a practice ride, the Daily, a verified replay, or a real
 * baton leg that ends in a handoff. It runs the v4 station race; swapping in the
 * next race only touches this component.
 */

type Leg =
  | { kind: 'baton'; code: string }
  | { kind: 'practice'; ghostRunId: string | null }
  | { kind: 'daily'; practice: boolean }
  | { kind: 'watch'; runId: string }

export function describeLeg(code: string, params: URLSearchParams): Leg | null {
  if (code === 'practice') return { kind: 'practice', ghostRunId: params.get('ghost') }
  if (code === 'daily') return { kind: 'daily', practice: params.get('practice') === '1' }
  if (code === 'watch') {
    const runId = params.get('run')
    return runId ? { kind: 'watch', runId } : null
  }
  return /^[A-Za-z0-9-]{1,64}$/.test(code) ? { kind: 'baton', code } : null
}

class LegUnavailable extends Error {}

async function prepareLeg(leg: Leg, signedIn: boolean, daily: NetworkDaily | undefined): Promise<RaceSession> {
  const replayId = leg.kind === 'watch' ? leg.runId : leg.kind === 'practice' ? leg.ghostRunId : null
  let ghost = replayId ? await api.loadVerifiedReplay(replayId) : null
  let issued: IssuedRace | null = null
  if (signedIn && leg.kind !== 'watch') {
    issued = await api.issueNetworkRace(
      leg.kind === 'baton' ? { batonId: leg.code } : leg.kind === 'daily' ? { daily: true, ...(leg.practice ? { practice: true } : {}) } : { practice: true, ...(leg.ghostRunId ? { ghostRunId: leg.ghostRunId } : {}) },
    )
  }
  const isDaily = leg.kind === 'daily'
  const config = issued?.config ??
    ghost?.config ?? {
      engineVersion: '4' as const,
      challenge: 'station-race' as const,
      challengeVersion: '4' as const,
      seed: isDaily ? (daily?.seed ?? `daily-${new Date().toISOString().slice(0, 10)}-v4`) : crypto.randomUUID(),
      world: isDaily ? (daily?.world ?? 'coast') : 'coast',
    }
  ghost = issued?.ghost ?? ghost
  if (config.engineVersion !== '4' || (ghost && !isStationRaceGhost(ghost))) {
    throw new LegUnavailable('This leg runs on the new relay race, which this version of the app can’t play yet. Update NIM Relay and try again.')
  }
  const opponent = ghost && isStationRaceGhost(ghost) ? ghost : null
  const watching = leg.kind === 'watch'
  const controller = new StationController(config, !watching && opponent ? { trace: opponent.inputTrace, name: opponent.name } : undefined, watching && opponent ? { playbackTrace: opponent.inputTrace } : undefined)
  return { controller, issued }
}

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
  const profile = useStationProfile()
  const refresh = useRefreshNetwork()
  const requireRunner = useRequireRunner()
  const [audio] = useState(() => {
    const created = new RelayAudio()
    created.enabled = soundEnabled()
    return created
  })
  useEffect(() => () => audio.dispose(), [audio])
  const [attempt, setAttempt] = useState(0)
  const needsRunner = leg?.kind === 'baton' || (leg?.kind === 'daily' && !leg.practice)
  const daily = snapshot?.daily

  const session = useQuery({
    queryKey: ['leg', code, search, player?.id ?? null, attempt],
    queryFn: () => (leg ? prepareLeg(leg, player !== null, daily) : Promise.reject(new LegUnavailable('This leg link is incomplete.'))),
    // The Daily needs today's seed and world from the network; a failed load falls back to the dated seed.
    enabled: !checking && (!needsRunner || player !== null) && (leg?.kind !== 'daily' || daily !== undefined || failed),
    staleTime: Infinity,
    gcTime: 0,
    // The session holds a live race controller, which must never be merged with an earlier copy.
    structuralSharing: false,
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

  const race = session.data
  const couriers = (snapshot?.runners ?? []).filter(runner => runner.id !== player?.id).map(runner => ({ id: runner.id, name: runner.name, score: 0, xp: 0 }))
  return (
    <RaceView
      session={race}
      audio={audio}
      profile={profile.data?.profile}
      couriers={couriers}
      network={snapshot?.network ?? 'TestAlbatross'}
      onSubmit={api.submitNetworkRace}
      onPrepare={api.prepareNetworkHandoff}
      onAttempt={intent => api.attemptNetworkHandoff(intent.id)}
      onCancel={intent => api.cancelNetworkHandoff(intent.id)}
      onConfirm={api.confirmNetworkHandoff}
      onTransfer={intent => {
        const batonId = race.issued?.batonId
        const baton = snapshot?.batons.find(item => item.id === batonId)
        if (baton) {
          const recipient = snapshot?.runners.find(runner => runner.id === intent.recipientId)
          playArrival(intent.id, { relayId: baton.id, fromCountry: baton.holder.country, toCountry: recipient?.country ?? null })
        }
        refresh()
      }}
      onReplay={() => {
        const ghostRunId = leg.kind === 'watch' ? leg.runId : (race.issued?.ghost?.runId ?? (leg.kind === 'practice' ? leg.ghostRunId : null))
        if (ghostRunId && !(leg.kind === 'practice' && leg.ghostRunId === ghostRunId)) navigate(practicePath(ghostRunId, relayCode ?? (leg.kind === 'baton' ? leg.code : null)), { replace: true })
        else setAttempt(value => value + 1)
      }}
      onExit={() => {
        refresh()
        goBack(back)
      }}
    />
  )
}
