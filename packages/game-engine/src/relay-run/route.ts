import { ONE, clamp } from '../fixed-point'
import { seedState, splitmix64 } from '../prng'

/**
 * Deterministic composition of AUTHORED route modules (docs/RELAY_GAME_V2.md §4).
 * The seed picks which authored module variants and parameters (within authored
 * bands) — it never invents raw geometry. Positions are Q16.16 in
 * [-ONE, ONE] (screen half-widths). One tick == one unit of forward distance.
 */

export const TICKS_PER_SECOND = 60

export type ModuleKind = 'catch' | 'gates' | 'fork' | 'turbulence' | 'pulse' | 'sling'

export interface Gate {
  tick: number
  x: number
  /** center-hit half-width */
  core: number
  /** graze half-width */
  radius: number
  /** pulse gates only: beat period in ticks (0 = static gate) */
  beat: number
}

export interface RouteModule {
  kind: ModuleKind
  startTick: number
  endTick: number
  gates: Gate[]
  /** fork: 1 => tight line is x>=0, -1 => tight line is x<0 */
  tightSide: 1 | -1
  /** turbulence: authored intensity 0..ONE (inertia + drift + reduced authority) */
  turbIntensity: number
  /** turbulence: half-width of the safe corridor at module end */
  corridorEnd: number
  /** pulse: tempo-shift tick (beat period changes after this) */
  tempoShiftTick: number
}

export interface CarryState {
  /** [0.85, 1.15] of baseline opening speed feel — slice: scales Catch reticle drift */
  incomingMomentum: number
  /** [0.90, 1.10] of baseline damping for the first ~10s */
  incomingStability: number
  /** quantized previous Sling angle -> which side Catch starts from, always on-screen */
  incomingTrajectory: number
  /** [0.45, 1.4] of BASE_CATCH_WINDOW */
  catchWindowScale: number
}

export const NEUTRAL_CARRY: CarryState = {
  incomingMomentum: ONE,
  incomingStability: ONE,
  incomingTrajectory: 0,
  catchWindowScale: ONE,
}

export interface PrevLegSummary {
  cleanGateRatio: number // 0..ONE
  turbulenceScoreNorm: number // 0..ONE
  slingAccuracy: number // 0..ONE
  slingAngle: number // -ONE..ONE
}

const c = (min: number, max: number, v: number): number => (v < min ? min : v > max ? max : v)

/**
 * docs/RELAY_GAME_V2.md §2.7 — bounded, non-monetary, no combination makes a
 * leg impossible. Inputs are 0..ONE norms; outputs are ONE-scaled multipliers.
 * Pure integer math (no libm).
 */
export function deriveCarryState(prev: PrevLegSummary | null): CarryState {
  if (!prev) return NEUTRAL_CARRY
  // momentum = 0.85 + 0.30 * cleanGateRatio, clamped [0.85, 1.15]
  const momentum = c(Math.floor(85 * ONE / 100), Math.floor(115 * ONE / 100), Math.floor(85 * ONE / 100) + Math.floor((30 * prev.cleanGateRatio) / 100))
  // stability = 1.10 - 0.20 * turbulenceScoreNorm, clamped [0.90, 1.10]
  const stability = c(Math.floor(90 * ONE / 100), Math.floor(110 * ONE / 100), Math.floor(110 * ONE / 100) - Math.floor((20 * prev.turbulenceScoreNorm) / 100))
  // catchWindowScale = 1.40 - 0.80 * slingAccuracy, clamped [0.45, 1.40]
  const window = c(Math.floor(45 * ONE / 100), Math.floor(140 * ONE / 100), Math.floor(140 * ONE / 100) - Math.floor((80 * prev.slingAccuracy) / 100))
  const traj = clamp(Math.floor(prev.slingAngle / 8192) * 8192, -ONE + 8192, ONE - 8192)
  return { incomingMomentum: momentum, incomingStability: stability, incomingTrajectory: traj, catchWindowScale: window }
}

interface Rng {
  next(): number
  range(lo: number, hi: number): number
  pick<T>(arr: readonly T[]): T
}

function rng(seed: string, legNumber: number): Rng {
  let s = seedState(`${seed}:relay-run-v2:${legNumber}`)
  const next = (): number => {
    const r = splitmix64(s)
    s = r.state
    return Number(r.value % 1_000_000n)
  }
  return {
    next,
    range: (lo, hi) => lo + (next() % (hi - lo + 1)),
    pick: (arr) => arr[next() % arr.length]!,
  }
}

