import type { GateKind, HazardKind, ModuleKind, Path, SetPieceKind, Tier, World } from './types'

/**
 * Authored module templates for Relay Leg v5.
 *
 * Every number here is an integer in authoring units, converted to Q16.16 by
 * track.ts:
 * - `at`, `len`, `length`: metres from the start of the module
 * - `x`: percent of the owning path's half-width (-100..100, 0 = centre line)
 * - `half`, `halfWidth`, `rise`: decimetres
 * - `bend`: milli-radians per 100 m (presentation only)
 * - mover `amplitude`: percent of the path half-width; gust `amplitude`: millimetres per tick
 * - `period`, `phase`: ticks
 *
 * Layout rules (track.ts enforces the fairness ones again across module
 * boundaries, content.test.ts checks all of them):
 * - Collidable hazards inside a module sit at least 30 m apart when visible on
 *   tier 0 and at least 18 m apart otherwise.
 * - Every gap has a ramp ending 4-10 m before it on the same path.
 * - Nothing collidable sits within 50 m after a ramp and no beam within 90 m
 *   (a courier in the air cannot slide). Nothing you would jump (barrier,
 *   sweeper) sits within 50 m before a ramp, or the jump would carry the
 *   courier past the ramp and into its gap.
 * - Gates telegraph the racing line: the gates around a lane hazard sit in the
 *   opposite lane, so following the gold line avoids the hazard.
 * - Roughly one gate per 25 m, so FLOW has to be earned rather than soaked up.
 */

/** Hazard `half` placeholder meaning "span the whole path half-width". */
export const SPAN = -1

export interface GateTemplate {
  type: 'gate'
  at: number
  x: number
  kind: GateKind
  path: Path
}

export interface HazardTemplate {
  type: 'hazard'
  at: number
  kind: HazardKind
  x: number
  half: number
  period: number
  phase: number
  amplitude: number
  length: number
  path: Path
  /** Lowest tier on which this hazard appears. */
  minTier: Tier
}

export type ZoneType = 'ramp' | 'gap' | 'rail' | 'pad'
export interface ZoneTemplate {
  type: ZoneType
  at: number
  len: number
  x: number
  half: number
  path: Path
}

export interface SetPieceTemplate {
  type: 'set-piece'
  at: number
  kind: SetPieceKind
  len: number
}

export type FeatureTemplate = GateTemplate | HazardTemplate | ZoneTemplate | SetPieceTemplate

export interface ForkTemplate {
  from: number
  to: number
  safeHalfWidth: number
  riskHalfWidth: number
  separation: number
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
  halfWidth: number
  rise: number
  bend: number
  /** 0 for fixed route beats; 1 (calm) .. 3 (dense) for pool modules. */
  difficulty: 0 | 1 | 2 | 3
  features: readonly FeatureTemplate[]
  fork?: ForkTemplate
  pulse?: PulseTemplate
}

export interface WorldKit {
  opening: ModuleTemplate
  fork: ModuleTemplate
  pulse: ModuleTemplate
  approach: ModuleTemplate
  setPiece: ModuleTemplate
  finish: ModuleTemplate
  /** Pool the composer draws the difficulty curve from. */
  pool: readonly ModuleTemplate[]
}

interface Placement {
  path?: Path
  tier?: Tier
}

type GatePoint = readonly [at: number, x: number]

function gates(points: readonly GatePoint[], kind: GateKind = 'gold', path: Path = 'main'): GateTemplate[] {
  return points.map(([at, x]) => ({ type: 'gate', at, x, kind, path }))
}

function zone(type: ZoneType, at: number, len: number, x: number, half: number, path: Path = 'main'): ZoneTemplate {
  return { type, at, len, x, half, path }
}

const ramp = (at: number, len: number, x: number, half: number, path?: Path): ZoneTemplate => zone('ramp', at, len, x, half, path)
const gap = (at: number, len: number, x: number, half: number, path?: Path): ZoneTemplate => zone('gap', at, len, x, half, path)
const rail = (at: number, len: number, x: number, half: number, path?: Path): ZoneTemplate => zone('rail', at, len, x, half, path)
const pad = (at: number, len: number, x: number, half: number, path?: Path): ZoneTemplate => zone('pad', at, len, x, half, path)

function setPiece(at: number, kind: SetPieceKind, len: number): SetPieceTemplate {
  return { type: 'set-piece', at, kind, len }
}

