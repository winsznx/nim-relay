/**
 * Scene and ceremony mixes as data. A scene decides which continuous layers run; a ceremony stage
 * shapes the ceremony bed around the wallet approval. The director applies these plans to Web
 * Audio; nothing here touches it.
 */

export type SceneKind = 'silent' | 'world' | 'station' | 'race' | 'ceremony'

/** Beds are scene music that loops freely; race music follows the race clock instead. */
export type BedLayer = 'world' | 'station' | 'ceremony'

export const BED_LAYERS: readonly BedLayer[] = ['world', 'station', 'ceremony']

export interface SceneMix {
  /** Layer gain per bed (multiplied by the track's own gain); 0 = not playing. */
  readonly beds: Readonly<Record<BedLayer, number>>
  /** Wind, hover hum and rail grind run. */
  readonly raceAmbience: boolean
  /** Race music may play (it still waits for startRace and a running race clock). */
  readonly raceMusic: boolean
}

const QUIET: Readonly<Record<BedLayer, number>> = { world: 0, station: 0, ceremony: 0 }

export const SCENE_MIXES: Readonly<Record<SceneKind, SceneMix>> = {
  silent: { beds: QUIET, raceAmbience: false, raceMusic: false },
  world: { beds: { ...QUIET, world: 1 }, raceAmbience: false, raceMusic: false },
  station: { beds: { ...QUIET, station: 1 }, raceAmbience: false, raceMusic: false },
  race: { beds: QUIET, raceAmbience: true, raceMusic: true },
  ceremony: { beds: { ...QUIET, ceremony: 1 }, raceAmbience: false, raceMusic: false },
}

export interface BedStart {
  layer: BedLayer
  gain: number
  /** Start in phase with this bed when both loops have the same length (a variant morph). */
  alignTo: BedLayer | null
}

export interface ScenePlan {
  from: SceneKind
  to: SceneKind
  /** Crossfade length for everything that changes. */
  fadeSeconds: number
  startBeds: BedStart[]
  stopBeds: BedLayer[]
  startRaceAmbience: boolean
  stopRaceAmbience: boolean
  stopRaceMusic: boolean
}

/** Station and ceremony beds are variants of one loop: moving between them morphs in phase. */
const MORPHS: readonly (readonly [BedLayer, BedLayer])[] = [['station', 'ceremony'], ['ceremony', 'station']]

function fadeSeconds(from: SceneKind, to: SceneKind): number {
  if (to === 'silent') return 0.6
  if (from === 'silent') return 1.2
  if (to === 'race') return 0.8
  if (from === 'race') return to === 'ceremony' ? 2.4 : 1.2
  if (MORPHS.some(([a, b]) => a === from && b === to)) return 2
  return 1.6
}

/** What changes when moving between scenes; null when nothing does. */
export function planScene(from: SceneKind, to: SceneKind): ScenePlan | null {
  if (from === to) return null
  const before = SCENE_MIXES[from]
  const after = SCENE_MIXES[to]
  const morph = MORPHS.find(([a, b]) => before.beds[a] > 0 && after.beds[b] > 0)
  return {
    from,
    to,
    fadeSeconds: fadeSeconds(from, to),
    startBeds: BED_LAYERS.filter(layer => after.beds[layer] > 0 && before.beds[layer] === 0).map(layer => ({
      layer,
      gain: after.beds[layer],
      alignTo: morph && morph[1] === layer ? morph[0] : null,
    })),
    stopBeds: BED_LAYERS.filter(layer => before.beds[layer] > 0 && after.beds[layer] === 0),
    startRaceAmbience: after.raceAmbience && !before.raceAmbience,
    stopRaceAmbience: before.raceAmbience && !after.raceAmbience,
    stopRaceMusic: before.raceMusic && !after.raceMusic,
  }
}

/**
 * The handoff ceremony, as the runner lives it:
 * approach  the handoff gate comes into view
 * armed     recipient locked, the baton is ready to leave
 * frozen    the wallet approval is open: the world holds its breath
 * launch    the transaction is confirmed: release
 * departed  the baton is on its way
 * arrival   the baton reached the next runner
 */
export type CeremonyStage = 'approach' | 'armed' | 'frozen' | 'launch' | 'departed' | 'arrival'

export type CeremonyAccent = 'riser' | 'swell' | 'whoosh' | 'chord' | 'chime' | 'heartbeat-haptic' | 'launch-haptic'

export interface CeremonyMix {
  /** Ceremony bed level (multiplied by the scene's bed gain). */
  readonly bedGain: number
  /** Music low-pass cutoff. */
  readonly lowpassHz: number
  /** Bed playback rate; below 1 slows and deepens the bed into a suspended pad. */
  readonly playbackRate: number
  /** Reverb send, 0..1. */
  readonly reverb: number
  /** Heartbeat pulse level, 0..1. */
  readonly heartbeat: number
  /** Time constant for gliding into this stage. */
  readonly glideSeconds: number
  /** One-shots played on entering the stage. */
  readonly accents: readonly CeremonyAccent[]
}

export const CEREMONY_MIXES: Readonly<Record<CeremonyStage, CeremonyMix>> = {
  approach: { bedGain: 0.85, lowpassHz: 6000, playbackRate: 1, reverb: 0.15, heartbeat: 0, glideSeconds: 0.8, accents: ['riser'] },
  armed: { bedGain: 0.75, lowpassHz: 2200, playbackRate: 1, reverb: 0.3, heartbeat: 0.35, glideSeconds: 0.6, accents: [] },
  frozen: { bedGain: 0.7, lowpassHz: 420, playbackRate: 0.5, reverb: 0.75, heartbeat: 0.85, glideSeconds: 0.9, accents: ['heartbeat-haptic'] },
  launch: { bedGain: 1, lowpassHz: 20000, playbackRate: 1, reverb: 0.35, heartbeat: 0, glideSeconds: 0.12, accents: ['swell', 'whoosh', 'chord', 'launch-haptic'] },
  departed: { bedGain: 0.8, lowpassHz: 20000, playbackRate: 1, reverb: 0.2, heartbeat: 0, glideSeconds: 1.2, accents: [] },
  arrival: { bedGain: 0.9, lowpassHz: 20000, playbackRate: 1, reverb: 0.25, heartbeat: 0, glideSeconds: 0.6, accents: ['chime'] },
}

/** The mix to glide to (and accents to play) when moving to `to`; re-entering the current stage changes nothing. */
export function planCeremony(from: CeremonyStage | null, to: CeremonyStage): CeremonyMix | null {
  return from === to ? null : CEREMONY_MIXES[to]
}
