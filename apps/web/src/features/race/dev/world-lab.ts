import { relayLeg } from '@nim-relay/game-engine'
import type { QualityTier } from '../scene/quality'
import { createSimSource } from './sim-source'
import { mountWorldScene, type WorldView } from './world-scene'

/**
 * Dev page for the race world alone, served by Vite at
 * /src/features/race/dev/world-lab.html. The real engine and dev bot drive it,
 * without the app shell, HUD, courier or race camera, so world work can be
 * captured from views the race camera never takes.
 *
 *   world=coast|metro|alpine|solar|ocean  tier=0|1|2  seed=<text>  quality=low|medium|high
 *   at=<metres>       fast-forward there before rendering
 *   event=<kind>      fast-forward to shortly before the first world event of that kind triggers
 *   fork=safe|risk    the bot's path at every fork (default risk)
 *   fall=<metres>     the bot rides off the next open edge after this distance
 *   view=chase|high|side|top   camera (default chase)
 *   label=<text>      holographic text over the handoff gate
 *   scene=full        the full race scene instead: courier, race camera and effects
 */

const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high']
const VIEWS: readonly WorldView[] = ['chase', 'high', 'side', 'top']
const EVENT_LEAD_METRES = 30

const host = document.getElementById('host')
if (host) {
  const params = new URLSearchParams(window.location.search)
  const world = relayLeg.WORLDS.find(candidate => candidate === params.get('world')) ?? 'coast'
  const tierValue = Number(params.get('tier') ?? '1')
  const tier: relayLeg.Tier = tierValue === 0 || tierValue === 2 ? tierValue : 1
  const quality = QUALITY_TIERS.find(candidate => candidate === params.get('quality')) ?? 'high'
  const config: relayLeg.Config = {
    engineVersion: relayLeg.ENGINE_VERSION,
    challenge: relayLeg.CHALLENGE,
    challengeVersion: relayLeg.ENGINE_VERSION,
    seed: (params.get('seed') ?? 'dev-leg').slice(0, 64) || 'dev-leg',
    world,
    tier,
    openingFlow: relayLeg.MAX_OPENING_FLOW,
    tetherSaves: 1,
    ghostline: null,
  }
  const track = relayLeg.buildTrack(config)
  const kind = params.get('event')
  const event = kind ? track.events.find(candidate => candidate.kind === kind) : undefined
  const startDist = event ? Math.max(0, event.triggerDist / 65536 - EVENT_LEAD_METRES) : Math.max(0, Number(params.get('at') ?? '0') || 0)
  const fall = params.get('fall')
  const source = createSimSource({
    config,
    startDist,
    bot: { fork: params.get('fork') === 'safe' ? 'safe' : 'risk', ...(fall === null ? {} : { fallAt: Number(fall) || 0 }) },
  })
  const onStats = (stats: NonNullable<Window['__legStats']>): void => {
    window.__legStats = stats
  }
  if (params.get('scene') === 'full') {
    const { mountRelayLeg } = await import('../scene')
    mountRelayLeg(host, {
      source,
      track,
      opening: 'short',
      quality,
      lockQuality: true,
      onStats,
      onFrame: frame => {
        window.__legDist = frame.dist / 65_536
      },
    })
  } else {
    mountWorldScene(host, {
      source,
      track,
      quality,
      view: VIEWS.find(view => view === params.get('view')) ?? 'chase',
      label: params.get('label'),
      onStats,
      onDist: metres => {
        window.__legDist = metres
      },
    })
  }
}
