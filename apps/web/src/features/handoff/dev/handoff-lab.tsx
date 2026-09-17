import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { relayLeg } from '@nim-relay/game-engine'
import type { RaceCue, RenderSnapshot } from '../../race/controller'
import { createBot } from '../../race/dev/bot'
import { mountRelayLeg, type CeremonyState, type RaceSource, type RelayLegSceneHandle } from '../../race/scene'
import { createNetworkInvite } from '../../relays/api'
import { useBatonDetail, useNetwork, useNow, useRunnerProfile } from '../../relays/data'
import { DepartureBanner } from '../../leg/DepartureBanner'
import { useDeparture } from '../../leg/departure'
import { handoffRoster } from '../../leg/runner-groups'
import { useSession } from '../../shell/session'
import type { CeremonySceneState } from '../copy'
import { handoffDeps } from '../deps'
import { HandoffCeremony } from '../HandoffCeremony'
import { HandoffOrchestrator, type HandoffDeps, type TransferRecord } from '../machine'
import '../../../styles/tokens.css'
import '../../shell/ui/tokens.css'
import '../../shell/ui/ui.css'
import '../../race/race.css'

/**
 * Development page for the handoff over the live finish scene, served by Vite at
 * /src/features/handoff/dev/handoff-lab.html. The dev bot rides the last metres of a real leg into the handoff
 * gate, then the real ceremony runs against the relay API (mock it in the browser test) with Nimiq Pay stubbed.
 *
 *   code=<baton code>                         the baton being passed (default AUR0RA0001)
 *   world=coast|metro|alpine|solar|ocean      finish scene
 *   scene=0                                   no 3D, for devices without WebGL
 *   wallet=approve|hold|decline|timeout       how the stubbed Nimiq Pay answers (default approve)
 */

declare global {
  interface Window {
    /** The ceremony state the scene is holding, for captures. */
    __handoffLabCeremony?: CeremonyState
  }
}

const params = new URLSearchParams(window.location.search)
const RUN_IN_METRES = 45
const WALLET_MS = 1600
const TICK_MS = 1000 / relayLeg.TICK_RATE
const MAX_FRAME_MS = 100

function labConfig(world: relayLeg.World): relayLeg.Config {
  return {
    engineVersion: relayLeg.ENGINE_VERSION,
    challenge: relayLeg.CHALLENGE,
    challengeVersion: relayLeg.ENGINE_VERSION,
    seed: 'handoff-lab',
    world,
    tier: 1,
    openingFlow: relayLeg.MAX_OPENING_FLOW,
    tetherSaves: 1,
    ghostline: null,
  }
}

/**
 * The engine stepped by the dev bot: fast-forwarded headless to just before the gate, then ridden in real time
 * across it. Once the leg is over the snapshot reports it finished, so the scene glides into its finish.
 */
