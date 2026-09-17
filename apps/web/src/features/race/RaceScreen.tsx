import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import type { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho } from '@nim-relay/shared'
import { FRESH_BATON, batonAppearance, type BatonAppearanceInput } from '../baton/baton-appearance'
import { RelayControls, nudgeSpanForWidth } from './controls'
import { RelayLegController, type GhostRun, type RaceCue, type RaceMode } from './controller'
import { RaceHaptics } from './haptics'
import { handoffCallout, type PassAction, type RaceMission } from './mission'
import type { RaceFrame } from './race-frame'
import { echoLabel, legEchoes } from './relay-echoes'
import { ArrivalTitle } from './hud/ArrivalTitle'
import { FirstRunHint } from './hud/FirstRunHint'
import { FlowMeter } from './hud/FlowMeter'
import { RaceHud } from './hud/RaceHud'
import { ResultsPanel } from './hud/ResultsPanel'
import { mountRelayLeg, type CeremonyState, type RelayLegSceneHandle, type SceneStats } from './scene'
import type { CourierCosmetics } from './scene/courier'
import type { QualityTier } from './scene/quality'
import './race.css'

export type { CeremonyState } from './scene'
export type { RaceFrame } from './race-frame'
export type { RaceCue, RaceMode } from './controller'
export type { PassAction, RaceMission } from './mission'

export interface RaceScreenProps {
  config: relayLeg.Config
  /** The previous runner's verified run. It carries its own config (same track, its own opening FLOW). */
  ghost?: GhostRun | null
  mode: RaceMode
  sender?: { name: string; country?: string | null } | null
  baton?: BatonAppearanceInput
  cosmetics?: CourierCosmetics
  /** Relay Echoes of the leg's sector: placed ones stand beside the track, the rest are named in the arrival. */
  echoes?: readonly RelayEcho[]
  /** Relay legs: whose baton this is, who ran it last, who it goes to next and the note it came with. */
  mission?: RaceMission | null
  /** Relay legs: the primary action on the results of a completed leg, e.g. "PASS AURORA". */
  passAction?: PassAction | null
  onFinished(result: relayLeg.Result, trace: relayLeg.InputTrace): void
  onExit(): void
  /**
   * Relay mode only: the handoff ceremony, rendered after the finish in its own full-screen
   * layer (`.leg-ceremony-layer`) while the results shrink to a header at the top.
   */
  ceremony?: ReactNode
  /** Drives the 3D ceremony after the finish. */
  ceremonyState?: CeremonyState
  onCue?(cue: RaceCue): void
  /** Watch mode trace. Defaults to the ghost's run when omitted. */
  playback?: relayLeg.InputTrace | null
  quality?: QualityTier | 'auto'
  lockQuality?: boolean
  /** Development only: an autopilot whose inputs are recorded like a player's. */
  autopilot?: ((state: relayLeg.State) => relayLeg.Input) | null
  onStats?(stats: SceneStats): void
  /**
   * Called once per rendered frame with the race clock on screen: negative ticks count up to 0
   * through the opening, `running` is false while paused and after the finish. The object is
   * reused between frames. `mode` is the run on screen, so replays arrive as 'watch'.
   */
  onFrame?(frame: RaceFrame, mode: RaceMode): void
}

export const WORLD_NAMES: Readonly<Record<relayLeg.World, string>> = {
  coast: 'Sunbreak Coast',
  metro: 'Midnight Metro',
  alpine: 'Cloudline Alps',
  solar: 'Solar Frontier',
  ocean: 'Ocean Skyway',
}

const HINT_KEY = 'nim-relay:leg-controls-v6-hint'
const HINT_TICKS = 5 * 60

function readHintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true
  }
}

function writeHintSeen(): void {
  try {
    window.localStorage.setItem(HINT_KEY, '1')
  } catch {
    // Storage can be unavailable in private WebViews; the hint then shows again next time, which is harmless.
    return
  }
}

interface RunSession {
  key: number
  replay: relayLeg.InputTrace | null
}

/** One relay leg: arrival, race, finish and the ceremony slot. Remounts the run for replays and retries. */
export function RaceScreen(props: RaceScreenProps) {
  const [session, setSession] = useState<RunSession>({ key: 0, replay: null })
  return (
    <RaceRun
      key={session.key}
      {...props}
      replay={session.replay}
      onRaceAgain={() => setSession(current => ({ key: current.key + 1, replay: null }))}
      onWatchReplay={trace => setSession(current => ({ key: current.key + 1, replay: trace }))}
    />
  )
}

interface RaceRunProps extends RaceScreenProps {
  replay: relayLeg.InputTrace | null
  onRaceAgain(): void
  onWatchReplay(trace: relayLeg.InputTrace): void
}

interface RunSetup {
  controller: RelayLegController | null
  mode: RaceMode
}