// ── Authored gate weaves (module-local x offsets across the module span) ──
const WEAVES: readonly number[][] = [
  [0, 0, 0],
  [-1, 1, -1],
  [1, 1, -1, -1],
  [-1, 0, 1, 0, -1],
  [1, -1, 1, -1, 1],
]

/** spacingScale / coreScale are integer percentages (e.g. 85 == 0.85). */
function gateCluster(startTick: number, spanTicks: number, r: Rng, spacingScale: number, coreScale: number): Gate[] {
  const weave = r.pick(WEAVES)
  const mirror = r.next() % 2 === 0 ? 1 : -1
  const n = weave.length
  const step = Math.max(24, Math.floor((spanTicks * spacingScale) / ((n + 1) * 100)))
  const gates: Gate[] = []
  for (let i = 0; i < n; i++) {
    gates.push({
      tick: startTick + step * (i + 1),
      x: Math.floor((weave[i]! * mirror * ONE * 60) / 100),
      core: Math.floor((ONE * 9 * coreScale) / 10000),
      radius: Math.floor((ONE * 22 * coreScale) / 10000),
      beat: 0,
    })
  }
  return gates
}

// authored pulse weave — a rhythmic side-to-side pattern, no trig
const PULSE_WEAVE: readonly number[] = [0, 45, 0, -45, 0, 45, -45]

function pulseGates(startTick: number, spanTicks: number, r: Rng, tempoShiftTick: number): Gate[] {
  const n = r.range(5, 7)
  const step = Math.floor(spanTicks / (n + 1))
  const mirror = r.next() % 2 === 0 ? 1 : -1
  const gates: Gate[] = []
  for (let i = 0; i < n; i++) {
    const t = startTick + step * (i + 1)
    gates.push({
      tick: t,
      x: Math.floor((PULSE_WEAVE[i % PULSE_WEAVE.length]! * mirror * ONE) / 100),
      core: Math.floor(ONE / 10),
      radius: Math.floor((ONE * 24) / 100),
      beat: t < tempoShiftTick ? 36 : 26,
    })
  }
  return gates
}

/** The composed route. Slice skeleton: catch -> gates -> fork -> turbulence -> pulse -> gates -> sling. */
export function composeRoute(seed: string, legNumber: number, carry: CarryState): RouteModule[] {
  const r = rng(seed, legNumber)
  const diffPct = Math.min(100, Math.floor((legNumber * 100) / 40)) // 0..100
  const spacingScale = c(70, 130, 130 - Math.floor((diffPct * 55) / 100)) // integer %
  const coreScale = c(70, 110, 110 - Math.floor((diffPct * 35) / 100)) // integer %

  const mods: RouteModule[] = []
  let t = 0
  const push = (kind: ModuleKind, span: number, extra: Partial<RouteModule> = {}): void => {
    mods.push({
      kind,
      startTick: t,
      endTick: t + span,
      gates: [],
      tightSide: 1,
      turbIntensity: 0,
      corridorEnd: Math.round(ONE * 0.28),
      tempoShiftTick: 0,
      ...extra,
    })
    t += span
  }

  push('catch', 210)
  push('gates', 420, { gates: gateCluster(t, 420, r, spacingScale, coreScale) })
  push('fork', 540, {
    tightSide: r.next() % 2 === 0 ? 1 : -1,
    gates: gateCluster(t + 120, 400, r, spacingScale * 0.8, coreScale * 0.85),
  })
  const turbSpan = 380
  push('turbulence', turbSpan, {
    turbIntensity: c(Math.floor((ONE * 45) / 100), Math.floor((ONE * 80) / 100), Math.floor((ONE * (50 + Math.floor((diffPct * 25) / 100))) / 100)),
    corridorEnd: Math.floor((ONE * (22 - Math.floor((diffPct * 6) / 100))) / 100),
  })
  const pulseSpan = 520
  const shift = t + Math.floor(pulseSpan / 2)
  push('pulse', pulseSpan, { tempoShiftTick: shift, gates: pulseGates(t, pulseSpan, r, shift) })
  push('gates', 380, { gates: gateCluster(t, 380, r, spacingScale, coreScale) })
  push('sling', 260)

  void carry
  return mods
}

export function routeTotalTicks(mods: readonly RouteModule[]): number {
  return mods.length === 0 ? 0 : mods[mods.length - 1]!.endTick
}
