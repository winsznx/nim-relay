import { ONE } from '../fixed-point'
import { seedState, splitmix64 } from '../prng'
import {
  SPAN,
  WORLD_KITS,
  type FeatureTemplate,
  type HazardTemplate,
  type ModuleTemplate,
  type WorldKit,
  type ZoneTemplate,
} from './modules'
import type { Config, Fork, Gate, Hazard, Path, PulseSection, Segment, SetPiece, Tier, Track, Zone } from './types'

export type TrackConfig = Pick<Config, 'seed' | 'world' | 'tier'>

/** Route length bounds in whole metres. */
export const ROUTE_MIN_METRES = 1400
export const ROUTE_MAX_METRES = 1750

/** 128 BPM at 60 Hz is 28.125 ticks per beat. */
export const PULSE_PERIOD = 28
export const PULSE_WINDOW = 8

/** Minimum distance between collidable hazards on the same path, metres, by tier. */
export const HAZARD_SPACING_METRES: Readonly<Record<Tier, number>> = { 0: 30, 1: 18, 2: 18 }
/** No collidable hazard from this many metres before a ramp... */
export const RAMP_CLEAR_BEFORE_METRES = 10
/** ...and nothing you would jump (barrier, sweeper) this close: the jump would carry the courier past the ramp. */
export const RAMP_JUMPABLE_CLEAR_BEFORE_METRES = 50
/** ...until this many metres after it (the courier is airborne and committed). */
export const RAMP_CLEAR_AFTER_METRES = 50
/** Beams need a slide, which is impossible in the air, so they keep a longer distance. */
export const RAMP_BEAM_CLEAR_AFTER_METRES = 90
/** Tier 0 keeps the opening stretch free of hazards. */
export const OPENING_CALM_METRES = 150
/** Tier 0 keeps timing hazards (doors, trains) out of the first stretch. */
export const TIER0_TIMED_HAZARDS_FROM_METRES = 400

const GATE_HALF_DECIMETRES: Readonly<Record<Tier, number>> = { 0: 15, 1: 11, 2: 9 }
const PULSE_GATE_BONUS_DECIMETRES = 2
const RISK_PROGRESS_PERCENT: Readonly<Record<Tier, number>> = { 0: 130, 1: 130, 2: 135 }
const RISK_TIGHTEN_DECIMETRES: Readonly<Record<Tier, number>> = { 0: 0, 1: 0, 2: 3 }
const HANDOFF_LENGTH_METRES = 30
const PATH_ORDER: Readonly<Record<Path, number>> = { main: 0, safe: 1, risk: 2 }

const metres = (m: number): number => m * ONE
const decimetres = (dm: number): number => Math.trunc(dm * ONE / 10)
const millimetres = (mm: number): number => Math.trunc(mm * ONE / 1000)
const percentOf = (percent: number, of: number): number => Math.trunc(percent * of / 100)

interface Rng {
  state: bigint
}

function nextInt(rng: Rng, bound: number): number {
  const result = splitmix64(rng.state)
  rng.state = result.state
  return Number(result.value % BigInt(bound))
}

export function buildTrack(config: TrackConfig): Track {
  const rng: Rng = { state: seedState(`relay-leg-v5:${config.world}:${config.tier}:${config.seed}`) }
  const kit = WORLD_KITS[config.world]
  const layout = planLayout(kit, config.tier, rng)
  return assemble(config, layout, rng)
}

// ---------------------------------------------------------------------------
// Layout: which modules, in which order
// ---------------------------------------------------------------------------

function planLayout(kit: WorldKit, tier: Tier, rng: Rng): readonly ModuleTemplate[] {
  const count = 3 + nextInt(rng, 2)
  const picks = pickPoolModules(kit.pool, count, tier, rng)
  for (let used = picks.length; used >= 3; used--) {
    const valid = arrangements(kit, picks.slice(0, used)).filter(isValidLayout)
    if (valid.length > 0) return valid[nextInt(rng, valid.length)]!
  }
  // Three pool modules of 130-170 m before, between and after the fixed beats always fit.
  throw new Error('relay-leg: no valid layout')
}

