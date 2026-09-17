import {
  ALL,
  BARRIER,
  BEAM,
  C,
  DRONE,
  L,
  R,
  SL,
  SR,
  SWEEPER,
  barrier,
  bridgeSpan,
  climb,
  closureRun,
  corridor,
  crossingRun,
  curve,
  defineModule,
  drop,
  gantryRun,
  gap,
  gates,
  gust,
  gustCurve,
  maintenanceRun,
  pad,
  padRun,
  rail,
  railRun,
  ramp,
  rampRun,
  setPiece,
  straight,
  sweeperField,
  tunnelRun,
  worldEvent,
  type FeatureTemplate,
  type ForkTemplate,
  type ModuleTemplate,
  type Placement,
  type Slot,
} from './module-shapes'
import type { EdgeKind, SetPieceKind, World } from './types'

export type {
  EdgeTemplate,
  EventTemplate,
  FeatureTemplate,
  ForkTemplate,
  GateTemplate,
  HazardTemplate,
  ModuleTemplate,
  PulseTemplate,
  SetPieceTemplate,
  ZoneTemplate,
  ZoneType,
} from './module-shapes'

/**
 * Authored module templates for Relay Leg v6: the fixed route beats of every world
 * and the pool the composer draws the difficulty curve from. See module-shapes.ts for
 * units and layout rules.
 */

export interface WorldKit {
  opening: ModuleTemplate
  /** Major fork in the first half of the route. */
  fork: ModuleTemplate
  pulse: ModuleTemplate
  approach: ModuleTemplate
  /** Set-piece fork right before the finish: safe loop or relay cut. */
  finale: ModuleTemplate
  finish: ModuleTemplate
  pool: readonly ModuleTemplate[]
}

// ---------------------------------------------------------------------------
// Fixed route beats
// ---------------------------------------------------------------------------

/**
 * The teaching opening. The centre lane carries the gold line, one gate pair asks for a
 * lane change, a barrier in that lane asks for the change back, a full-width hurdle asks for
 * a jump, and the edges stay railed.
 */
function opening(world: World, extras: readonly FeatureTemplate[], rise = 0): ModuleTemplate {
  return defineModule(`${world}.opening.a`, 'opening', { length: 250, difficulty: 0, rise, shoulder: 12 }, [
    ...gates([[20, C], [45, C], [70, C]]),
    ...gates([[95, R], [120, R]]),
    barrier(150, [R]),
    ...gates([[172, C]]),
    barrier(205, ALL),
    ...gates([[226, C], [244, C]]),
    ...extras,
  ])
}

interface ForkSlots {
  safe: readonly [Slot, Slot, Slot]
  /** One-lane risk path: every threat is a jump, a slide or a moving gap to time. */
  risk: readonly [Slot, Slot, Slot, Slot, Slot]
  setPiece: SetPieceKind
  riskEdge: EdgeKind
}

const SAFE: Placement = { path: 'safe' }
const RISK: Placement = { path: 'risk' }

function forkSpec(label: ForkTemplate['label'], from: number, to: number, riskEdge: EdgeKind): ForkTemplate {
  return {
    from,
    to,
    safeLanes: 2,
    riskLanes: 1,
    safeEdges: { left: 'rail', right: 'rail' },
    riskEdges: { left: riskEdge, right: riskEdge },
    separation: label === 'relay-cut' ? 160 : 140,
    label,
    riskProgress: 130,
  }
}

/** Safe path: two lanes, a hazard every 60-65 m with the gold line in the other lane. */
function safeLoop(slots: readonly [Slot, Slot, Slot]): FeatureTemplate[] {
  const [a, b, c] = slots
  return [
    ...gates([[60, SL], [90, SR], [120, SR], [150, SL], [180, SL], [210, SR], [240, SR]], 'gold', 'safe'),
    a(102, [SL], SAFE),
    b(165, [SR], SAFE),
    c(226, [SL], { ...SAFE, tier: 1 }),
  ]
}

