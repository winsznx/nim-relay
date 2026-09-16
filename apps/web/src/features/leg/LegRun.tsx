import { useCallback, useEffect, useMemo, useState } from 'react'
import type { relayLeg } from '@nim-relay/game-engine'
import type { NetworkSnapshot, SubmittedRace } from '@nim-relay/shared'
import { getAudioDirector } from '../audio/director'
import { HandoffCeremony } from '../handoff/HandoffCeremony'
import type { CeremonySceneState } from '../handoff/copy'
import { handoffDeps } from '../handoff/deps'
import { HandoffOrchestrator, type HandoffStage } from '../handoff/machine'
import { RaceScreen, type CeremonyState, type RaceCue } from '../race/RaceScreen'
import * as api from '../relays/api'
import { trackShare } from '../relays/data'
import { playArrival } from '../world/globe-bridge'
import { playerMessage } from '../shell/errors'
import { navigate, pathFor } from '../shell/router'
import { shareLink } from '../shell/share'
import { showToast } from '../shell/toast'
import { useDeparture } from './departure'
import type { LegSetup } from './prepare'
import { runnerGroups } from './runner-groups'
import './leg.css'

declare global {
  interface Window {
    /** Set by the lifecycle E2E before the app loads. Production builds never read it. */
    __NIM_RELAY_E2E_AUTOPILOT__?: boolean
  }
}

/**
 * Development builds only: lets the browser E2E finish real legs headlessly with the deterministic lookahead bot.
 * The import is dynamic so production chunks never contain the bot.
 */
const e2eAutopilot = import.meta.env.DEV && window.__NIM_RELAY_E2E_AUTOPILOT__ === true ? (await import('../race/dev/bot')).createBot({ fork: 'risk', bias: 8 }) : null

interface LegRunProps {
  setup: LegSetup
  snapshot: NetworkSnapshot | undefined
  playerId: string | null
  onExit(): void
  /** Ask the server for a fresh leg, e.g. after the issued ride expired. */
  onReissue(): void
  onRefresh(): void
}

type Verification =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'verified'; receipt: SubmittedRace }
  | { status: 'failed'; message: string; expired: boolean }

function beatGhost(result: relayLeg.Result, ghostTimeMs: number | null): boolean {
  return ghostTimeMs === null ? result.completed : result.completed && result.timeMs < ghostTimeMs
}