/** Difficulty rises along the route; tier 0 never draws the densest modules; no module repeats back to back. */
function pickPoolModules(pool: readonly ModuleTemplate[], count: number, tier: Tier, rng: Rng): ModuleTemplate[] {
  const cap = tier === 0 ? 2 : 3
  const picks: ModuleTemplate[] = []
  let previous = ''
  for (let i = 0; i < count; i++) {
    const target = Math.min(cap, 1 + Math.trunc((i + 1) * 2 / count))
    const floor = tier === 2 ? target : target - 1
    let candidates = pool.filter(t => t.id !== previous && t.difficulty <= target && t.difficulty >= floor)
    if (candidates.length === 0) candidates = pool.filter(t => t.id !== previous && t.difficulty <= target)
    const pick = candidates[nextInt(rng, candidates.length)]!
    picks.push(pick)
    previous = pick.id
  }
  return picks
}

/** Every way to thread pool modules around the fixed beats without reordering the difficulty curve. */
function arrangements(kit: WorldKit, picks: readonly ModuleTemplate[]): ModuleTemplate[][] {
  type Block = readonly ModuleTemplate[]
  const pulseBlock: Block = [kit.pulse]
  const setPieceBlock: Block = [kit.approach, kit.setPiece]
  const lateOrders: readonly (readonly [Block, Block])[] = [[pulseBlock, setPieceBlock], [setPieceBlock, pulseBlock]]
  const layouts: ModuleTemplate[][] = []
  const n = picks.length
  for (let a = 0; a <= n; a++) {
    for (let b = 0; a + b <= n; b++) {
      for (let c = 0; a + b + c <= n; c++) {
        for (const [first, second] of lateOrders) {
          layouts.push([
            kit.opening,
            ...picks.slice(0, a),
            kit.fork,
            ...picks.slice(a, a + b),
            ...first,
            ...picks.slice(a + b, a + b + c),
            ...second,
            ...picks.slice(a + b + c),
            kit.finish,
          ])
        }
      }
    }
  }
  return layouts
}

/** Fork in the middle third, pulse in the second half, total length in bounds. */
function isValidLayout(layout: readonly ModuleTemplate[]): boolean {
  let length = 0
  let forkFrom = -1
  let forkTo = -1
  let pulseFrom = -1
  for (const template of layout) {
    if (template.fork) {
      forkFrom = length + template.fork.from
      forkTo = length + template.fork.to
    }
    if (template.pulse) pulseFrom = length + template.pulse.from
    length += template.length
  }
  return length >= ROUTE_MIN_METRES
    && length <= ROUTE_MAX_METRES
    && forkFrom * 3 >= length
    && forkTo * 3 <= length * 2
    && pulseFrom * 2 >= length
}

// ---------------------------------------------------------------------------
// Assembly: templates to Q16.16 track data
// ---------------------------------------------------------------------------

interface Assembly {
  segments: Segment[]
  gates: Gate[]
  hazards: Hazard[]
  ramps: Zone[]
  gaps: Zone[]
  rails: Zone[]
  boostPads: Zone[]
  setPieces: SetPiece[]
  fork: Fork | null
  pulse: PulseSection | null
}

interface Placed {
  template: ModuleTemplate
  /** Module start, whole metres. */
  start: number
  /** Ground height at module start, decimetres. */
  elevation: number
  tier: Tier
  fork: Fork | null
}

