import { describe, expect, it } from 'vitest'
import { BED_LAYERS, CEREMONY_MIXES, SCENE_MIXES, planCeremony, planScene, type BedLayer, type CeremonyMix, type CeremonyStage, type SceneKind } from './scenes'

const SCENES: readonly SceneKind[] = ['silent', 'world', 'station', 'race', 'ceremony']

function stageMix(from: CeremonyStage, to: CeremonyStage): CeremonyMix {
  const mix = planCeremony(from, to)
  if (!mix) throw new Error(`${from} -> ${to} changed nothing`)
  return mix
}

interface Playing {
  beds: Set<BedLayer>
  raceAmbience: boolean
  raceMusicAllowed: boolean
}

/** Applies a plan the way the engine does, tracking only what is running. */
function apply(state: Playing, from: SceneKind, to: SceneKind): Playing {
  const plan = planScene(from, to)
  if (!plan) return state
  const beds = new Set(state.beds)
  for (const layer of plan.stopBeds) beds.delete(layer)
  for (const { layer } of plan.startBeds) beds.add(layer)
  return {
    beds,
    raceAmbience: plan.startRaceAmbience ? true : plan.stopRaceAmbience ? false : state.raceAmbience,
    raceMusicAllowed: plan.stopRaceMusic ? false : SCENE_MIXES[to].raceMusic,
  }
}

function expectMatches(state: Playing, scene: SceneKind): void {
  const mix = SCENE_MIXES[scene]
  expect([...state.beds].sort(), scene).toEqual(BED_LAYERS.filter(layer => mix.beds[layer] > 0).sort())
  expect(state.raceAmbience, scene).toBe(mix.raceAmbience)
  expect(state.raceMusicAllowed, scene).toBe(mix.raceMusic)
}

describe('scene transitions', () => {
  it('does nothing when the scene does not change', () => {
    for (const scene of SCENES) expect(planScene(scene, scene)).toBeNull()
  })

  it('crossfades world and station beds', () => {
    expect(planScene('world', 'station')).toMatchObject({
      fadeSeconds: 1.6,
      stopBeds: ['world'],
      startBeds: [{ layer: 'station', gain: 1, alignTo: null }],
      startRaceAmbience: false,
      stopRaceMusic: false,
    })
  })

  it('morphs station and ceremony beds in phase, both ways', () => {
    expect(planScene('station', 'ceremony')).toMatchObject({ fadeSeconds: 2, stopBeds: ['station'], startBeds: [{ layer: 'ceremony', alignTo: 'station' }] })
    expect(planScene('ceremony', 'station')).toMatchObject({ stopBeds: ['ceremony'], startBeds: [{ layer: 'station', alignTo: 'ceremony' }] })
  })

  it('clears the beds for the race and brings in the ride ambience', () => {
    expect(planScene('station', 'race')).toMatchObject({ fadeSeconds: 0.8, stopBeds: ['station'], startBeds: [], startRaceAmbience: true, stopRaceMusic: false })
  })

  it('lets the race music ring out longer into the ceremony than into the station', () => {
    const toCeremony = planScene('race', 'ceremony')
    expect(toCeremony).toMatchObject({ stopRaceMusic: true, stopRaceAmbience: true, startBeds: [{ layer: 'ceremony', alignTo: null }] })
    expect(toCeremony?.fadeSeconds).toBeGreaterThan(planScene('race', 'station')?.fadeSeconds ?? Infinity)
  })

  it('never starts and stops the same bed in one step', () => {
    for (const from of SCENES) {
      for (const to of SCENES) {
        const plan = planScene(from, to)
        if (!plan) continue
        const started = plan.startBeds.map(start => start.layer)
        expect(started.filter(layer => plan.stopBeds.includes(layer)), `${from} -> ${to}`).toEqual([])
        expect(plan.fadeSeconds, `${from} -> ${to}`).toBeGreaterThan(0)
      }
    }
  })

  it('always ends up running exactly what the target scene asks for, whatever the path', () => {
    let state: Playing = { beds: new Set(), raceAmbience: false, raceMusicAllowed: false }
    let current: SceneKind = 'silent'
    const walk: SceneKind[] = ['world', 'station', 'race', 'ceremony', 'station', 'ceremony', 'world', 'race', 'silent', 'race', 'world', 'silent', 'ceremony', 'race']
    for (const next of walk) {
      state = apply(state, current, next)
      current = next
      expectMatches(state, current)
    }
  })
})

describe('ceremony stages', () => {
  it('ignores re-entering the current stage, so accents never double', () => {
    expect(planCeremony('frozen', 'frozen')).toBeNull()
    expect(planCeremony(null, 'approach')?.accents).toEqual(['riser'])
  })

  it('freezes into a slowed, low-passed pad with a heartbeat while the wallet is open', () => {
    const frozen = stageMix('armed', 'frozen')
    expect(frozen.lowpassHz).toBeLessThan(500)
    expect(frozen.playbackRate).toBeLessThan(1)
    expect(frozen.heartbeat).toBeGreaterThan(CEREMONY_MIXES.armed.heartbeat)
    expect(frozen.reverb).toBeGreaterThan(CEREMONY_MIXES.armed.reverb)
  })

  it('releases everything on launch with a swell, whoosh and chord', () => {
    const launch = stageMix('frozen', 'launch')
    expect(launch.lowpassHz).toBeGreaterThanOrEqual(18000)
    expect(launch.playbackRate).toBe(1)
    expect(launch.heartbeat).toBe(0)
    expect(launch.accents).toEqual(expect.arrayContaining(['swell', 'whoosh', 'chord']))
    expect(launch.glideSeconds).toBeLessThan(CEREMONY_MIXES.frozen.glideSeconds)
  })

  it('tightens step by step toward the approval', () => {
    const order: CeremonyStage[] = ['approach', 'armed', 'frozen']
    const cutoffs = order.map(stage => CEREMONY_MIXES[stage].lowpassHz)
    expect([...cutoffs].sort((a, b) => b - a)).toEqual(cutoffs)
  })

  it('chimes on arrival', () => {
    expect(planCeremony('departed', 'arrival')?.accents).toContain('chime')
  })
})