interface HazardShape {
  x: number
  half: number
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
    x: shape.x,
    half: shape.half,
    period: shape.period ?? 0,
    phase: shape.phase ?? 0,
    amplitude: shape.amplitude ?? 0,
    length: shape.length ?? 0,
    path: placement.path ?? 'main',
    minTier: placement.tier ?? 0,
  }
}

const barrier = (at: number, x: number, o: Placement = {}): HazardTemplate =>
  hazard('barrier', at, { x, half: 14 }, o)

const beam = (at: number, o: Placement = {}): HazardTemplate =>
  hazard('beam', at, { x: 0, half: SPAN }, o)

const sweeper = (at: number, amplitude: number, period: number, phase: number, o: Placement = {}): HazardTemplate =>
  hazard('sweeper', at, { x: 0, half: 8, amplitude, period, phase }, o)

const drone = (at: number, x: number, amplitude: number, period: number, phase: number, o: Placement = {}): HazardTemplate =>
  hazard('drone', at, { x, half: 10, amplitude, period, phase }, o)

/** `x` is the divider between the two door panels. */
const door = (at: number, x: number, period: number, phase: number, o: Placement = {}): HazardTemplate =>
  hazard('door', at, { x, half: 3, period, phase }, o)

/** `x` is the line between the track half the train occupies and the free half. */
const train = (at: number, x: number, period: number, phase: number, o: Placement = {}): HazardTemplate =>
  hazard('train', at, { x, half: SPAN, period, phase }, o)

const gust = (at: number, len: number, push: number, o: Placement = {}): HazardTemplate =>
  hazard('gust', at, { x: 0, half: SPAN, amplitude: push, length: len }, o)

/**
 * A hazard slot lets one layout carry different world identities: the shape
 * decides where the threat sits (`lane`, percent of half-width), the world
 * decides what it is.
 */
type Slot = (at: number, lane: number, o?: Placement) => HazardTemplate

const BARRIER: Slot = (at, lane, o) => barrier(at, lane, o)
const BEAM: Slot = (at, _lane, o) => beam(at, o)
const SWEEPER: Slot = (at, _lane, o) => sweeper(at, 60, 112, at % 112, o)
const DRONE: Slot = (at, lane, o) => drone(at, Math.trunc(lane / 2), 30, 128, at % 128, o)
/** Dividers sit off-centre, away from the slot's lane, so one side is the wide side. */
const dividerFor = (lane: number): number => (lane > 0 ? -20 : 20)
const DOOR: Slot = (at, lane, o) => door(at, dividerFor(lane), 132, at % 132, o)
const TRAIN: Slot = (at, lane, o) => train(at, dividerFor(lane), 176, at % 176, o)

function defineModule(
  id: string,
  kind: ModuleKind,
  size: { length: number; halfWidth: number; rise?: number; bend?: number; difficulty: ModuleTemplate['difficulty'] },
  features: readonly FeatureTemplate[],
): ModuleTemplate {
  return {
    id,
    kind,
    length: size.length,
    halfWidth: size.halfWidth,
    rise: size.rise ?? 0,
    bend: size.bend ?? 0,
    difficulty: size.difficulty,
    features,
  }
}

// ---------------------------------------------------------------------------
// Pool shapes shared across worlds. Worlds differ in which shapes they use and
// which hazard slots they plug in.
// ---------------------------------------------------------------------------

interface ShapeOptions {
  halfWidth?: number
  rise?: number
  bend?: number
}

function straight(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'straight', { length: 130, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 1 }, [
    ...gates([[14, 0], [36, -40], [62, -40], [86, 20], [98, 40], [122, 40]]),
    a(50, 45),
    b(110, -45, { tier: 1 }),
  ])
}

function curve(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'curve', { length: 140, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 160, difficulty: 1 }, [
    ...gates([[12, -25], [32, -50], [50, -50], [80, -30], [104, 30], [128, 40]]),
    a(65, 50),
    b(116, -40, { tier: 1 }),
  ])
}

function climb(id: string, a: Slot, b: Slot, c: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'climb', { length: 150, halfWidth: o.halfWidth ?? 42, rise: o.rise ?? 60, bend: o.bend ?? 0, difficulty: 2 }, [
    ...gates([[12, 0], [34, -35], [64, 35], [80, 35], [102, 0], [120, -35], [140, -40]]),
    a(50, 0),
    b(90, -50),
    c(126, 40, { tier: 2 }),
  ])
}