function fork(world: World, slots: ForkSlots): ModuleTemplate {
  const [riskA, riskB, riskC, riskD, riskE] = slots.risk
  return {
    ...defineModule(`${world}.fork.a`, 'fork', { length: 310, difficulty: 0 }, [
      ...gates([[16, C], [292, C]]),
      setPiece(40, slots.setPiece, 230),
      ...safeLoop(slots.safe),
      ramp(50, 6, [C], 'risk'),
      gap(60, 12, [C], 'risk'),
      ...gates([[46, C], [64, C], [104, C], [136, C], [166, C], [198, C], [236, C], [258, C]], 'gold', 'risk'),
      riskA(120, [C], RISK),
      riskB(150, [C], { ...RISK, tier: 1 }),
      riskC(182, [C], RISK),
      riskD(216, [C], { ...RISK, tier: 1 }),
      riskE(248, [C], { ...RISK, tier: 2 }),
    ]),
    fork: forkSpec('shortcut', 40, 270, slots.riskEdge),
  }
}

/**
 * Fork with a rising bridge: the safe deck lifts and routes around, the risk deck becomes a
 * launch ramp over a real gap that only clears at `threshold` mm/tick or faster.
 */
function risingFork(world: World, slots: Omit<ForkSlots, 'risk'> & { risk: readonly [Slot, Slot]; threshold: number }): ModuleTemplate {
  const [riskA, riskB] = slots.risk
  return {
    ...defineModule(`${world}.fork.rising`, 'fork', { length: 310, difficulty: 0 }, [
      ...gates([[16, C], [292, C]]),
      setPiece(40, slots.setPiece, 230),
      ...safeLoop(slots.safe),
      ...gates([[50, C], [66, C], [176, C], [204, C], [236, C]], 'gold', 'risk'),
      worldEvent('rising-bridge', 80, { len: 54, lead: 56, duration: 60, lanes: [C], amplitude: slots.threshold }, RISK),
      ramp(80, 8, [C], 'risk'),
      gap(94, 40, [C], 'risk'),
      riskA(222, [C], RISK),
      riskB(254, [C], { ...RISK, tier: 1 }),
    ]),
    fork: forkSpec('shortcut', 40, 270, slots.riskEdge),
  }
}

/**
 * Two runs of three pulse gates around one hazard inside a pulse tunnel. A pulse gate's lit
 * lane swaps sides on every 25-tick beat, so the courier reads the rhythm and arrives in the
 * lit lane.
 */
function pulse(world: World, slot: Slot, wall: EdgeKind): ModuleTemplate {
  return {
    ...defineModule(`${world}.pulse.a`, 'pulse', { length: 220, difficulty: 0, edges: wall }, [
      worldEvent('pulse-tunnel', 20, { len: 186, lead: 20, duration: 30, period: 25 }),
      ...gates([[30, R], [56, R], [82, R], [138, R], [164, R], [190, R]], 'pulse'),
      slot(110, [C]),
      pad(116, 12, [C]),
      pad(198, 8, [C]),
    ]),
    pulse: { from: 20, to: 206 },
  }
}

function approach(world: World, slot: Slot, extras: readonly FeatureTemplate[]): ModuleTemplate {
  return defineModule(`${world}.set-piece-approach.a`, 'set-piece-approach', { length: 100, difficulty: 0 }, [
    ...gates([[14, R], [36, C], [64, C], [88, C]]),
    slot(52, [L, C], { tier: 1 }),
    ...extras,
  ])
}

/**
 * The finale: SAFE LOOP (two railed lanes, the long way round) or RELAY CUT (one open lane
 * on the risk side: a ramp, then a real gap that clears only at `threshold` mm/tick or faster).
 */
function finale(world: World, piece: SetPieceKind, slots: readonly [Slot, Slot], threshold: number): ModuleTemplate {
  const [safeA, safeB] = slots
  return {
    ...defineModule(`${world}.set-piece.finale`, 'set-piece', { length: 260, difficulty: 0, rise: 20 }, [
      ...gates([[14, C], [246, C]]),
      setPiece(30, piece, 200),
      ...gates([[52, SL], [82, SR], [112, SR], [142, SL], [172, SL], [204, SR]], 'gold', 'safe'),
      safeA(97, [SL], SAFE),
      safeB(157, [SR], { ...SAFE, tier: 1 }),
      ...gates([[48, C], [62, C], [194, C], [214, C]], 'gold', 'risk'),
      worldEvent('bridge-break', 70, { len: 58, lead: 50, duration: 40, lanes: [C], amplitude: threshold }, RISK),
      ramp(70, 8, [C], 'risk'),
      gap(84, 44, [C], 'risk'),
    ]),
    fork: forkSpec('relay-cut', 30, 230, 'open'),
  }
}

