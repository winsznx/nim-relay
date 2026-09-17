import { ONE } from '../fixed-point'
import { SHOULDER_WIDTH } from './constants'
import type { EdgeKind, GateKind, HazardKind, LaneCount, ModuleKind, Path, SetPieceKind, Tier, WorldEventKind } from './types'

/**
 * Authoring vocabulary for Relay Leg v6 module templates.
 *
 * Every number is an integer in authoring units, converted to Q16.16 by track.ts:
 * - `at`, `len`, `lead`: metres from the start of the module (`lead`: metres before `at`)
 * - `lanes`, `lane`: lane slots of the feature's path (3 lanes: -2, 0, 2; 2 lanes: -1, 1; 1 lane: 0)
 * - `rise`, `shoulder`, `separation`: decimetres
 * - `bend`: milli-radians per 100 m (presentation only)
 * - gust and crosswind `amplitude`: millimetres per tick (signed, + pushes right);
 *   rising-bridge and bridge-break `amplitude`: speed threshold in millimetres per tick
 * - `period`, `phase`, `duration`: ticks
 *
 * Layout rules (track.ts enforces the fairness ones again across module boundaries,
 * content.test.ts checks all of them):
 * - A static barrier or beam leaves a free lane, except full-width hurdles (jump) and
 *   full-width beams (slide). Movers and event bodies always leave a lane free.
 * - Collidable hazards sit at least 30 m apart when tier 0 sees them, 18 m otherwise.
 * - Every gap has a ramp ending 4-10 m before it covering the same lanes.
 * - Nothing collidable within 50 m after a ramp (90 m for overhead obstacles), nothing
 *   jumpable within 50 m before one.
 * - Gates telegraph the racing line: they sit in a free lane around each hazard.
 * - Pulse gates mark lane ±2 on the main road, at least 1.5 beats of base-speed travel apart,
 *   with nothing collidable within 25 m.
 * - Every module keeps its first 12 m clear: its start is a tether checkpoint.
 */

export const L = -2
export const C = 0
export const R = 2
export const ALL: readonly number[] = [L, C, R]
/** Two-lane fork path slots. */
export const SL = -1
export const SR = 1

export interface Placement {
  path?: Path
  tier?: Tier
}

export interface GateTemplate {
  type: 'gate'
  at: number
  lane: number
  kind: GateKind
  path: Path
}

export interface HazardTemplate {
  type: 'hazard'
  at: number
  kind: HazardKind
  lanes: readonly number[]
  period: number
  phase: number
  amplitude: number
  length: number
  path: Path
  minTier: Tier
}

export type ZoneType = 'ramp' | 'gap' | 'rail' | 'pad'
export interface ZoneTemplate {
  type: ZoneType
  at: number
  len: number
  lanes: readonly number[]
  path: Path
}

export interface SetPieceTemplate {
  type: 'set-piece'
  at: number
  kind: SetPieceKind
  len: number
}

export interface EventTemplate {
  type: 'event'
  kind: WorldEventKind
  at: number
  len: number
  lead: number
  duration: number
  lanes: readonly number[]
  period: number
  amplitude: number
  count: number
  path: Path
  minTier: Tier
}

/** Main-road edges from `at` to the next edge section or the module end. */
export interface EdgeTemplate {
  type: 'edges'
  at: number
  left: EdgeKind
  right: EdgeKind
}

export type FeatureTemplate = GateTemplate | HazardTemplate | ZoneTemplate | SetPieceTemplate | EventTemplate | EdgeTemplate

export interface ForkTemplate {
  from: number
  to: number
  safeLanes: LaneCount
  riskLanes: LaneCount
  safeEdges: { left: EdgeKind; right: EdgeKind }
  riskEdges: { left: EdgeKind; right: EdgeKind }
  separation: number
  label: 'relay-cut' | 'shortcut'
  /** Risk path progress, percent of the safe path's (> 100). */
  riskProgress: number
}

export interface PulseTemplate {
  from: number
  to: number
}

export interface ModuleTemplate {
  /** `${world}.${kind}.${variant}`; renderers key kit pieces off it. */
  id: string
  kind: ModuleKind
  length: number
  laneCount: LaneCount
  shoulder: number
  edges: { left: EdgeKind; right: EdgeKind }
  rise: number
  bend: number
  /** 0 for fixed route beats; 1 (calm) .. 3 (dense) for pool modules. */
  difficulty: 0 | 1 | 2 | 3
  features: readonly FeatureTemplate[]
  fork?: ForkTemplate
  pulse?: PulseTemplate
}

