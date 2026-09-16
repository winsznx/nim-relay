import { useState } from 'react'
import { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho } from '@nim-relay/shared'
import type { GhostRun, RaceMode } from '../controller'
import { RaceScreen, type CeremonyState } from '../RaceScreen'
import type { SceneStats } from '../scene'
import type { QualityTier } from '../scene/quality'
import { createBot, playBotLeg } from './bot'
import { CourierPreview } from './CourierPreview'
import { labEchoes } from './lab-echoes'

/**
 * Development route /dev/leg. No login, no backend: builds a leg from query
 * parameters so any world, tier and ceremony state can be captured headless.
 *
 *   world=coast|metro|alpine|solar|ocean  tier=0|1|2  seed=<text>
 *   bot=1           autopilot with the deterministic lookahead bot
 *   ghost=1         race a bot-generated ghost named MARIANA
 *   mode=relay|practice|daily|watch   sender=<name>
 *   ceremony=none|approach|armed|frozen|launch|departed   (applied after the finish)
 *   quality=low|medium|high   (locks the tier)
 *   sheet=1         stand-in handoff sheet after a relay finish, to check the results header layout
 *   echoes=1        stand-in Relay Echoes beside the track and in the arrival
 *   preview=courier  lineup of courier poses under the world's lighting
 */

declare global {
  interface Window {
    __legStats?: SceneStats
    /** Courier distance into the leg in metres, as last rendered. */
    __legDist?: number
  }
}

const CEREMONY_STATES: readonly CeremonyState[] = ['none', 'approach', 'armed', 'frozen', 'launch', 'departed']
const MODES: readonly RaceMode[] = ['relay', 'practice', 'daily', 'watch']
const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high']
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
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find(option => option === value) ?? fallback
}

function readSetup(search: string): LabSetup {
  const params = new URLSearchParams(search)
  const world = pick(params.get('world'), relayLeg.WORLDS, 'metro')
  const tierValue = Number(params.get('tier') ?? '1')
  const tier: relayLeg.Tier = tierValue === 0 || tierValue === 2 ? tierValue : 1
  const config: relayLeg.Config = {
    engineVersion: '5',
    challenge: 'relay-leg',
    challengeVersion: '5',
    seed: (params.get('seed') ?? 'dev-leg').slice(0, 64) || 'dev-leg',
    world,
    tier,
    openingFlow: 0,
  }
  let ghost: GhostRun | null = null
  if (params.get('ghost') === '1') {
    const ghostConfig = { ...config, openingFlow: 0 }
    const run = playBotLeg(ghostConfig, { fork: 'safe', lag: 2, bias: -18 })
    ghost = { config: ghostConfig, trace: run.trace, name: 'Mariana', country: 'Portugal', timeMs: run.result.timeMs }
  }
  const mode = pick(params.get('mode'), MODES, 'relay')
  const senderName = params.get('sender') ?? (mode === 'relay' ? 'Tim' : null)
  return {
    config,
    ghost,
    mode,
    sender: senderName ? { name: senderName, country: params.get('country') } : null,
    autopilot: params.get('bot') === '1' ? createBot({ fork: 'risk', bias: 8 }) : null,
    ceremony: pick(params.get('ceremony'), CEREMONY_STATES, 'none'),
    quality: pick<QualityTier | 'auto'>(params.get('quality'), [...QUALITY_TIERS, 'auto'], 'auto'),
    echoes: params.get('echoes') === '1' ? labEchoes(config) : [],
  }
}

/** Stand-in for the handoff ceremony so the results header and ceremony layer can be checked without a backend. */
function LabCeremonySheet() {
  return (
    <section
      aria-label="Handoff"
      style={{
        position: 'absolute', left: 16, right: 16, bottom: 'max(16px, env(safe-area-inset-bottom))', maxWidth: 460, margin: '0 auto',
        padding: 20, borderRadius: 24, background: 'rgba(6, 9, 18, 0.86)', border: '1px solid rgba(255, 255, 255, 0.1)', textAlign: 'center',
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

export function LegLab() {
  const [setup] = useState(() => readSetup(window.location.search))
  const [finished, setFinished] = useState(false)
  const params = new URLSearchParams(window.location.search)
  if (params.get('preview') === 'courier') return <CourierPreview world={setup.config.world} />
  return (
    <RaceScreen
      config={setup.config}
      ghost={setup.ghost}
      mode={setup.mode}
      sender={setup.sender}
      baton={{ handoffCount: 112, ageMs: 70 * 86_400_000, countries: 9, ghostWins: 14, milestones: ['rescue'] }}
      echoes={setup.echoes}
      autopilot={setup.autopilot}
      quality={setup.quality}
      lockQuality={setup.quality !== 'auto'}
      ceremony={finished && params.get('sheet') === '1' ? <LabCeremonySheet /> : null}
      ceremonyState={finished ? setup.ceremony : 'none'}
      onFinished={() => window.setTimeout(() => setFinished(true), CEREMONY_DELAY_MS)}
      onExit={() => window.location.reload()}
      onStats={stats => {
        window.__legStats = stats
      }}
      onFrame={frame => {
        window.__legDist = frame.dist / 65_536
      }}
    />
  )
}