function finish(world: World, extras: readonly FeatureTemplate[]): ModuleTemplate {
  return defineModule(`${world}.finish.a`, 'finish', { length: 120, difficulty: 0 }, [
    ...gates([[16, R], [40, C], [65, C], [90, C], [112, C]]),
    ...extras,
  ])
}

/** Relay cut thresholds: roughly 60% FLOW at base speed. */
const CUT_THRESHOLD = 640
/** Rising bridges ask for a little less: roughly 40% FLOW. */
const RISE_THRESHOLD = 580

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

/** Coast: bridges over the water, sea wind, cranes and the bridge-break finale. */
const COAST: WorldKit = {
  opening: opening('coast', [rail(24, 40, [C])]),
  fork: risingFork('coast', {
    safe: [BARRIER, DRONE, SWEEPER],
    risk: [BARRIER, BEAM],
    setPiece: 'suspension-bridge',
    riskEdge: 'open',
    threshold: RISE_THRESHOLD,
  }),
  pulse: pulse('coast', BARRIER, 'rail'),
  approach: approach('coast', BARRIER, [rail(60, 30, [C])]),
  finale: finale('coast', 'bridge-break', [BARRIER, DRONE], CUT_THRESHOLD),
  finish: finish('coast', [rail(55, 50, [C])]),
  pool: [
    straight('coast.straight.a', BARRIER, DRONE),
    curve('coast.curve.a', BARRIER, SWEEPER, { bend: 180 }),
    rampRun('coast.ramp-run.a', BARRIER),
    railRun('coast.rail-run.a', BARRIER, BEAM),
    climb('coast.climb.a', BEAM, BARRIER, DRONE, { rise: 40 }),
    drop('coast.drop.a', SWEEPER, BARRIER),
    gustCurve('coast.curve.gust', BARRIER, BEAM),
    corridor('coast.hazard-corridor.a', [BARRIER, BEAM, DRONE, SWEEPER, BARRIER]),
    bridgeSpan('coast.bridge.span', BARRIER, 40),
    closureRun('coast.hazard-corridor.closure', [L, R]),
    maintenanceRun('coast.straight.crane'),
    gantryRun('coast.hazard-corridor.gantry', BARRIER),
  ],
}

/** Metro: tunnels, trains crossing, security drones and signal gantries. */
const METRO: WorldKit = {
  opening: opening('metro', [rail(24, 40, [C])]),
  fork: fork('metro', {
    safe: [BARRIER, DRONE, BEAM],
    risk: [BARRIER, BEAM, SWEEPER, DRONE, BARRIER],
    setPiece: 'tunnel',
    riskEdge: 'wall',
  }),
  pulse: pulse('metro', DRONE, 'wall'),
  approach: approach('metro', DRONE, [rail(60, 30, [C])]),
  finale: finale('metro', 'skyline-jump', [BEAM, BARRIER], CUT_THRESHOLD),
  finish: finish('metro', [rail(55, 50, [C])]),
  pool: [
    railRun('metro.rail-run.a', BARRIER, BEAM),
    railRun('metro.rail-run.b', DRONE, BARRIER, { bend: 120 }),
    corridor('metro.hazard-corridor.a', [BEAM, BARRIER, DRONE, BARRIER, SWEEPER]),
    straight('metro.straight.a', BARRIER, BEAM, { edges: 'wall' }),
    curve('metro.curve.a', DRONE, BARRIER, { bend: -200 }),
    tunnelRun('metro.hazard-corridor.tunnel', BARRIER),
    crossingRun('metro.hazard-corridor.crossing', BARRIER),
    gantryRun('metro.hazard-corridor.signals', BEAM),
    closureRun('metro.hazard-corridor.closure', [R]),
  ],
}