// ---------------------------------------------------------------------------
// Feature builders
// ---------------------------------------------------------------------------

type GatePoint = readonly [at: number, lane: number]

export function gates(points: readonly GatePoint[], kind: GateKind = 'gold', path: Path = 'main'): GateTemplate[] {
  return points.map(([at, lane]) => ({ type: 'gate', at, lane, kind, path }))
}

function zone(type: ZoneType, at: number, len: number, lanes: readonly number[], path: Path = 'main'): ZoneTemplate {
  return { type, at, len, lanes, path }
}

export const ramp = (at: number, len: number, lanes: readonly number[], path?: Path): ZoneTemplate => zone('ramp', at, len, lanes, path)
export const gap = (at: number, len: number, lanes: readonly number[], path?: Path): ZoneTemplate => zone('gap', at, len, lanes, path)
export const rail = (at: number, len: number, lanes: readonly number[], path?: Path): ZoneTemplate => zone('rail', at, len, lanes, path)
export const pad = (at: number, len: number, lanes: readonly number[], path?: Path): ZoneTemplate => zone('pad', at, len, lanes, path)

export function setPiece(at: number, kind: SetPieceKind, len: number): SetPieceTemplate {
  return { type: 'set-piece', at, kind, len }
}

export function edges(at: number, left: EdgeKind, right: EdgeKind = left): EdgeTemplate {
  return { type: 'edges', at, left, right }
}

interface HazardShape {
  lanes: readonly number[]
  period?: number
  phase?: number
  amplitude?: number
  length?: number
}

function hazard(kind: HazardKind, at: number, shape: HazardShape, placement: Placement): HazardTemplate {
  return {
    type: 'hazard',
    at,
    kind,
    lanes: shape.lanes,
    period: shape.period ?? 0,
    phase: shape.phase ?? 0,
    amplitude: shape.amplitude ?? 0,
    length: shape.length ?? 0,
    path: placement.path ?? 'main',
    minTier: placement.tier ?? 0,
  }
}

export const barrier = (at: number, lanes: readonly number[], o: Placement = {}): HazardTemplate => hazard('barrier', at, { lanes }, o)
export const beam = (at: number, lanes: readonly number[], o: Placement = {}): HazardTemplate => hazard('beam', at, { lanes }, o)

/** Low mover between the centres of `from` and `to`. */
export const sweeper = (at: number, from: number, to: number, period: number, phase: number, o: Placement = {}): HazardTemplate =>
  hazard('sweeper', at, { lanes: [from, to], period, phase }, o)

/** Head-height mover between the centres of `from` and `to`. */
export const drone = (at: number, from: number, to: number, period: number, phase: number, o: Placement = {}): HazardTemplate =>
  hazard('drone', at, { lanes: [from, to], period, phase }, o)

export const gust = (at: number, len: number, push: number, o: Placement = {}): HazardTemplate =>
  hazard('gust', at, { lanes: [], amplitude: push, length: len }, o)

interface EventShape {
  len: number
  lead: number
  duration: number
  lanes?: readonly number[]
  period?: number
  amplitude?: number
  count?: number
}

export function worldEvent(kind: WorldEventKind, at: number, shape: EventShape, placement: Placement = {}): EventTemplate {
  return {
    type: 'event',
    kind,
    at,
    len: shape.len,
    lead: shape.lead,
    duration: shape.duration,
    lanes: shape.lanes ?? [],
    period: shape.period ?? 0,
    amplitude: shape.amplitude ?? 0,
    count: shape.count ?? 0,
    path: placement.path ?? 'main',
    minTier: placement.tier ?? 0,
  }
}

/**
 * A hazard slot lets one layout carry different world identities: the shape decides
 * which lanes are dangerous, the world decides what the danger is.
 */
export type Slot = (at: number, lanes: readonly number[], o?: Placement) => HazardTemplate

/**
 * Where a mover swings: across the given lanes, or through a single lane from one side of it
 * to the other, which on a one-lane path leaves a moving gap to time.
 */
const spanOf = (lanes: readonly number[]): readonly [number, number] =>
  lanes.length === 1 ? [lanes[0]! - 2, lanes[0]! + 2] : [lanes[0]!, lanes[lanes.length - 1]!]

