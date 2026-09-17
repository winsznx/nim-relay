import { useRef, useState } from 'react'
import { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho } from '@nim-relay/shared'
import type { GhostRun, RaceMode } from '../controller'
import type { PassAction, RaceMission } from '../mission'
import { RaceScreen, type CeremonyState } from '../RaceScreen'
import type { SceneStats } from '../scene'
import type { QualityTier } from '../scene/quality'
import { createBot, playBotLeg, type BotOptions } from './bot'
import { CourierPreview } from './CourierPreview'
import { labEchoes } from './lab-echoes'

/**
 * Development route /dev/leg. No login, no backend: builds a leg from query
 * parameters so any world, tier, moment and ceremony state can be captured headless.
 *
 *   world=coast|metro|alpine|solar|ocean  tier=0|1|2  seed=<text>
 *   bot=1           autopilot with the engine's skilled courier
 *   ghost=1         race a bot ghost named MARIANA, with her verified Ghostline on the deck
 *   scenario=grind|fall|failed|rush
 *                   grind: the bot grinds a rail and saves it; fall: rides off an open edge and the tether saves it;
 *                   failed: the same fall with no tether left; rush: starts at the highest opening FLOW
 *   at=<metres>     where a grind or fall scenario starts looking for its edge (default 120)
 *   mode=relay|practice|daily|watch   sender=<name>
 *   mission=1       relay mission header: Aurora from Mariana to Yasmine, with a note from Tim
 *   next=open       with mission=1, nobody chosen yet at the handoff
 *   pass=1          PASS AURORA on the results of a completed relay leg
 *   ceremony=none|approach|armed|frozen|launch|departed   (applied after the finish)
 *   quality=low|medium|high   (locks the tier)
 *   sheet=1         stand-in handoff sheet after a relay finish, to check the results header layout
 *   echoes=1        stand-in Relay Echoes beside the track and in the arrival
 *   tutorial=1      the gameplay tutorial from its first step, whatever this browser saved; it saves and reports nothing
 *   preview=courier  lineup of courier poses under the world's lighting
 */

declare global {
  interface Window {
    __legStats?: SceneStats
    /** Courier distance into the leg in metres, as last rendered. */
    __legDist?: number
    /** The courier's locomotion as last rendered, for captures that wait on a moment. */
    __legFrame?: {
      tick: number
      dist: number
      motion: relayLeg.Motion
      lane: number
      targetLane: number
      rushTicks: number
      edgeSide: number
      running: boolean
      ghostDelta: number | null
      /** The engine raised DRAFTING within the last few ticks. */
      drafting: boolean
    }
  }
}

const CEREMONY_STATES: readonly CeremonyState[] = ['none', 'approach', 'armed', 'frozen', 'launch', 'departed']
const MODES: readonly RaceMode[] = ['relay', 'practice', 'daily', 'watch']
const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high']
const SCENARIOS = ['none', 'grind', 'fall', 'failed', 'rush'] as const
type Scenario = (typeof SCENARIOS)[number]
/** Lets the finish glide and results land before a requested ceremony state takes over. */
const CEREMONY_DELAY_MS = 2500

interface LabSetup {
  config: relayLeg.Config
  ghost: GhostRun | null
  mode: RaceMode
  sender: { name: string; country: string | null } | null
  autopilot: ((state: relayLeg.State) => relayLeg.Input) | null
  ceremony: CeremonyState
  quality: QualityTier | 'auto'
  echoes: RelayEcho[]
  mission: RaceMission | null
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find(option => option === value) ?? fallback
}

function scenarioBot(scenario: Scenario, at: number): BotOptions {
  switch (scenario) {
    case 'grind':
      return { fork: 'risk', grindAt: at }
    case 'fall':
    case 'failed':
      return { fork: 'risk', fallAt: at }
    default:
      return { fork: 'risk', bias: 2 }
  }
}