function assemble(config: TrackConfig, layout: readonly ModuleTemplate[], rng: Rng): Track {
  const out: Assembly = {
    segments: [],
    gates: [],
    hazards: [],
    ramps: [],
    gaps: [],
    rails: [],
    boostPads: [],
    setPieces: [],
    fork: null,
    pulse: null,
  }
  let start = 0
  let elevation = 0
  for (const template of layout) {
    const fork = template.fork ? buildFork(template, start, config.tier, rng) : null
    const placed: Placed = { template, start, elevation, tier: config.tier, fork }
    if (fork) out.fork = fork
    if (template.pulse) out.pulse = buildPulse(start, template)
    placeSegments(out, placed, nextInt(rng, 2) === 0 ? 1 : -1)
    for (const feature of template.features) placeFeature(out, placed, feature, rng)
    start += template.length
    elevation += template.rise
  }
  if (!out.fork || !out.pulse) throw new Error('relay-leg: layout lacks a fork or pulse module')
  const finishDist = metres(start)
  out.setPieces.push({ dist: finishDist, kind: 'handoff-gate', length: metres(HANDOFF_LENGTH_METRES) })
  return {
    world: config.world,
    tier: config.tier,
    finishDist,
    segments: out.segments,
    fork: out.fork,
    gates: out.gates.sort(byDistThenPath),
    hazards: admitHazards(out.hazards.sort(byDistThenPath), out.ramps, config.tier),
    ramps: out.ramps.sort(byFromThenPath),
    gaps: out.gaps.sort(byFromThenPath),
    rails: out.rails.sort(byFromThenPath),
    boostPads: out.boostPads.sort(byFromThenPath),
    pulse: out.pulse,
    setPieces: out.setPieces.sort((a, b) => a.dist - b.dist),
  }
}

function buildFork(template: ModuleTemplate, start: number, tier: Tier, rng: Rng): Fork {
  const spec = template.fork!
  return {
    from: metres(start + spec.from),
    to: metres(start + spec.to),
    riskSide: nextInt(rng, 2) === 0 ? -1 : 1,
    riskProgress: Math.trunc(RISK_PROGRESS_PERCENT[tier] * ONE / 100),
    separation: decimetres(spec.separation),
    safeHalfWidth: decimetres(spec.safeHalfWidth),
    riskHalfWidth: decimetres(spec.riskHalfWidth - RISK_TIGHTEN_DECIMETRES[tier]),
  }
}

function buildPulse(start: number, template: ModuleTemplate): PulseSection {
  const spec = template.pulse!
  return { from: metres(start + spec.from), to: metres(start + spec.to), period: PULSE_PERIOD, window: PULSE_WINDOW }
}

/** One segment per module; a fork module splits into lead-in, fork body and lead-out. */
function placeSegments(out: Assembly, placed: Placed, mirror: 1 | -1): void {
  const { template, start } = placed
  const bend = template.bend * mirror
  const cuts = template.fork ? [0, template.fork.from, template.fork.to, template.length] : [0, template.length]
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!
    const to = cuts[i + 1]!
    const isForkBody = template.fork !== undefined && i === 1
    out.segments.push({
      index: out.segments.length,
      module: template.id,
      kind: template.kind,
      from: metres(start + from),
      to: metres(start + to),
      elevationFrom: decimetres(elevationAt(placed, from)),
      elevationTo: decimetres(elevationAt(placed, to)),
      halfWidth: decimetres(isForkBody ? template.fork!.safeHalfWidth : template.halfWidth),
      bend,
    })
  }
}

function elevationAt(placed: Placed, offset: number): number {
  return placed.elevation + Math.trunc(placed.template.rise * offset / placed.template.length)
}

function pathHalfWidth(placed: Placed, path: Path): number {
  if (path === 'safe' && placed.fork) return placed.fork.safeHalfWidth
  if (path === 'risk' && placed.fork) return placed.fork.riskHalfWidth
  return decimetres(placed.template.halfWidth)
}

function placeFeature(out: Assembly, placed: Placed, feature: FeatureTemplate, rng: Rng): void {
  const at = metres(placed.start + feature.at)
  switch (feature.type) {
    case 'gate': {
      const bonus = feature.kind === 'pulse' ? PULSE_GATE_BONUS_DECIMETRES : 0
      out.gates.push({
        dist: at,
        x: percentOf(feature.x, pathHalfWidth(placed, feature.path)),
        half: decimetres(GATE_HALF_DECIMETRES[placed.tier] + bonus),
        kind: feature.kind,
        path: feature.path,
      })
      return
    }
    case 'hazard':
      if (feature.minTier <= placed.tier) out.hazards.push(placeHazard(placed, feature, at, rng))
      return
    case 'set-piece':
      out.setPieces.push({ dist: at, kind: feature.kind, length: metres(feature.len) })
      return
    case 'ramp':
      out.ramps.push(placeZone(placed, feature, at))
      return
    case 'gap':
      out.gaps.push(placeZone(placed, feature, at))
      return
    case 'rail':
      out.rails.push(placeZone(placed, feature, at))
      return
    case 'pad':
      out.boostPads.push(placeZone(placed, feature, at))
      return
  }
}