function drop(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'drop', { length: 150, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? -80, bend: o.bend ?? 0, difficulty: 2 }, [
    ...gates([[10, 0], [40, 0], [70, -35], [88, -35], [106, -20], [124, 35], [146, 30]]),
    ramp(26, 6, 0, 30),
    gap(36, 12, 0, 60),
    a(95, 40),
    b(132, -40, { tier: 1 }),
  ])
}

function rampRun(id: string, a: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'ramp-run', { length: 170, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 2 }, [
    ...gates([[12, -20], [44, 0], [70, 45], [98, 50], [128, 0], [160, 30]]),
    ramp(28, 6, 0, 32),
    gap(38, 12, 0, 60),
    // Optional kicker in the right lane: its gap is only under the kicker line.
    ramp(84, 6, 50, 16),
    gap(94, 10, 55, 20),
    a(150, -40),
  ])
}

function railRun(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'rail-run', { length: 140, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 1 }, [
    ...gates([[12, 0], [34, -50], [58, -50], [82, -50], [98, -30], [124, 30]]),
    rail(28, 60, -50, 12),
    a(58, 45),
    b(108, 0),
  ])
}

function corridor(id: string, slots: readonly [Slot, Slot, Slot, Slot, Slot], o: ShapeOptions = {}): ModuleTemplate {
  const [s1, s2, s3, s4, s5] = slots
  return defineModule(id, 'hazard-corridor', { length: 160, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 3 }, [
    ...gates([[10, 0], [18, 40], [48, -40], [78, 45], [98, 45], [138, -40], [156, -30]]),
    s1(28, -40),
    s2(58, 40),
    s3(88, 0),
    s4(118, -40, { tier: 1 }),
    s5(148, 40, { tier: 2 }),
  ])
}

function padRun(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'straight', { length: 140, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 1 }, [
    ...gates([[20, 0], [36, 0], [64, 40], [90, -40], [130, -20]]),
    pad(16, 18, 0, 14),
    pad(84, 18, -40, 14),
    a(50, 0),
    b(118, 40),
  ])
}

function gustCurve(id: string, a: Slot, b: Slot, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'curve', { length: 150, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? -140, difficulty: 2 }, [
    ...gates([[26, -40], [50, -40], [62, -40], [100, 40], [124, 40], [142, 0]]),
    // The gold line holds the upwind lane while the gust shoves towards the hazard lane.
    gust(20, 50, 45),
    gust(95, 40, -45),
    a(80, 45),
    b(115, -45, { tier: 1 }),
  ])
}

function trainCrossing(id: string, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 150, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 2 }, [
    ...gates([[16, 0], [60, 40], [104, -40], [145, 0]]),
    rail(0, 20, 0, 12),
    train(45, 20, 180, 30),
    door(90, -20, 120, 10),
    train(135, 15, 150, 90, { tier: 1 }),
  ])
}

function waveDoors(id: string, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 150, halfWidth: o.halfWidth ?? 42, rise: o.rise ?? 0, bend: o.bend ?? 90, difficulty: 2 }, [
    ...gates([[16, 0], [60, 0], [100, 0], [140, 0]]),
    door(40, -15, 150, 20),
    door(80, 20, 130, 75),
    drone(120, 0, 35, 120, 0, { tier: 1 }),
  ])
}

function sweeperField(id: string, o: ShapeOptions = {}): ModuleTemplate {
  return defineModule(id, 'hazard-corridor', { length: 160, halfWidth: o.halfWidth ?? 45, rise: o.rise ?? 0, bend: o.bend ?? 0, difficulty: 3 }, [
    ...gates([[16, 0], [50, 0], [80, 0], [110, 0], [146, 0]]),
    pad(8, 14, 0, 14),
    sweeper(35, 60, 100, 0),
    sweeper(65, 60, 100, 50),
    sweeper(95, 55, 90, 20, { tier: 1 }),
    sweeper(125, 65, 110, 70),
  ])
}

// ---------------------------------------------------------------------------
// Fixed route beats. Each world gets its own variant of every beat.
// ---------------------------------------------------------------------------

function opening(world: World, extras: readonly FeatureTemplate[], rise = 0): ModuleTemplate {
  return defineModule(`${world}.opening.a`, 'opening', { length: 230, halfWidth: 45, rise, difficulty: 0 }, [
    // Steering lesson: a slow S through the first 160 m, no hazards.
    ...gates([[20, 0], [40, 30], [60, 40], [80, 20], [100, -20], [120, -40], [140, -30], [158, 0]]),
    // First telegraphed jump: the centre ramp carries the courier over a full-width gap.
    ramp(166, 6, 0, 30),
    gap(176, 10, 0, 60),
    ...gates([[182, 0], [204, 35], [222, 40]]),
    barrier(226, -40),
    ...extras,
  ])
}