export const BARRIER: Slot = (at, lanes, o) => barrier(at, lanes, o)
export const BEAM: Slot = (at, lanes, o) => beam(at, lanes, o)
export const SWEEPER: Slot = (at, lanes, o) => sweeper(at, ...spanOf(lanes), 112, at % 112, o)
export const DRONE: Slot = (at, lanes, o) => drone(at, ...spanOf(lanes), 128, at % 128, o)

interface ModuleSize {
  length: number
  difficulty: ModuleTemplate['difficulty']
  rise?: number
  bend?: number
  laneCount?: LaneCount
  shoulder?: number
  edges?: EdgeKind | { left: EdgeKind; right: EdgeKind }
}

/** The standard shoulder in authoring decimetres. */
export const STANDARD_SHOULDER = Math.trunc(SHOULDER_WIDTH * 10 / ONE)

export function defineModule(id: string, kind: ModuleKind, size: ModuleSize, features: readonly FeatureTemplate[]): ModuleTemplate {
  const edgeSpec = size.edges ?? 'rail'
  return {
    id,
    kind,
    length: size.length,
    laneCount: size.laneCount ?? 3,
    shoulder: size.shoulder ?? STANDARD_SHOULDER,
    edges: typeof edgeSpec === 'string' ? { left: edgeSpec, right: edgeSpec } : edgeSpec,
    rise: size.rise ?? 0,
    bend: size.bend ?? 0,
    difficulty: size.difficulty,
    features,
  }
}

export interface ShapeOptions {
  rise?: number
  bend?: number
  edges?: EdgeKind
}

const shape = (o: ShapeOptions, bend: number, rise = 0): Pick<ModuleSize, 'rise' | 'bend' | 'edges'> => ({
  rise: o.rise ?? rise,
  bend: o.bend ?? bend,
  ...(o.edges ? { edges: o.edges } : {}),
})

// ---------------------------------------------------------------------------
// Pool shapes shared across worlds
// ---------------------------------------------------------------------------

export function straight(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'straight', { length: 130, difficulty: 1, ...shape(o, 0) }, [
    ...gates([[16, C], [34, L], [58, L], [80, R], [100, R], [122, C]]),
    a(46, [C, R]),
    b(92, [L, C], { tier: 1 }),
  ])
}

export function curve(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'curve', { length: 140, difficulty: 1, ...shape(o, 160) }, [
    ...gates([[14, C], [32, R], [52, R], [78, C], [100, L], [126, L]]),
    a(64, [L, C]),
    b(114, [C, R], { tier: 1 }),
  ])
}

export function climb(id: string, a: Slot, b: Slot, c: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'climb', { length: 150, difficulty: 2, ...shape(o, 0, 60) }, [
    ...gates([[14, C], [30, L], [54, L], [74, C], [96, R], [116, R], [140, C]]),
    a(42, [C, R]),
    b(84, [L]),
    c(128, [L, C], { tier: 2 }),
  ])
}

export function drop(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'drop', { length: 150, difficulty: 2, ...shape(o, 0, -80) }, [
    ...gates([[14, C], [44, C], [70, R], [92, R], [112, L], [140, L]]),
    ramp(24, 6, ALL),
    gap(34, 12, ALL),
    a(84, [L, C]),
    b(126, [C, R], { tier: 1 }),
  ])
}

export function rampRun(id: string, a: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'ramp-run', { length: 170, difficulty: 2, ...shape(o, 0) }, [
    ...gates([[14, C], [44, C], [70, R], [98, R], [128, C], [158, L]]),
    ramp(26, 6, ALL),
    gap(36, 12, ALL),
    // Optional kicker in the right lane: its gap is only under the kicker line.
    ramp(84, 6, [R]),
    gap(94, 10, [R]),
    a(148, [C, R]),
  ])
}

export function railRun(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'rail-run', { length: 140, difficulty: 1, ...shape(o, 0) }, [
    ...gates([[14, C], [30, L], [56, L], [82, L], [104, R], [128, R]]),
    rail(26, 60, [L]),
    a(58, [C, R]),
    b(116, [L, C]),
  ])
}

export function corridor(id: string, slots: readonly [Slot, Slot, Slot, Slot, Slot], o: ShapeOptions = {}): ModuleTemplate {
  const [s1, s2, s3, s4, s5] = slots
  return defineModule(id, 'hazard-corridor', { length: 160, difficulty: 3, ...shape(o, 0) }, [
    ...gates([[14, C], [20, R], [46, L], [74, R], [100, R], [132, L], [154, L]]),
    s1(30, [L, C]),
    s2(58, [C, R]),
    s3(88, [L, C]),
    s4(118, [C, R], { tier: 1 }),
    s5(146, [C, R], { tier: 2 }),
  ])
}