function readSetup(search: string): LabSetup {
  const params = new URLSearchParams(search)
  const world = pick(params.get('world'), relayLeg.WORLDS, 'metro')
  const tierValue = Number(params.get('tier') ?? '1')
  const tier: relayLeg.Tier = tierValue === 0 || tierValue === 2 ? tierValue : 1
  const scenario = pick(params.get('scenario'), SCENARIOS, 'none')
  const seed = (params.get('seed') ?? 'dev-leg').slice(0, 64) || 'dev-leg'
  const base: relayLeg.Config = {
    engineVersion: relayLeg.ENGINE_VERSION,
    challenge: relayLeg.CHALLENGE,
    challengeVersion: relayLeg.ENGINE_VERSION,
    seed,
    world,
    tier,
    openingFlow: scenario === 'rush' ? relayLeg.MAX_OPENING_FLOW : 0,
    tetherSaves: scenario === 'failed' ? 0 : 1,
    ghostline: null,
  }
  let ghost: GhostRun | null = null
  let config = base
  if (params.get('ghost') === '1') {
    // A quick starter on the safe routes: she leads early, so the racer drafts her line and passes her at the relay cut.
    const ghostConfig: relayLeg.Config = { ...base, openingFlow: relayLeg.MAX_OPENING_FLOW, tetherSaves: 1, ghostline: null }
    const run = playBotLeg(ghostConfig, { fork: 'safe' })
    ghost = { config: ghostConfig, trace: run.trace, name: 'Mariana', country: 'Portugal', timeMs: run.result.timeMs }
    config = { ...base, ghostline: relayLeg.deriveGhostline(ghostConfig, run.trace) }
  }
  const mode = pick(params.get('mode'), MODES, 'relay')
  const senderName = params.get('sender') ?? (mode === 'relay' ? 'Tim' : null)
  const mission: RaceMission | null =
    params.get('mission') === '1'
      ? {
          batonName: 'Aurora',
          previous: ghost ? { name: ghost.name, timeMs: ghost.timeMs } : null,
          next: params.get('next') === 'open' ? null : { name: 'Yasmine', context: null },
          note: { from: senderName ?? 'Tim', text: 'Keep it gold for Lisbon' },
          route: { from: 'Genesis Station', to: 'Cape Verdigris', ghost: ghost ? 'previous-runner' : 'none' },
        }
      : null
  const at = Math.max(20, Number(params.get('at') ?? '120') || 120)
  return {
    config,
    ghost,
    mode,
    sender: senderName ? { name: senderName, country: params.get('country') } : null,
    autopilot: params.get('bot') === '1' || scenario !== 'none' ? createBot(scenarioBot(scenario, at)) : null,
    ceremony: pick(params.get('ceremony'), CEREMONY_STATES, 'none'),
    quality: pick<QualityTier | 'auto'>(params.get('quality'), [...QUALITY_TIERS, 'auto'], 'auto'),
    echoes: params.get('echoes') === '1' ? labEchoes(config) : [],
    mission,
  }
}

/**
 * Stand-in for the handoff ceremony so the results header, ceremony layer and ceremony camera can be checked without a
 * backend. It is as tall as the real launch platform sheet: the bottom 45% of a phone screen.
 */
function LabCeremonySheet() {
  return (
    <section
      aria-label="Handoff"
      style={{
        position: 'absolute', left: 16, right: 16, bottom: 'max(16px, env(safe-area-inset-bottom))', maxWidth: 460, margin: '0 auto', boxSizing: 'border-box',
        minHeight: 'calc(45% - 16px)', padding: 20, borderRadius: 24, background: 'rgba(6, 9, 18, 0.86)', border: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'center',
      }}
    >
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.3em', color: '#f5a623' }}>PASS THE BATON</p>
      <p style={{ margin: '8px 0 16px', fontSize: 15, color: '#9aa2b6' }}>Choose who carries it next.</p>
      <button type="button" className="leg-button leg-button--primary" style={{ width: '100%' }}>
        CHOOSE RUNNER
      </button>
    </section>
  )
}

/** Ticks DRAFTING stays reported after the engine last raised it. */
const DRAFT_HOLD_TICKS = 4

export function LegLab() {
  const [setup] = useState(() => readSetup(window.location.search))
  const lastDraftTick = useRef(Number.NEGATIVE_INFINITY)
  const [finished, setFinished] = useState(false)
  const [passed, setPassed] = useState(false)
  const params = new URLSearchParams(window.location.search)
  if (params.get('preview') === 'courier') return <CourierPreview world={setup.config.world} />
  const passAction: PassAction | null = params.get('pass') === '1' && !passed ? { label: `PASS ${setup.mission?.batonName.toUpperCase() ?? 'THE BATON'}`, onPress: () => setPassed(true) } : null
  return (
    <RaceScreen
      config={setup.config}
      ghost={setup.ghost}
      mode={setup.mode}
      sender={setup.sender}
      baton={{ handoffCount: 112, ageMs: 70 * 86_400_000, countries: 9, ghostWins: 14, milestones: ['rescue'] }}
      echoes={setup.echoes}
      mission={setup.mission}
      passAction={passAction}
      autopilot={setup.autopilot}
      tutorial={params.get('tutorial') === '1' ? 'force' : 'off'}
      quality={setup.quality}
      lockQuality={setup.quality !== 'auto'}
      ceremony={finished && (params.get('sheet') === '1' || passed) ? <LabCeremonySheet /> : null}
      ceremonyState={finished ? setup.ceremony : 'none'}
      onFinished={() => window.setTimeout(() => setFinished(true), CEREMONY_DELAY_MS)}
      onExit={() => window.location.reload()}
      onStats={stats => {
        window.__legStats = stats
      }}
      onCue={cue => {
        if (cue.kind === 'events' && cue.events & relayLeg.EVENT.DRAFTING) lastDraftTick.current = cue.tick
      }}
      onFrame={frame => {
        window.__legDist = frame.dist / 65_536
        window.__legFrame = {
          tick: frame.tick, dist: frame.dist / 65_536, motion: frame.motion, lane: frame.lane, targetLane: frame.targetLane, rushTicks: frame.rushTicks, edgeSide: frame.edgeSide,
          running: frame.running, ghostDelta: frame.ghostDelta, drafting: frame.tick - lastDraftTick.current <= DRAFT_HOLD_TICKS,
        }
      }}
    />
  )
}