/** One playable leg in the product: the race, the server's verdict on the run, and for real batons the handoff. */
export function LegRun({ setup, snapshot, playerId, onExit, onReissue, onRefresh }: LegRunProps) {
  const [verification, setVerification] = useState<Verification>({ status: 'idle' })
  const [lastTrace, setLastTrace] = useState<relayLeg.InputTrace | null>(null)
  const [ceremonyState, setCeremonyState] = useState<CeremonyState>('none')
  const showDeparture = useDeparture(state => state.show)
  const director = getAudioDirector()
  const baton = setup.baton

  useEffect(() => {
    director.scene('race')
    director.startRace({ world: setup.config.world })
    return () => director.scene('world')
  }, [director, setup.config.world])

  const receipt = verification.status === 'verified' ? verification.receipt : null
  const machine = useMemo(() => (receipt?.qualifiedHandoff && setup.mode === 'relay' ? new HandoffOrchestrator(handoffDeps, receipt.runId) : null), [receipt, setup.mode])
  useEffect(() => () => machine?.dispose(), [machine])

  const submit = useCallback(
    async (trace: relayLeg.InputTrace) => {
      if (!setup.issued) return
      setVerification({ status: 'verifying' })
      try {
        const submitted = await api.submitNetworkRace(setup.issued, trace)
        setVerification({ status: 'verified', receipt: submitted })
        onRefresh()
      } catch (error) {
        const code = error instanceof api.NetworkApiError ? error.code : ''
        const message = playerMessage(error) ?? 'The relay could not check this run. Try again.'
        setVerification({ status: 'failed', message, expired: code === 'run_expired' })
        if (setup.mode !== 'relay') showToast(message, 'error')
      }
    },
    [setup.issued, setup.mode, onRefresh],
  )

  const onFinished = (result: relayLeg.Result, trace: relayLeg.InputTrace) => {
    director.cueNamed(beatGhost(result, setup.ghost?.timeMs ?? null) ? 'finish-win' : 'finish-lose')
    // A baton leg only counts once it reaches the gate; an unfinished run can be raced again on the same issue.
    if (setup.mode === 'relay' && !result.completed) return
    setLastTrace(trace)
    void submit(trace)
  }

  const onCue = (cue: RaceCue) => {
    switch (cue.kind) {
      case 'events':
        director.cue(cue.events)
        return
      case 'catch':
      case 'overtake':
      case 'overtaken':
      case 'approach':
        director.cueNamed(cue.kind)
        return
      default:
        return
    }
  }

  const onSceneState = useCallback(
    (state: CeremonySceneState) => {
      setCeremonyState(state)
      director.ceremony(state)
    },
    [director],
  )

  const onDeparted = useCallback(
    (stage: Extract<HandoffStage, { stage: 'confirmed' }>) => {
      setCeremonyState('departed')
      director.ceremony('departed')
      const code = baton?.code ?? null
      const recipient = snapshot?.runners.find(runner => runner.id === stage.intent.recipientId)
      if (baton) {
        playArrival(stage.intent.id, { relayId: baton.id, fromCountry: baton.holder.country, toCountry: recipient?.country ?? null })
        showDeparture({ key: stage.intent.id, batonName: baton.displayName, leg: stage.intent.leg, recipientName: stage.intent.recipientName })
      }
      onRefresh()
      window.setTimeout(() => {
        director.ceremony('arrival')
        navigate(code ? pathFor('relay', { code }) : '/', { replace: true })
      }, 900)
    },
    [baton, director, onRefresh, showDeparture, snapshot?.runners],
  )

  const onInvite = useCallback(() => {
    if (!baton) return
    void (async () => {
      try {
        const invite = await api.createNetworkInvite(baton.id)
        await shareLink(`Carry ${baton.displayName} next`, invite.url)
        trackShare('handoff')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        showToast(playerMessage(error) ?? 'The invite link could not be created. Try again.', 'error')
      }
    })()
  }, [baton])

  const ceremony = (() => {
    if (setup.mode !== 'relay' || verification.status === 'idle') return null
    if (verification.status === 'verifying') {
      return (
        <div className="nr-leg-verify">
          <p className="nr-leg-verify__status" role="status">
            Verifying your run…
          </p>
        </div>
      )
    }
    if (verification.status === 'failed') {
      return (
        <div className="nr-leg-verify">
          <p role="alert">{verification.message}</p>
          {verification.expired ? (
            <button type="button" className="leg-button leg-button--primary" onClick={onReissue}>
              GET A FRESH LEG
            </button>
          ) : (
            <button type="button" className="leg-button leg-button--primary" onClick={() => lastTrace && void submit(lastTrace)}>
              CHECK AGAIN
            </button>
          )}
        </div>
      )
    }
    if (!machine) {
      return (
        <div className="nr-leg-verify">
          <p>This run is verified, but this baton can’t be passed from here right now. Open the journey to see where it stands.</p>
          <button type="button" className="leg-button leg-button--primary" onClick={onExit}>
            OPEN THE JOURNEY
          </button>
        </div>
      )
    }
    return (
      <HandoffCeremony
        machine={machine}
        groups={runnerGroups(snapshot, baton, playerId)}
        value={baton?.value ?? 100000}
        onSceneState={onSceneState}
        onInvite={onInvite}
        onDeparted={onDeparted}
        onKeepBaton={onExit}
      />
    )
  })()

  return (
    <RaceScreen
      config={setup.config}
      ghost={setup.ghost}
      mode={setup.mode}
      sender={setup.sender}
      {...(setup.appearance ? { baton: setup.appearance } : {})}
      onFinished={onFinished}
      onExit={onExit}
      ceremony={ceremony}
      ceremonyState={ceremonyState}
      onCue={onCue}
      playback={setup.playback}
      autopilot={e2eAutopilot}
    />
  )
}