export function padRun(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'straight', { length: 140, difficulty: 1, ...shape(o, 0) }, [
    ...gates([[18, C], [36, C], [62, L], [88, R], [128, C]]),
    pad(14, 18, [C]),
    pad(80, 18, [R]),
    a(50, [C, R]),
    b(112, [L, C]),
  ])
}

export function gustCurve(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'curve', { length: 150, difficulty: 2, ...shape(o, -140) }, [
    ...gates([[22, L], [46, L], [64, L], [100, R], [124, R], [142, C]]),
    // The gold line holds the upwind lane while the gust shoves toward the hazard lanes.
    gust(20, 50, 45),
    gust(95, 40, -45),
    a(80, [C, R]),
    b(112, [L, C], { tier: 1 }),
  ])
}

export function sweeperField(id: string, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 160, difficulty: 3, ...shape(o, 0) }, [
    ...gates([[16, C], [52, C], [82, C], [112, C], [146, C]]),
    pad(14, 14, [C]),
    sweeper(36, L, C, 100, 0),
    sweeper(66, C, R, 100, 50),
    sweeper(96, L, C, 90, 20, { tier: 1 }),
    sweeper(126, C, R, 110, 70),
  ])
}

/** An exposed deck: open edges across the middle and a crosswind that punishes the shoulder. */
export function bridgeSpan(id: string, a: Slot, push: number, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'straight', { length: 170, difficulty: 2, ...shape(o, 60) }, [
    edges(30, 'open'),
    edges(140, 'rail'),
    ...gates([[14, C], [40, C], [66, L], [92, L], [124, C], [152, R]]),
    worldEvent('crosswind', 30, { len: 110, lead: 60, duration: 40, period: 150, amplitude: push }),
    a(106, [C, R]),
  ])
}

/** Walled tunnel with a drone formation stepping across the lanes. */
export function tunnelRun(id: string, a: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 160, difficulty: 2, ...shape(o, 0), edges: o.edges ?? 'wall' }, [
    ...gates([[14, C], [30, C], [84, C], [104, C], [140, L]]),
    worldEvent('drone-pattern', 56, { len: 24, lead: 80, duration: 30, lanes: ALL, count: 2, period: 45 }),
    a(120, [C, R]),
  ])
}

/**
 * Maintenance closes outer lanes for a stretch and the road narrows. The centre lane always
 * stays open: a courier knocked out of a closed lane keeps the lane it lands in, so a closure
 * over the centre would push hands-off couriers toward a fork's risk side.
 */
export function closureRun(id: string, closed: readonly (typeof L | typeof R)[], o: ShapeOptions = {}): ModuleTemplate {
  const open = closed.length === 2 ? C : -closed[0]!
  return defineModule(id, 'hazard-corridor', { length: 170, difficulty: 2, ...shape(o, 0) }, [
    ...gates([[14, C], [36, open], [62, open], [90, open], [116, open], [150, C]]),
    worldEvent('lane-closure', 50, { len: 70, lead: 80, duration: 50, lanes: closed }),
  ])
}

/** A transit vehicle crosses the road; its lanes at arrival depend on the courier's pace. */
export function crossingRun(id: string, a: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 160, difficulty: 2, ...shape(o, 0) }, [
    ...gates([[14, C], [34, C], [104, C], [128, R]]),
    worldEvent('transit-crossing', 70, { len: 12, lead: 100, duration: 250, lanes: [-6, 6] }),
    a(142, [L, C]),
  ])
}

/** An overhead gantry sags over two lanes, then collapses onto them. */
export function gantryRun(id: string, a: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 160, difficulty: 3, ...shape(o, 0) }, [
    ...gates([[14, C], [40, L], [64, L], [100, L], [140, C]]),
    worldEvent('collapsing-gantry', 80, { len: 8, lead: 90, duration: 120, lanes: [C, R] }),
    a(122, [L, C], { tier: 1 }),
  ])
}

/** A large machine drifts across the road from one shoulder to the other. */
export function maintenanceRun(id: string, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'straight', { length: 150, difficulty: 2, ...shape(o, 0) }, [
    ...gates([[14, C], [30, C], [96, C], [124, L]]),
    worldEvent('maintenance-drone', 60, { len: 10, lead: 90, duration: 220, lanes: [-5, 5] }),
  ])
}