function finishingSource(config: relayLeg.Config, finishDist: number): RaceSource {
  const policy = createBot({ fork: 'safe' })
  let state = relayLeg.createState(config)
  while (!state.finished && state.dist < finishDist - RUN_IN_METRES * 65_536) state = relayLeg.step(state, policy(state))
  let accumulator = 0
  let lastNow: number | null = null
  let finishedAt: number | null = null
  const listeners = new Set<(cue: RaceCue) => void>()
  const snapshot: RenderSnapshot = {
    phase: 'racing',
    activePhase: 'racing',
    openingElapsedMs: 0,
    openingMs: 1,
    catchMs: 1,
    finishedMs: 0,
    alpha: 0,
    state,
    previous: state,
    ghost: null,
    ghostPrevious: null,
    frameEvents: 0,
    ghostFrameEvents: 0,
    ghostDelta: null,
    approaching: false,
  }
  return {
    frame(now) {
      accumulator += lastNow === null ? TICK_MS : Math.min(MAX_FRAME_MS, Math.max(0, now - lastNow))
      lastNow = now
      let events = 0
      while (accumulator >= TICK_MS) {
        accumulator -= TICK_MS
        if (state.finished) continue
        snapshot.previous = state
        state = relayLeg.step(state, policy(state))
        events |= state.events
      }
      snapshot.state = state
      snapshot.alpha = accumulator / TICK_MS
      snapshot.frameEvents = events
      if (!state.finished) return
      finishedAt ??= now
      snapshot.phase = 'finished'
      snapshot.activePhase = 'finished'
      snapshot.finishedMs = now - finishedAt
    },
    getRenderSnapshot: () => snapshot,
    onCue(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function stubbedWallet(): HandoffDeps['send'] {
  switch (params.get('wallet')) {
    case 'hold':
      return () => new Promise<string>(() => undefined)
    case 'decline':
      return () => Promise.reject(Object.assign(new Error('User rejected the confirmation dialog'), { type: 'PermissionDeniedError' }))
    case 'timeout':
      return () => Promise.reject(new Error('Request timed out'))
    default:
      return () => new Promise(resolve => window.setTimeout(() => resolve('c0ffee'.repeat(11).slice(0, 64)), WALLET_MS))
  }
}

function createLabDeps(): HandoffDeps {
  const records = new Map<string, TransferRecord>()
  return {
    ...handoffDeps,
    send: stubbedWallet(),
    readTransfer: async id => records.get(id),
    saveTransfer: async record => {
      records.set(record.id, record)
    },
  }
}

function HandoffLab() {
  const code = params.get('code') ?? 'AUR0RA0001'
  const withScene = params.get('scene') !== '0'
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<RelayLegSceneHandle | null>(null)
  const [finished, setFinished] = useState(!withScene)
  const [ceremonyState, setCeremonyState] = useState<CeremonyState>('none')
  const [machine, setMachine] = useState<HandoffOrchestrator | null>(null)
  const showDeparture = useDeparture(state => state.show)
  const { player } = useSession()
  const { snapshot } = useNetwork()
  const detail = useBatonDetail(code).data
  // The pass offers the routes the baton's first loaded page offered, as a real leg does when it is prepared.
  if (!machine && detail) setMachine(new HandoffOrchestrator(createLabDeps(), 'run-lab', detail.atlas.next))
  const selfHandle = snapshot?.runners.find(runner => runner.id === player?.id)?.handle ?? null
  const partners = useRunnerProfile(selfHandle).data?.recentRunners
  const now = useNow()
  const baton = detail?.baton ?? null

  // The finish scene is a WebGL widget outside React.
  useEffect(() => {
    const host = hostRef.current
    if (!withScene || !host) return
    const world = relayLeg.WORLDS.find(candidate => candidate === params.get('world')) ?? 'coast'
    const config = labConfig(world)
    const track = relayLeg.buildTrack(config)
    const handle = mountRelayLeg(host, {
      source: finishingSource(config, track.finishDist),
      track,
      opening: 'short',
      quality: 'high',
      lockQuality: true,
      onFrame: frame => {
        if (frame.dist >= track.finishDist) setFinished(true)
      },
    })
    sceneRef.current = handle
    return () => {
      handle.dispose()
      sceneRef.current = null
    }
  }, [withScene])

  useEffect(() => () => machine?.dispose(), [machine])

  const roster = useMemo(
    () => (snapshot && baton ? handoffRoster({ snapshot, baton, selfId: player?.id ?? null, handoffs: detail?.handoffs ?? [], partners: partners ?? [], now }) : null),
    [snapshot, baton, player?.id, detail?.handoffs, partners, now],
  )

  const onSceneState = useCallback((state: CeremonySceneState) => {
    setCeremonyState(state)
    sceneRef.current?.setCeremony(state)
    window.__handoffLabCeremony = state
  }, [])

  const createInvite = useCallback(async () => {
    if (!baton) throw new Error('The lab baton has not loaded.')
    return (await createNetworkInvite(baton.id)).url
  }, [baton])

  return (
    <main className="leg" data-phase={finished ? 'finished' : 'racing'} data-mode="relay">
      <div className="leg__scene" ref={hostRef} style={withScene ? undefined : { background: 'radial-gradient(120% 80% at 50% 30%, #3a2a1c, #07090f 70%)' }} />
      {finished && (
        <section className="leg-results leg-results--header" aria-label="Arrival results" data-dimmed={ceremonyState === 'frozen' || ceremonyState === 'launch' ? 'true' : 'false'}>
          <p className="leg-results__kicker">LEG COMPLETE</p>
          <p className="leg-results__time">44.12s</p>
          <p className="leg-results__verdict" data-won="true">
            BEAT TIM BY 0.84s
          </p>
        </section>
      )}
      {finished && baton && machine && (
        <div className="leg-ceremony-layer">
          <HandoffCeremony
            machine={machine}
            roster={roster}
            batonName={baton.displayName}
            value={baton.value}
            createInvite={createInvite}
            onSceneState={onSceneState}
            onDeparted={stage => {
              setCeremonyState('departed')
              sceneRef.current?.setCeremony('departed')
              showDeparture({ key: stage.intent.id, batonName: baton.displayName, leg: stage.intent.leg, recipientName: stage.intent.recipientName })
            }}
            onKeepBaton={() => window.location.reload()}
          />
        </div>
      )}
      <div className="leg-fade" data-active={ceremonyState === 'departed' ? 'true' : 'false'} aria-hidden="true" />
      <DepartureBanner />
    </main>
  )
}

// Edits to the race modules this page imports re-run it through hot updates; the page keeps its first root.
const container = document.getElementById('root')
if (container && !container.hasChildNodes()) {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <HandoffLab />
      </QueryClientProvider>
    </StrictMode>,
  )
}