/** Alpine: cliff roads, gaps, switchback climbs, mountain wind and snow ploughs. */
const ALPINE: WorldKit = {
  opening: opening('alpine', [], -40),
  fork: fork('alpine', {
    safe: [BARRIER, BEAM, SWEEPER],
    risk: [BARRIER, DRONE, BARRIER, BEAM, SWEEPER],
    setPiece: 'tunnel',
    riskEdge: 'open',
  }),
  pulse: pulse('alpine', SWEEPER, 'wall'),
  approach: approach('alpine', BARRIER, [gust(58, 30, -35)]),
  finale: finale('alpine', 'cliff-drop', [BARRIER, SWEEPER], CUT_THRESHOLD),
  finish: finish('alpine', []),
  pool: [
    climb('alpine.climb.a', BARRIER, BEAM, DRONE, { rise: 80 }),
    climb('alpine.climb.b', SWEEPER, BARRIER, BARRIER, { rise: 70, bend: 220 }),
    drop('alpine.drop.a', BARRIER, BEAM, { rise: -120 }),
    rampRun('alpine.ramp-run.a', BARRIER, { rise: -40 }),
    gustCurve('alpine.curve.gust', BARRIER, SWEEPER, { bend: 200 }),
    straight('alpine.straight.a', SWEEPER, BARRIER, { rise: -30 }),
    corridor('alpine.hazard-corridor.a', [BARRIER, BEAM, SWEEPER, DRONE, BARRIER]),
    bridgeSpan('alpine.bridge.cliff-road', BARRIER, -45, { rise: 30, bend: -160 }),
    closureRun('alpine.hazard-corridor.rockfall', [L]),
    maintenanceRun('alpine.straight.plough'),
  ],
}

/** Solar: turbine fields, sweeper arms, cleaning drones and boost pads across the array. */
const SOLAR: WorldKit = {
  opening: opening('solar', [pad(30, 24, [C])]),
  fork: fork('solar', {
    safe: [SWEEPER, BARRIER, DRONE],
    risk: [SWEEPER, DRONE, BEAM, BARRIER, SWEEPER],
    setPiece: 'turbine-field',
    riskEdge: 'rail',
  }),
  pulse: pulse('solar', SWEEPER, 'rail'),
  approach: approach('solar', SWEEPER, [pad(62, 30, [C])]),
  finale: finale('solar', 'turbine-field', [SWEEPER, BARRIER], CUT_THRESHOLD),
  finish: finish('solar', [pad(80, 30, [C])]),
  pool: [
    padRun('solar.straight.pads', SWEEPER, BARRIER),
    padRun('solar.straight.pads-b', DRONE, BEAM),
    sweeperField('solar.hazard-corridor.sweepers'),
    gustCurve('solar.curve.turbine', SWEEPER, BARRIER),
    curve('solar.curve.a', BARRIER, SWEEPER, { bend: 140 }),
    corridor('solar.hazard-corridor.a', [SWEEPER, BEAM, DRONE, SWEEPER, BARRIER]),
    tunnelRun('solar.hazard-corridor.drones', SWEEPER, { edges: 'rail' }),
    maintenanceRun('solar.straight.cleaner'),
    closureRun('solar.hazard-corridor.closure', [L, R]),
  ],
}

/** Ocean: open-water gaps, squalls, ferries crossing and drones over the swell. */
const OCEAN: WorldKit = {
  opening: opening('ocean', [pad(28, 16, [C])]),
  fork: risingFork('ocean', {
    safe: [DRONE, BARRIER, SWEEPER],
    risk: [DRONE, BARRIER],
    setPiece: 'wave-arch',
    riskEdge: 'open',
    threshold: RISE_THRESHOLD,
  }),
  pulse: pulse('ocean', DRONE, 'rail'),
  approach: approach('ocean', DRONE, [pad(62, 30, [C])]),
  finale: finale('ocean', 'wave-arch', [DRONE, BARRIER], CUT_THRESHOLD),
  finish: finish('ocean', [pad(80, 30, [C])]),
  pool: [
    drop('ocean.drop.a', DRONE, BARRIER, { rise: -60 }),
    rampRun('ocean.ramp-run.a', DRONE),
    rampRun('ocean.ramp-run.b', BARRIER, { bend: 120 }),
    straight('ocean.straight.a', BEAM, DRONE),
    curve('ocean.curve.a', SWEEPER, DRONE, { bend: -160 }),
    gustCurve('ocean.curve.squall', DRONE, BARRIER),
    bridgeSpan('ocean.bridge.causeway', DRONE, 45),
    crossingRun('ocean.hazard-corridor.ferry', DRONE),
    tunnelRun('ocean.hazard-corridor.drones', BARRIER, { edges: 'rail' }),
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
  return [kit.opening, kit.fork, kit.pulse, kit.approach, kit.finale, kit.finish, ...kit.pool]
}