interface ForkSlots {
  safe: readonly [Slot, Slot, Slot]
  /** Slots at 120, 150, 180, 215 and 250 m, all clear of the risk ramp's landing (beams included). */
  risk: readonly [Slot, Slot, Slot, Slot, Slot]
  setPiece: SetPieceKind
}

function fork(world: World, slots: ForkSlots): ModuleTemplate {
  const [safeA, safeB, safeC] = slots.safe
  const [riskA, riskB, riskC, riskD, riskE] = slots.risk
  const safe: Placement = { path: 'safe' }
  const risk: Placement = { path: 'risk' }
  return {
    ...defineModule(`${world}.fork.a`, 'fork', { length: 310, halfWidth: 45, difficulty: 0 }, [
      ...gates([[14, 0], [292, 0]]),
      setPiece(40, slots.setPiece, 230),
      // Safe path: wide and calm, one hazard every 60-75 m.
      ...gates([[60, 0], [90, -30], [120, -30], [150, 0], [180, 30], [210, 30], [240, 0]], 'gold', 'safe'),
      safeA(100, 45, safe),
      safeB(175, -45, safe),
      safeC(235, -45, { ...safe, tier: 1 }),
      // Risk path: narrow, an early jump, then a hazard every 30-35 m with the gold line weaving through.
      ramp(50, 6, 0, 30, 'risk'),
      gap(60, 12, 0, 60, 'risk'),
      ...gates([
        [46, 0], [64, 0], [110, -45], [128, -45], [142, 45], [158, 45],
        [172, -40], [188, -40], [206, 40], [224, 40], [242, -40], [258, -40],
      ], 'gold', 'risk'),
      riskA(120, 45, risk),
      riskB(150, -45, { ...risk, tier: 1 }),
      riskC(180, 45, risk),
      riskD(215, -45, { ...risk, tier: 1 }),
      riskE(250, 45, { ...risk, tier: 2 }),
    ]),
    fork: { from: 40, to: 270, safeHalfWidth: 50, riskHalfWidth: 28, separation: 140 },
  }
}

function pulse(world: World, a: Slot, b: Slot): ModuleTemplate {
  return {
    ...defineModule(`${world}.pulse.a`, 'pulse', { length: 210, halfWidth: 45, difficulty: 0 }, [
      ...gates([[28, 0], [46, 30], [64, 45], [100, 0], [118, -30], [136, -45], [172, 0], [190, 0]], 'pulse'),
      pad(36, 12, 15, 16),
      pad(108, 12, -15, 16),
      pad(160, 12, -20, 16),
      a(80, -45),
      b(150, 45),
    ]),
    pulse: { from: 20, to: 196 },
  }
}

function approach(world: World, slot: Slot, extras: readonly FeatureTemplate[]): ModuleTemplate {
  return defineModule(`${world}.set-piece-approach.a`, 'set-piece-approach', { length: 100, halfWidth: 45, difficulty: 0 }, [
    ...gates([[12, 40], [36, 0], [64, 0], [88, 0]]),
    slot(52, -45, { tier: 1 }),
    ...extras,
  ])
}