function placeHazard(placed: Placed, feature: HazardTemplate, at: number, rng: Rng): Hazard {
  const halfWidth = pathHalfWidth(placed, feature.path)
  const period = feature.period
  return {
    dist: at,
    x: percentOf(feature.x, halfWidth),
    half: feature.half === SPAN ? halfWidth : decimetres(feature.half),
    kind: feature.kind,
    path: feature.path,
    period,
    phase: period > 0 ? (feature.phase + nextInt(rng, period)) % period : 0,
    amplitude: feature.kind === 'gust' ? millimetres(feature.amplitude) : percentOf(feature.amplitude, halfWidth),
    length: metres(feature.length),
  }
}

function placeZone(placed: Placed, feature: ZoneTemplate, at: number): Zone {
  return {
    from: at,
    to: at + metres(feature.len),
    x: percentOf(feature.x, pathHalfWidth(placed, feature.path)),
    half: decimetres(feature.half),
    path: feature.path,
  }
}

// ---------------------------------------------------------------------------
// Cross-module fairness filter
// ---------------------------------------------------------------------------

/**
 * Module boundaries can put two authored hazards too close together, or a
 * hazard where the courier is still airborne from the previous module's ramp.
 * Walking the route in order and dropping the later hazard keeps the authored
 * rhythm and guarantees the content invariants.
 */
function admitHazards(sorted: readonly Hazard[], ramps: readonly Zone[], tier: Tier): Hazard[] {
  const spacing = metres(HAZARD_SPACING_METRES[tier])
  const last: Record<Path, number> = { main: -spacing, safe: -spacing, risk: -spacing }
  const admitted: Hazard[] = []
  for (const hazard of sorted) {
    if (!isPlaceable(hazard, ramps, tier)) continue
    if (hazard.kind === 'gust') {
      admitted.push(hazard)
      continue
    }
    if (tooClose(hazard, last, spacing)) continue
    admitted.push(hazard)
    last[hazard.path] = hazard.dist
  }
  return admitted
}

function isPlaceable(hazard: Hazard, ramps: readonly Zone[], tier: Tier): boolean {
  if (tier === 0 && hazard.dist < metres(OPENING_CALM_METRES)) return false
  const timed = hazard.kind === 'door' || hazard.kind === 'train'
  if (tier === 0 && timed && hazard.dist < metres(TIER0_TIMED_HAZARDS_FROM_METRES)) return false
  if (hazard.kind === 'gust') return true
  const jumpable = hazard.kind === 'barrier' || hazard.kind === 'sweeper'
  const clearAfter = metres(hazard.kind === 'beam' ? RAMP_BEAM_CLEAR_AFTER_METRES : RAMP_CLEAR_AFTER_METRES)
  const clearBefore = metres(jumpable ? RAMP_JUMPABLE_CLEAR_BEFORE_METRES : RAMP_CLEAR_BEFORE_METRES)
  for (const ramp of ramps) {
    if (!pathsTouch(ramp.path, hazard.path)) continue
    if (hazard.dist >= ramp.from - clearBefore && hazard.dist <= ramp.to + clearAfter) return false
  }
  return true
}

function tooClose(hazard: Hazard, last: Readonly<Record<Path, number>>, spacing: number): boolean {
  if (hazard.dist - last[hazard.path] < spacing) return true
  if (hazard.path === 'main') return hazard.dist - last.safe < spacing || hazard.dist - last.risk < spacing
  return hazard.dist - last.main < spacing
}

/** `main` connects to both fork paths; the two fork paths never meet. */
export function pathsTouch(a: Path, b: Path): boolean {
  return a === b || a === 'main' || b === 'main'
}

function byDistThenPath<T extends { dist: number; path: Path }>(a: T, b: T): number {
  return a.dist - b.dist || PATH_ORDER[a.path] - PATH_ORDER[b.path]
}

function byFromThenPath(a: Zone, b: Zone): number {
  return a.from - b.from || PATH_ORDER[a.path] - PATH_ORDER[b.path]
}
