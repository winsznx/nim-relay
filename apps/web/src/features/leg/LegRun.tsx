import { useCallback, useEffect, useMemo, useState } from 'react'
import type { relayLeg } from '@nim-relay/game-engine'
import type { NetworkSnapshot, SubmittedRace } from '@nim-relay/shared'
import { getAudioDirector } from '../audio/director'
import { HandoffCeremony } from '../handoff/HandoffCeremony'
import type { CeremonySceneState } from '../handoff/copy'
import { handoffDeps } from '../handoff/deps'
import { HandoffOrchestrator, type HandoffStage } from '../handoff/machine'
import { RaceScreen, type CeremonyState, type PassAction, type RaceCue, type RaceFrame, type RaceMode } from '../race/RaceScreen'
import * as api from '../relays/api'
import { useNow, useRunnerProfile } from '../relays/data'
import { playArrival } from '../world/globe-bridge'
import { playerMessage } from '../shell/errors'
import { navigate, pathFor } from '../shell/router'
import { showToast } from '../shell/toast'
import { useDeparture } from './departure'
import { legMission } from './mission'
import type { LegSetup } from './prepare'
import { LegProgressReporter } from './progress-reporter'
import { handoffRoster } from './runner-groups'
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

/** Pauses between the verified launch and the world taking over, so the baton visibly leaves first. */
const WORLD_HANDOVER_MS = 900

function beatGhost(result: relayLeg.Result, ghostTimeMs: number | null): boolean {
  const arrived = result.completed && !result.failed
  return ghostTimeMs === null ? arrived : arrived && result.timeMs < ghostTimeMs
}

/** One playable leg in the product: the race, the server's verdict on the run, and for real batons the handoff. */
export function LegRun({ setup, snapshot, playerId, onExit, onReissue, onRefresh }: LegRunProps) {
  const [verification, setVerification] = useState<Verification>({ status: 'idle' })
  const [lastTrace, setLastTrace] = useState<relayLeg.InputTrace | null>(null)
  const [ceremonyState, setCeremonyState] = useState<CeremonyState>('none')
  const [passing, setPassing] = useState(false)
  const showDeparture = useDeparture(state => state.show)
  const director = getAudioDirector()
  const baton = setup.baton
  const now = useNow()
  // Spectators follow a real baton leg live; practice, the Daily and replays are never reported.
  const [progress] = useState(() => (setup.mode === 'relay' && setup.issued?.batonId ? new LegProgressReporter(setup.issued.runId, api.reportLegProgress) : null))

  // The player's recent handoff partners are the "Friends" a pass offers first.
  const selfHandle = snapshot?.runners.find(runner => runner.id === playerId)?.handle ?? null
  const profile = useRunnerProfile(setup.mode === 'relay' ? selfHandle : null)
  const partners = profile.data?.recentRunners

  useEffect(() => {
    director.scene('race')
    director.startRace({ world: setup.config.world })
    return () => director.scene('world')
  }, [director, setup.config.world])

  const roster = useMemo(
    () => (snapshot && baton && setup.mode === 'relay' ? handoffRoster({ snapshot, baton, selfId: playerId, handoffs: setup.handoffs, partners: partners ?? [], now }) : null),
    [snapshot, baton, setup.mode, setup.handoffs, playerId, partners, now],
  )
  const mission = useMemo(() => legMission(setup, roster), [setup, roster])

  const receipt = verification.status === 'verified' ? verification.receipt : null
  const machine = useMemo(() => (receipt?.qualifiedHandoff && setup.mode === 'relay' ? new HandoffOrchestrator(handoffDeps, receipt.runId, setup.atlasNext) : null), [receipt, setup.mode, setup.atlasNext])
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
    // A baton leg only counts once it reaches the gate; a failed or unfinished run can be raced again on the same issue.
    if (setup.mode === 'relay' && (!result.completed || result.failed)) return
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
      case 'baton-separate':
        director.cueNamed(cue.kind)
        return
      case 'echo':
        director.cueNamed('arrival')
        return
      default:
        return
    }
  }

  // Keeps race music on the simulation clock and the FLOW, speed and rail layers in step with the courier.
  const onFrame = (frame: RaceFrame, mode: RaceMode) => {
    director.syncRace(frame.tick + frame.alpha, frame.running)
    director.setFlow(frame.flow)
    director.setSpeed(frame.speed01)
    director.setRailing(frame.railing)
    if (mode === 'relay') progress?.frame(frame, performance.now())
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
      onRefresh()
      // The race fades out first; the banner and the globe crossing belong to the world view.
      window.setTimeout(() => {
        director.ceremony('arrival')
        navigate(code ? pathFor('relay', { code }) : '/', { replace: true })
        if (baton) {
          playArrival(stage.intent.id, { relayId: baton.id, fromStation: baton.route.origin, toStation: baton.route.destination })
          showDeparture({ key: stage.intent.id, batonName: baton.displayName, leg: stage.intent.leg, recipientName: stage.intent.recipientName })
        }
      }, WORLD_HANDOVER_MS)
    },
    [baton, director, onRefresh, showDeparture, snapshot?.runners],
  )

  const createInvite = useCallback(async () => {
    if (!baton) throw new Error('Only a baton leg can invite the next runner.')
    const invite = await api.createNetworkInvite(baton.id)
    return invite.url
  }, [baton])

  const passAction: PassAction | null = machine && baton && !passing ? { label: `PASS ${baton.displayName.toUpperCase()}`, onPress: () => setPassing(true) } : null

  const ceremony = (() => {
    if (setup.mode !== 'relay') return null
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
    if (verification.status !== 'verified') return null
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
    if (!passing) return null
    return (
      <HandoffCeremony
        machine={machine}
        roster={roster}
        batonName={baton?.displayName ?? 'this baton'}
        value={baton?.value ?? 100000}
        createInvite={createInvite}
        onSceneState={onSceneState}
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
      echoes={setup.echoes}
      mission={mission}
      passAction={passAction}
      onFinished={onFinished}
      onExit={onExit}
      ceremony={ceremony}
      ceremonyState={ceremonyState}
      onCue={onCue}
      onFrame={onFrame}
      playback={setup.playback}
      autopilot={e2eAutopilot}
    />
  )
}