function createRun(props: RaceRunProps): RunSetup {
  const watching = props.replay !== null || props.mode === 'watch'
  const mode: RaceMode = watching ? 'watch' : props.mode
  const playback = props.replay ?? props.playback ?? (watching ? (props.ghost?.trace ?? null) : null)
  const config = watching && !props.replay && !props.playback && props.ghost ? props.ghost.config : props.config
  const ghost = watching && !props.replay && !props.playback ? null : (props.ghost ?? null)
  const openingMs = mode === 'relay' ? (props.sender || props.mission?.note ? 3800 : 3000) : mode === 'watch' ? 1500 : 1900
  try {
    const controller = new RelayLegController(config, {
      mode,
      ghost,
      playback,
      openingMs,
      catchMs: mode === 'relay' ? (props.mission ? 1700 : 1200) : 900,
      autopilot: watching ? null : (props.autopilot ?? null),
    })
    return { controller, mode }
  } catch {
    return { controller: null, mode }
  }
}

function RaceRun(props: RaceRunProps) {
  const [{ controller, mode }] = useState(() => createRun(props))
  if (!controller) {
    return (
      <main className="leg" data-phase="error">
        <section className="leg-results leg-results--alert" aria-label="Race unavailable">
          <p className="leg-results__kicker">THIS RUN CAN’T BE PLAYED</p>
          <p className="leg-results__body">The run data for this leg is incomplete or from a different route.</p>
          <div className="leg-results__actions">
            <button type="button" className="leg-button leg-button--primary" onClick={props.onExit}>
              BACK
            </button>
          </div>
        </section>
      </main>
    )
  }
  return <RaceView {...props} controller={controller} mode={mode} />
}

interface RaceViewProps extends RaceRunProps {
  controller: RelayLegController
}