function finish(world: World, extras: readonly FeatureTemplate[]): ModuleTemplate {
  return defineModule(`${world}.finish.a`, 'finish', { length: 120, halfWidth: 45, difficulty: 0 }, [
    ...gates([[15, 40], [40, 20], [65, 0], [90, 0], [112, 0]]),
    ...extras,
  ])
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

/** Coast: bridges, ramps and rails over the water; sea wind and cranes. */
const COAST: WorldKit = {
  opening: opening('coast', [rail(104, 36, -40, 12)]),
  fork: fork('coast', {
    safe: [BARRIER, DRONE, SWEEPER],
    risk: [BARRIER, DRONE, BEAM, SWEEPER, DOOR],
    setPiece: 'skyline-jump',
  }),
  pulse: pulse('coast', BARRIER, DRONE),
  approach: approach('coast', BARRIER, [rail(60, 36, 0, 12)]),
  setPiece: defineModule('coast.set-piece.bridge', 'set-piece', { length: 160, halfWidth: 32, rise: 20, difficulty: 0 }, [
    setPiece(0, 'suspension-bridge', 160),
    ...gates([[20, 0], [55, -40], [80, -40], [125, 0], [150, 0]]),
    rail(50, 40, -45, 10),
    beam(40),
    barrier(78, 45, { tier: 1 }),
    beam(110),
  ]),
  finish: finish('coast', [rail(55, 50, 0, 12)]),
  pool: [
    straight('coast.straight.a', BARRIER, DRONE),
    curve('coast.curve.a', BARRIER, SWEEPER, { bend: 180 }),
    rampRun('coast.ramp-run.a', BARRIER),
    rampRun('coast.ramp-run.b', DRONE, { bend: -90 }),
    railRun('coast.rail-run.a', BARRIER, DOOR),
    climb('coast.climb.a', BEAM, BARRIER, DRONE, { rise: 40 }),
    drop('coast.drop.a', SWEEPER, BARRIER),
    gustCurve('coast.curve.gust', BARRIER, BEAM),
    corridor('coast.hazard-corridor.a', [BARRIER, BEAM, DRONE, SWEEPER, BARRIER]),
  ],
}

/** Metro: transit lines, platform doors, rails and tunnels. */
const METRO: WorldKit = {
  opening: opening('metro', [rail(50, 30, 40, 12)]),
  fork: fork('metro', {
    safe: [BARRIER, DOOR, DRONE],
    risk: [TRAIN, BARRIER, DOOR, BEAM, DRONE],
    setPiece: 'tunnel',
  }),
  pulse: pulse('metro', BARRIER, DOOR),
  approach: approach('metro', DRONE, [rail(60, 36, 0, 12)]),
  setPiece: defineModule('metro.set-piece.crossing', 'set-piece', { length: 160, halfWidth: 45, difficulty: 0 }, [
    setPiece(20, 'transit-crossing', 110),
    ...gates([[15, 0], [55, 0], [85, 0], [125, 20], [148, 0]]),
    train(40, -20, 170, 0),
    door(70, 20, 120, 40, { tier: 1 }),
    train(100, -15, 140, 70),
  ]),
  finish: finish('metro', [rail(55, 50, 0, 12)]),
  pool: [
    railRun('metro.rail-run.a', BARRIER, TRAIN),
    railRun('metro.rail-run.b', DRONE, DOOR, { bend: 120 }),
    trainCrossing('metro.hazard-corridor.trains'),
    corridor('metro.hazard-corridor.a', [BEAM, DOOR, BARRIER, DRONE, TRAIN]),
    straight('metro.straight.a', BARRIER, BEAM),
    curve('metro.curve.a', DRONE, BARRIER, { bend: -200 }),
    climb('metro.climb.a', SWEEPER, BEAM, BARRIER, { rise: 50 }),
  ],
}

/** Alpine: cliff drops, gaps, switchback climbs and mountain gusts. */
const ALPINE: WorldKit = {
  opening: opening('alpine', [], -40),
  fork: fork('alpine', {
    safe: [BARRIER, BEAM, SWEEPER],
    risk: [BARRIER, DRONE, SWEEPER, BEAM, BARRIER],
    setPiece: 'tunnel',
  }),
  pulse: pulse('alpine', BARRIER, SWEEPER),
  approach: approach('alpine', BARRIER, [gust(56, 40, -35)]),
  setPiece: defineModule('alpine.set-piece.cliff', 'set-piece', { length: 160, halfWidth: 45, rise: -140, difficulty: 0 }, [
    setPiece(20, 'cliff-drop', 60),
    ramp(24, 8, 0, 40),
    gap(36, 16, 0, 60),
    ...gates([[12, 0], [48, 0], [100, -40], [124, -20], [150, 0]]),
    gust(90, 40, 40),
    barrier(104, 45),
    beam(140, { tier: 1 }),
  ]),
  finish: finish('alpine', []),
  pool: [
    climb('alpine.climb.a', BARRIER, BEAM, DRONE, { rise: 80 }),
    climb('alpine.climb.b', SWEEPER, BARRIER, BARRIER, { rise: 70, bend: 220 }),
    drop('alpine.drop.a', BARRIER, BEAM, { rise: -120 }),
    rampRun('alpine.ramp-run.a', BARRIER, { rise: -40 }),
    gustCurve('alpine.curve.gust', BARRIER, SWEEPER, { bend: 200 }),
    straight('alpine.straight.a', DOOR, BARRIER, { rise: -30 }),
    curve('alpine.curve.a', DRONE, BARRIER, { rise: 30, bend: -180 }),
    corridor('alpine.hazard-corridor.a', [BARRIER, BEAM, SWEEPER, DRONE, BARRIER]),
  ],
}

/** Solar: turbine fields, sweeper arms and boost pads across the array. */
const SOLAR: WorldKit = {
  opening: opening('solar', [pad(30, 24, 30, 14)]),
  fork: fork('solar', {
    safe: [SWEEPER, BARRIER, DRONE],
    risk: [SWEEPER, DRONE, BEAM, DOOR, SWEEPER],
    setPiece: 'skyline-jump',
  }),
  pulse: pulse('solar', SWEEPER, BARRIER),
  approach: approach('solar', SWEEPER, [pad(60, 36, 0, 14)]),
  setPiece: defineModule('solar.set-piece.turbines', 'set-piece', { length: 160, halfWidth: 45, difficulty: 0 }, [
    setPiece(0, 'turbine-field', 160),
    gust(12, 36, 50),
    gust(84, 36, -50),
    sweeper(40, 60, 110, 0),
    sweeper(80, 60, 110, 55, { tier: 1 }),
    sweeper(120, 65, 96, 20),
    pad(132, 20, 0, 16),
    ...gates([[10, 0], [26, -35], [60, 0], [100, 35], [140, 0]]),
  ]),
  finish: finish('solar', [pad(80, 30, 0, 16)]),
  pool: [
    padRun('solar.straight.pads', SWEEPER, BARRIER),
    padRun('solar.straight.pads-b', DRONE, BEAM),
    sweeperField('solar.hazard-corridor.sweepers'),
    gustCurve('solar.curve.turbine', SWEEPER, BARRIER),
    straight('solar.straight.a', DOOR, SWEEPER),
    curve('solar.curve.a', BARRIER, SWEEPER, { bend: 140 }),
    corridor('solar.hazard-corridor.a', [SWEEPER, BEAM, DRONE, SWEEPER, BARRIER]),
  ],
}

/** Ocean: wave doors, open-water gaps and drones over the swell. */
const OCEAN: WorldKit = {
  opening: opening('ocean', [pad(92, 16, -20, 14)]),
  fork: fork('ocean', {
    safe: [DRONE, BARRIER, DOOR],
    risk: [DOOR, DRONE, BARRIER, BEAM, SWEEPER],
    setPiece: 'tunnel',
  }),
  pulse: pulse('ocean', DRONE, BARRIER),
  approach: approach('ocean', DRONE, [pad(60, 36, 0, 14)]),
  setPiece: defineModule('ocean.set-piece.wave', 'set-piece', { length: 160, halfWidth: 42, difficulty: 0 }, [
    setPiece(30, 'wave-arch', 100),
    door(45, 20, 150, 0),
    drone(75, 0, 35, 120, 0, { tier: 1 }),
    door(105, -20, 130, 30),
    ramp(125, 6, 0, 30),
    gap(135, 12, 0, 60),
    ...gates([[15, 0], [60, 0], [90, 0], [118, 0], [142, 0]]),
  ]),
  finish: finish('ocean', [pad(80, 30, 0, 16)]),
  pool: [
    waveDoors('ocean.hazard-corridor.waves'),
    drop('ocean.drop.a', DRONE, BARRIER, { rise: -60 }),
    rampRun('ocean.ramp-run.a', DRONE),
    rampRun('ocean.ramp-run.b', BARRIER, { bend: 120 }),
    straight('ocean.straight.a', BEAM, DRONE),
    curve('ocean.curve.a', SWEEPER, DRONE, { bend: -160 }),
    gustCurve('ocean.curve.squall', DRONE, BARRIER),
    corridor('ocean.hazard-corridor.a', [DOOR, DRONE, BEAM, BARRIER, SWEEPER]),
  ],
}

export const WORLD_KITS: Readonly<Record<World, WorldKit>> = {
  coast: COAST,
  metro: METRO,
  alpine: ALPINE,
  solar: SOLAR,
  ocean: OCEAN,
}

/** Every template of a world, fixed beats first. */
export function worldTemplates(world: World): readonly ModuleTemplate[] {
  const kit = WORLD_KITS[world]
  return [kit.opening, kit.fork, kit.pulse, kit.approach, kit.setPiece, kit.finish, ...kit.pool]
}
