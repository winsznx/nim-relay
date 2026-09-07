import { ONE } from '../fixed-point'
import { seedState, splitmix64 } from '../prng'

/**
 * The authored Relay Race route (docs/RELAY_GAME_V3.md §8/§13). One hand-designed
 * track: intro (steer) -> boost straight -> first hazard -> fork -> race + live
 * stretch + turbulence -> handoff. The seed only jitters gate/hazard x within
 * authored bands, so every run feels designed. Distances are Q16.16 units
 * (ONE == 1.0). x positions are fractions of the lane half-width in [-ONE, ONE].
 */

export const LANE = ONE // lane half-width
export const BASE_SPEED = Math.floor(ONE * 0.0224) // units per tick at rest (~40s clean run)
export const BOOST_SPEED = Math.floor(ONE * 0.039)
export const MAX_TICKS = 5400 // ~90s hard cap; a clean run finishes near ~2400

export type GateKind = 'gold' | 'beat'
export interface Gate {
  dist: number
  x: number
  half: number // graze half-width
  core: number // perfect half-width
  kind: GateKind
}
export interface Hazard {
  dist: number
  x: number
  half: number
}
export interface BoostZone {
  from: number
  to: number
}
export interface Turbulence {
  from: number
  to: number
  drift: number // lateral force amplitude
}
export interface Track {
  finishDist: number
  shortcutSaving: number
  forkDist: number
  forkRejoin: number
  shortcutSide: 1 | -1
  laneAt: { dist: number; half: number }[]
  gates: Gate[]
  hazards: Hazard[]
  boostZones: BoostZone[]
  turbulence: Turbulence[]
  beatPeriod: number
  liveFrom: number
  liveTo: number
}

const F = (n: number): number => Math.floor(ONE * n)

export function buildTrack(seed: string): Track {
  let s = seedState(`${seed}:relay-race-v3`)
  const rnd = (): number => {
    const r = splitmix64(s)
    s = r.state
    return Number(r.value % 1000n) / 1000 // 0..0.999
  }
  const jitter = (base: number, spread: number): number => Math.floor(base + (rnd() - 0.5) * 2 * spread)

  const gates: Gate[] = []
  const hazards: Hazard[] = []

  // 1. intro — gentle S of gold gates, wide lane, no hazards
  const intro = [F(0.35), F(-0.4), F(0.45), F(-0.3)]
  intro.forEach((x, i) => gates.push({ dist: F(1.5 + i * 1.6), x: jitter(x, F(0.05)), half: F(0.34), core: F(0.13), kind: 'gold' }))

  // 2. boost straight — near-centre gates, a boost zone
  gates.push({ dist: F(11), x: jitter(0, F(0.12)), half: F(0.3), core: F(0.12), kind: 'gold' })
  gates.push({ dist: F(15), x: jitter(0, F(0.12)), half: F(0.3), core: F(0.12), kind: 'gold' })
  const boostZones: BoostZone[] = [{ from: F(10), to: F(17) }]

  // 3. first hazard — one obvious red crossbeam, space around it
  hazards.push({ dist: F(21), x: jitter(F(0.2), F(0.1)), half: F(0.28) })
  gates.push({ dist: F(19), x: jitter(F(-0.3), F(0.08)), half: F(0.3), core: F(0.12), kind: 'gold' })
  gates.push({ dist: F(24), x: jitter(F(-0.35), F(0.08)), half: F(0.3), core: F(0.12), kind: 'gold' })

  // 4. fork — safe wide vs faster narrow shortcut with a hazard
  const shortcutSide: 1 | -1 = rnd() < 0.5 ? 1 : -1
  const forkDist = F(26)
  const forkRejoin = F(33)
  const shortcutSaving = F(3.5)
  // safe-line gates (opposite the shortcut side)
  gates.push({ dist: F(28.5), x: -shortcutSide * F(0.5), half: F(0.32), core: F(0.13), kind: 'gold' })
  gates.push({ dist: F(31.5), x: -shortcutSide * F(0.45), half: F(0.32), core: F(0.13), kind: 'gold' })
  // shortcut-line: tighter gates + a hazard, worth taking
  gates.push({ dist: F(27.8), x: shortcutSide * F(0.55), half: F(0.22), core: F(0.1), kind: 'gold' })
  gates.push({ dist: F(29.6), x: shortcutSide * F(0.6), half: F(0.22), core: F(0.1), kind: 'gold' })
  gates.push({ dist: F(31.0), x: shortcutSide * F(0.5), half: F(0.22), core: F(0.1), kind: 'gold' })
  hazards.push({ dist: F(30.2), x: shortcutSide * F(0.3), half: F(0.24) })

  // 5. race + live stretch + turbulence
  const raceStart = F(34)
  for (let i = 0; i < 8; i++) {
    const d = raceStart + i * F(1.9)
    const x = jitter(i % 2 === 0 ? F(0.4) : F(-0.4), F(0.14))
    const kind: GateKind = d >= F(38) && d <= F(42) ? 'beat' : 'gold'
    gates.push({ dist: d, x, half: kind === 'beat' ? F(0.3) : F(0.28), core: F(0.11), kind })
    if (i === 2 || i === 5) hazards.push({ dist: d + F(0.9), x: -x, half: F(0.24) })
  }
  const turbulence: Turbulence[] = [{ from: F(42), to: F(45), drift: F(0.014) }]
  const boostZones2 = [...boostZones, { from: F(38), to: F(42) }]

  // 6. finish approach
  gates.push({ dist: F(46.5), x: jitter(0, F(0.1)), half: F(0.3), core: F(0.12), kind: 'gold' })
  const finishDist = F(49)

  gates.sort((a, b) => a.dist - b.dist)
  hazards.sort((a, b) => a.dist - b.dist)

  return {
    finishDist,
    shortcutSaving,
    forkDist,
    forkRejoin,
    shortcutSide,
    laneAt: [
      { dist: 0, half: F(1.0) },
      { dist: F(10), half: F(0.85) },
      { dist: forkDist, half: F(0.95) },
      { dist: F(42), half: F(0.8) },
      { dist: finishDist, half: F(0.9) },
    ],
    gates,
    hazards,
    boostZones: boostZones2,
    turbulence,
    beatPeriod: 30,
    liveFrom: F(38),
    liveTo: F(42),
  }
}