function RaceView(props: RaceViewProps) {
  const { controller, mode } = props
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [controls] = useState(() => new RelayControls(controller))
  const [haptics] = useState(() => new RaceHaptics())
  const [hintSeen] = useState(readHintSeen)
  const [sceneFailed, setSceneFailed] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<RelayLegSceneHandle | null>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  const ghostRun = controller.ghostRun
  const watching = mode === 'watch'
  const mission = mode === 'relay' ? (props.mission ?? null) : null
  const previousName = mission?.previous?.name ?? ghostRun?.name ?? null

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let lastFrame: number | null = null
    let handle: RelayLegSceneHandle
    try {
      handle = mountRelayLeg(host, {
        source: {
          frame(now) {
            if (lastFrame !== null) controls.update(now - lastFrame)
            lastFrame = now
            controller.frame(now)
          },
          getRenderSnapshot: controller.getRenderSnapshot,
          onCue: listener => controller.onCue(listener),
        },
        track: controller.getRenderSnapshot().state.track,
        opening: mode === 'relay' ? 'relay' : 'short',
        quality: latest.current.quality ?? 'auto',
        lockQuality: latest.current.lockQuality ?? false,
        cosmetics: latest.current.cosmetics ?? {},
        baton: latest.current.baton ? batonAppearance(latest.current.baton) : FRESH_BATON,
        ghostName: ghostRun?.name ?? null,
        ghostline: controller.config.ghostline ? { line: controller.config.ghostline, name: previousName } : null,
        echoes: latest.current.echoes ?? [],
        onStats: stats => latest.current.onStats?.(stats),
        onFrame: frame => latest.current.onFrame?.(frame, mode),
      })
    } catch {
      setSceneFailed(true)
      return
    }
    sceneRef.current = handle
    const offCue = handle.onCue(cue => {
      const current = latest.current
      current.onCue?.(cue)
      if (cue.kind === 'events' && !watching) haptics.play(cue.tick, cue.events)
      if (cue.kind === 'go' && !watching) writeHintSeen()
      if (cue.kind === 'finish' && !watching) {
        const finished = controller.getSnapshot()
        if (finished.result && finished.trace && !finished.divergence) current.onFinished(finished.result, finished.trace)
      }
    })
    return () => {
      offCue()
      handle.dispose()
      sceneRef.current = null
    }
  }, [controller, controls, haptics, mode, ghostRun, previousName, watching])

  useEffect(() => {
    const isFormField = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
    const down = (event: KeyboardEvent) => {
      if (isFormField(event.target) || watching) return
      if (controls.keyDown(event.key, event.repeat, event.shiftKey)) event.preventDefault()
    }
    const up = (event: KeyboardEvent) => controls.keyUp(event.key)
    const blur = () => {
      controls.reset()
      controller.pause()
    }
    const visibility = () => {
      if (document.hidden) blur()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      controls.reset()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [controller, controls, watching])

  const ceremonyState = props.ceremonyState ?? 'none'
  const finished = snapshot.phase === 'finished'
  const hasCeremony = props.ceremony !== undefined && props.ceremony !== null && props.ceremony !== false
  const ceremonyLayer = finished && mode === 'relay' && hasCeremony && !snapshot.divergence
  useEffect(() => {
    if (finished) sceneRef.current?.setCeremony(ceremonyState)
  }, [ceremonyState, finished])

  const callout = snapshot.approaching && !finished ? handoffCallout(mission) : null
  useEffect(() => {
    sceneRef.current?.setHandoffLabel(callout)
  }, [callout])

  const phase = snapshot.phase
  const activePhase = phase === 'paused' ? controller.getRenderSnapshot().activePhase : phase
  const racing = activePhase === 'racing'
  const opening = activePhase === 'arrival' || activePhase === 'catch'
  const arrivalStage = activePhase === 'arrival' ? 'arrival' : activePhase === 'catch' ? 'catch' : 'go'
  const showArrival = opening || (racing && snapshot.tick < (mission ? 110 : 80))
  const showHint = !hintSeen && !watching && phase === 'racing' && snapshot.tick < HINT_TICKS
  const ghostInfo = ghostRun ? { name: ghostRun.name, timeMs: ghostRun.timeMs } : null
  const previousRun = mission?.previous ?? null
  /** Whom the results measure the run against: the ghost raced, or the previous runner's kept time. */
  const rival = ghostInfo ?? (previousRun && previousRun.timeMs !== null ? { name: previousRun.name, timeMs: previousRun.timeMs } : null)
  const remembered = legEchoes(props.echoes ?? []).map(echoLabel)
  const edgeLevel = !racing ? 'none' : snapshot.motion === 'grinding' ? 'grind' : snapshot.shoulder ? 'shoulder' : 'none'
  const edgeSide = snapshot.edgeSide !== 0 ? (snapshot.edgeSide < 0 ? 'left' : 'right') : 'none'

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (activePhase === 'arrival') controller.skipOpening()
    if (watching || phase !== 'racing') return
    controls.setFullNudge(nudgeSpanForWidth(event.currentTarget.clientWidth))
    if (controls.pointerDown(event.pointerId, event.clientX, event.clientY, event.timeStamp)) event.currentTarget.setPointerCapture(event.pointerId)
  }

  if (sceneFailed) {
    return (
      <main className="leg" data-phase="error">
        <section className="leg-results leg-results--alert" aria-label="3D unavailable">
          <p className="leg-results__kicker">3D RACING UNAVAILABLE</p>
          <p className="leg-results__body">This device could not start the race graphics. Close other apps or update your browser, then try again.</p>
          <div className="leg-results__actions">
            <button type="button" className="leg-button leg-button--primary" onClick={props.onExit}>
              BACK
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="leg" data-phase={phase} data-mode={mode} data-tier={snapshot.flowTier} data-motion={snapshot.motion}>
      <div className="leg__scene" ref={hostRef} />
      <div className="leg-aura" data-tier={racing ? snapshot.flowTier : 'none'} aria-hidden="true" />
      <div className="leg-edge" data-side={edgeSide} data-level={edgeLevel} aria-hidden="true" />
      <div
        className="leg__touch"
        onPointerDown={pointerDown}
        onPointerMove={event => controls.pointerMove(event.pointerId, event.clientX, event.clientY, event.timeStamp)}
        onPointerUp={event => controls.pointerUp(event.pointerId, event.clientX, event.clientY, event.timeStamp)}
        onPointerCancel={event => controls.pointerCancel(event.pointerId)}
        onLostPointerCapture={event => controls.pointerCancel(event.pointerId)}
      />

      {(racing || phase === 'paused') && (
        <>
          <RaceHud
            snapshot={snapshot}
            previousName={previousName}
            nextName={mission?.next?.name ?? null}
            relay={mode === 'relay'}
            callout={callout}
            onPause={() => controller.pause()}
            canPause={phase === 'racing'}
          />
          <FlowMeter flow={snapshot.flow} tier={snapshot.flowTier} rush={snapshot.rush} />
        </>
      )}

      {showArrival && (
        <ArrivalTitle
          mode={mode}
          stage={arrivalStage}
          sender={props.sender ?? null}
          ghost={ghostInfo}
          mission={mission}
          worldName={WORLD_NAMES[props.config.world]}
          remembered={remembered}
        />
      )}
      {showHint && <FirstRunHint />}

      {phase === 'paused' && (
        <section className="leg-pause-sheet" aria-label="Race paused">
          <h2>Paused</h2>
          <button type="button" className="leg-button leg-button--primary" onClick={() => controller.resume()}>
            Resume
          </button>
          <button type="button" className="leg-button" onClick={props.onExit}>
            Leave race
          </button>
        </section>
      )}

      {finished && (
        <ResultsPanel
          snapshot={snapshot}
          mode={mode}
          ghost={rival}
          layout={ceremonyLayer ? 'header' : 'card'}
          dimmed={ceremonyState === 'frozen' || ceremonyState === 'launch'}
          passAction={props.passAction ?? null}
          onRaceAgain={props.onRaceAgain}
          onWatchReplay={() => {
            if (snapshot.trace) props.onWatchReplay(snapshot.trace)
          }}
        />
      )}
      {ceremonyLayer && <div className="leg-ceremony-layer">{props.ceremony}</div>}
      <div className="leg-fade" data-active={ceremonyState === 'departed' ? 'true' : 'false'} aria-hidden="true" />
    </main>
  )
}
