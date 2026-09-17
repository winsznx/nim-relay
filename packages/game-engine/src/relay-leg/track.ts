import { ONE } from '../fixed-point'
import { seedState, splitmix64 } from '../prng'
import { LANE_WIDTH } from './constants'
import { WORLD_KITS, type WorldKit } from './modules'
import type { EdgeTemplate, EventTemplate, FeatureTemplate, HazardTemplate, ModuleTemplate, ZoneTemplate } from './module-shapes'
import type {
  Checkpoint,
  Config,
  EdgeKind,
  Fork,
  Gate,
  Hazard,
  LaneCount,
  Path,
  PulseSection,
  Segment,
  SetPiece,
  Tier,
  Track,
  WorldEvent,
  Zone,
} from './types'

export type TrackConfig = Pick<Config, 'seed' | 'world' | 'tier'>

/** Route length bounds in whole metres. */
export const ROUTE_MIN_METRES = 1600
export const ROUTE_MAX_METRES = 1800

/**
 * Ticks per beat: 144 BPM at 60 Hz is exactly 25. Beat 0 is tick 0 of every leg (no
 * per-route phase), so race music time-stretched to 144 BPM stays locked to `onBeat` and
 * `pulseGateLane`.
 */
export const PULSE_PERIOD = 25
/** Ticks after each beat that still count as on the beat for boost pads and beat visuals. */
export const PULSE_WINDOW = 8

/** Minimum distance between collidable hazards on connected paths, metres, by tier. */
export const HAZARD_SPACING_METRES: Readonly<Record<Tier, number>> = { 0: 30, 1: 18, 2: 18 }
/** No collidable hazard from this many metres before a ramp... */
export const RAMP_CLEAR_BEFORE_METRES = 10
/** ...and nothing you would jump this close: the jump would carry the courier past the ramp. */
export const RAMP_JUMPABLE_CLEAR_BEFORE_METRES = 50
/** ...until this many metres after it (the courier is airborne and committed). */
export const RAMP_CLEAR_AFTER_METRES = 50
/** Overhead obstacles need a slide, which is impossible in the air. */
export const RAMP_OVERHEAD_CLEAR_AFTER_METRES = 90
/** Nothing collidable within this many metres of a pulse gate: the intercept needs a clean run-up. */
export const PULSE_GATE_CLEAR_METRES = 25
/** Hazards keep this far from world events so each threat reads on its own. */
export const EVENT_CLEAR_METRES = 25
/** Tier 0 railings: no open edge starts before this distance. */
export const TIER0_PROTECTED_METRES = 400

/** Pool modules threaded between the fixed beats of every route. */
const POOL_PICKS = 3
const RISK_PROGRESS_TIER_BONUS: Readonly<Record<Tier, number>> = { 0: 0, 1: 0, 2: 5 }
const HANDOFF_LENGTH_METRES = 30
const PATH_ORDER: Readonly<Record<Path, number>> = { main: 0, safe: 1, risk: 2 }

const metres = (m: number): number => m * ONE
const decimetres = (dm: number): number => Math.trunc(dm * ONE / 10)

interface Rng {
  state: bigint
}

function nextInt(rng: Rng, bound: number): number {
  const result = splitmix64(rng.state)
  rng.state = result.state
  return Number(result.value % BigInt(bound))
}

export function buildTrack(config: TrackConfig): Track {
  const rng: Rng = { state: seedState(`relay-leg-v6:${config.world}:${config.tier}:${config.seed}`) }
  const kit = WORLD_KITS[config.world]
  const layout = planLayout(kit, config.tier, rng)
  return assemble(config, layout, rng)
}

// ---------------------------------------------------------------------------
// Layout: which modules, in which order
// ---------------------------------------------------------------------------

function planLayout(kit: WorldKit, tier: Tier, rng: Rng): readonly ModuleTemplate[] {
  const picks = pickPoolModules(kit.pool, POOL_PICKS, tier, rng)
  const valid = arrangements(kit, picks).filter(isValidLayout)
  // Three pool modules of 130-170 m, at least one before the fork and one before the pulse, always fit.
  if (valid.length === 0) throw new Error('relay-leg: no valid layout')
  return valid[nextInt(rng, valid.length)]!
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
  const layouts: ModuleTemplate[][] = []
  const n = picks.length
  for (let a = 0; a <= n; a++) {
    for (let b = 0; a + b <= n; b++) {
      layouts.push([
        kit.opening,
        ...picks.slice(0, a),
        kit.fork,
        ...picks.slice(a, a + b),
        kit.pulse,
        ...picks.slice(a + b),
        kit.approach,
        kit.finale,
        kit.finish,
      ])
    }
  }
  return layouts
}

/** Major fork starting after a quarter of the route and ending before 60%, pulse in the second half. */
function isValidLayout(layout: readonly ModuleTemplate[]): boolean {
  let length = 0
  let forkFrom = -1
  let forkTo = -1
  let pulseFrom = -1
  for (const template of layout) {
    if (template.fork && forkFrom < 0) {
      forkFrom = length + template.fork.from
      forkTo = length + template.fork.to
    }
    if (template.pulse) pulseFrom = length + template.pulse.from
    length += template.length
  }
  return length >= ROUTE_MIN_METRES
    && length <= ROUTE_MAX_METRES
    && forkFrom * 4 >= length
    && forkTo * 5 <= length * 3
    && pulseFrom * 2 >= length
}

// ---------------------------------------------------------------------------
// Assembly: templates to Q16.16 track data
// ---------------------------------------------------------------------------

type EventDraft = Omit<WorldEvent, 'id'>

interface Assembly {
  segments: Segment[]
  forks: Fork[]
  gates: Gate[]
  hazards: Hazard[]
  events: EventDraft[]
  ramps: Zone[]
  gaps: Zone[]
  rails: Zone[]
  boostPads: Zone[]
  setPieces: SetPiece[]
  checkpoints: Checkpoint[]
  pulse: PulseSection | null
}

interface Placed {
  template: ModuleTemplate
  /** Module start, whole metres. */
  start: number
  /** Ground height at module start, decimetres. */
  elevation: number
  tier: Tier
  /** 1 as authored, -1 mirrored left to right. */
  mirror: 1 | -1
  fork: Fork | null
}

function assemble(config: TrackConfig, layout: readonly ModuleTemplate[], rng: Rng): Track {
  const out: Assembly = {
    segments: [],
    forks: [],
    gates: [],
    hazards: [],
    events: [],
    ramps: [],
    gaps: [],
    rails: [],
    boostPads: [],
    setPieces: [],
    checkpoints: [],
    pulse: null,
  }
  let start = 0
  let elevation = 0
  for (const template of layout) {
    const mirror: 1 | -1 = nextInt(rng, 2) === 0 ? 1 : -1
    const fork = template.fork ? buildFork(template, start, config.tier, mirror, out.forks.length) : null
    const placed: Placed = { template, start, elevation, tier: config.tier, mirror, fork }
    if (fork) out.forks.push(fork)
    if (template.pulse) out.pulse = buildPulse(start, template)
    placeSegments(out, placed)
    for (const feature of template.features) placeFeature(out, placed, feature, rng)
    placeCheckpoints(out, placed)
    start += template.length
    elevation += template.rise
  }
  if (out.forks.length === 0 || !out.pulse) throw new Error('relay-leg: layout lacks a fork or pulse module')
  const finishDist = metres(start)
  out.setPieces.push({ dist: finishDist, kind: 'handoff-gate', length: metres(HANDOFF_LENGTH_METRES) })
  if (config.tier === 0) protectOpening(out)
  const events = out.events.sort(byDistThenPath).map((event, id): WorldEvent => ({ id, ...event }))
  const ramps = out.ramps.sort(byFromThenPath)
  const pulseGates = out.gates.filter(gate => gate.kind === 'pulse')
  return {
    world: config.world,
    tier: config.tier,
    finishDist,
    segments: out.segments,
    forks: out.forks,
    gates: out.gates.sort(byDistThenPath),
    hazards: admitHazards(out.hazards.sort(byDistThenPath), { ramps, pulseGates, events }, config.tier),
    events,
    ramps,
    gaps: out.gaps.sort(byFromThenPath),
    rails: out.rails.sort(byFromThenPath),
    boostPads: out.boostPads.sort(byFromThenPath),
    pulse: out.pulse,
    setPieces: out.setPieces.sort((a, b) => a.dist - b.dist),
    checkpoints: out.checkpoints.sort(byDistThenPath),
  }
}

function buildFork(template: ModuleTemplate, start: number, tier: Tier, mirror: 1 | -1, index: number): Fork {
  const spec = template.fork!
  return {
    index,
    from: metres(start + spec.from),
    to: metres(start + spec.to),
    riskSide: mirror,
    riskProgress: Math.trunc((spec.riskProgress + RISK_PROGRESS_TIER_BONUS[tier]) * ONE / 100),
    separation: decimetres(spec.separation),
    safeLanes: spec.safeLanes,
    riskLanes: spec.riskLanes,
    safeEdges: mirrorEdges(spec.safeEdges, mirror),
    riskEdges: mirrorEdges(spec.riskEdges, mirror),
    label: spec.label,
  }
}

function buildPulse(start: number, template: ModuleTemplate): PulseSection {
  const spec = template.pulse!
  return { from: metres(start + spec.from), to: metres(start + spec.to), period: PULSE_PERIOD, window: PULSE_WINDOW }
}

function mirrorEdges(edges: { left: EdgeKind; right: EdgeKind }, mirror: 1 | -1): { left: EdgeKind; right: EdgeKind } {
  return mirror === 1 ? { left: edges.left, right: edges.right } : { left: edges.right, right: edges.left }
}

/** Mirrors a signed authoring value; `0 - value` keeps zero a positive zero. */
function mirrored(value: number, mirror: 1 | -1): number {
  return mirror === 1 ? value : 0 - value
}

/** Mirrored slots in ascending order, for sets of blocked or covered lanes. */
function laneSet(lanes: readonly number[], mirror: 1 | -1): number[] {
  return lanes.map(lane => mirrored(lane, mirror)).sort((a, b) => a - b)
}

/** Mirrored slots in authored order, for movers that travel from the first slot to the last. */
function laneRoute(lanes: readonly number[], mirror: 1 | -1): number[] {
  return lanes.map(lane => mirrored(lane, mirror))
}

/** Segments break at edge sections and at a fork's split and rejoin. */
function placeSegments(out: Assembly, placed: Placed): void {
  const { template, start, fork, mirror } = placed
  const sections = template.features.filter((feature): feature is EdgeTemplate => feature.type === 'edges')
  const cuts = new Set<number>([0, template.length, ...sections.map(section => section.at)])
  if (template.fork) {
    cuts.add(template.fork.from)
    cuts.add(template.fork.to)
  }
  const points = [...cuts].sort((a, b) => a - b)
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i]!
    const to = points[i + 1]!
    const inFork = fork !== null && template.fork !== undefined && from >= template.fork.from && from < template.fork.to
    const edgesHere = inFork ? fork.safeEdges : mirrorEdges(sectionEdges(template, sections, from), mirror)
    out.segments.push({
      index: out.segments.length,
      module: template.id,
      kind: template.kind,
      from: metres(start + from),
      to: metres(start + to),
      elevationFrom: decimetres(elevationAt(placed, from)),
      elevationTo: decimetres(elevationAt(placed, to)),
      laneCount: inFork ? fork.safeLanes : template.laneCount,
      laneWidth: LANE_WIDTH,
      shoulder: decimetres(template.shoulder),
      leftEdge: edgesHere.left,
      rightEdge: edgesHere.right,
      bend: mirrored(template.bend, mirror),
    })
  }
}

function sectionEdges(template: ModuleTemplate, sections: readonly EdgeTemplate[], at: number): { left: EdgeKind; right: EdgeKind } {
  let edges = template.edges
  for (const section of sections) {
    if (section.at <= at) edges = { left: section.left, right: section.right }
  }
  return edges
}

function elevationAt(placed: Placed, offset: number): number {
  return placed.elevation + Math.trunc(placed.template.rise * offset / placed.template.length)
}

function placeFeature(out: Assembly, placed: Placed, feature: FeatureTemplate, rng: Rng): void {
  const at = metres(placed.start + feature.at)
  const mirror = placed.mirror
  switch (feature.type) {
    case 'gate':
      out.gates.push({
        dist: at,
        lane: mirrored(feature.lane, mirror),
        kind: feature.kind,
        path: feature.path,
        period: feature.kind === 'pulse' ? PULSE_PERIOD : 0,
      })
      return
    case 'hazard':
      if (feature.minTier <= placed.tier) out.hazards.push(placeHazard(feature, at, mirror, rng))
      return
    case 'event':
      if (feature.minTier <= placed.tier) out.events.push(placeEvent(feature, at, mirror))
      return
    case 'set-piece':
      out.setPieces.push({ dist: at, kind: feature.kind, length: metres(feature.len) })
      return
    case 'ramp':
      out.ramps.push(placeZone(feature, at, mirror))
      return
    case 'gap':
      out.gaps.push(placeZone(feature, at, mirror))
      return
    case 'rail':
      out.rails.push(placeZone(feature, at, mirror))
      return
    case 'pad':
      out.boostPads.push(placeZone(feature, at, mirror))
      return
    case 'edges':
      return
  }
}

function placeHazard(feature: HazardTemplate, at: number, mirror: 1 | -1, rng: Rng): Hazard {
  const moving = feature.kind === 'sweeper' || feature.kind === 'drone'
  const period = feature.period
  return {
    dist: at,
    kind: feature.kind,
    path: feature.path,
    lanes: moving ? laneRoute(feature.lanes, mirror) : laneSet(feature.lanes, mirror),
    period,
    phase: period > 0 ? (feature.phase + nextInt(rng, period)) % period : 0,
    amplitude: feature.kind === 'gust' ? mirrored(feature.amplitude, mirror) : feature.amplitude,
    length: metres(feature.length),
  }
}

function placeEvent(feature: EventTemplate, at: number, mirror: 1 | -1): EventDraft {
  const ordered = feature.kind === 'maintenance-drone' || feature.kind === 'transit-crossing' || feature.kind === 'drone-pattern'
  return {
    kind: feature.kind,
    path: feature.path,
    dist: at,
    length: metres(feature.len),
    triggerDist: at - metres(feature.lead),
    duration: feature.duration,
    lanes: ordered ? laneRoute(feature.lanes, mirror) : laneSet(feature.lanes, mirror),
    period: feature.period,
    amplitude: feature.kind === 'crosswind' ? mirrored(feature.amplitude, mirror) : feature.amplitude,
    count: feature.count,
  }
}

function placeZone(feature: ZoneTemplate, at: number, mirror: 1 | -1): Zone {
  return { from: at, to: at + metres(feature.len), lanes: laneSet(feature.lanes, mirror), path: feature.path }
}

/**
 * Tether checkpoints: every module start on the main road, and the start of each fork
 * path. A risk path whose ramps are speed-gated gets none, so a courier who misses the jump
 * is pulled back before the fork and can choose again instead of respawning below the speed
 * the jump needs.
 */
function placeCheckpoints(out: Assembly, placed: Placed): void {
  const { template, start, fork } = placed
  out.checkpoints.push({ dist: metres(start), path: 'main', lane: centreMostLane(template.laneCount, 1) })
  if (!fork) return
  out.checkpoints.push({ dist: fork.from, path: 'safe', lane: centreMostLane(fork.safeLanes, fork.riskSide) })
  const gated = template.features.some(feature =>
    feature.type === 'event' && feature.path === 'risk' && (feature.kind === 'rising-bridge' || feature.kind === 'bridge-break'))
  if (!gated) out.checkpoints.push({ dist: fork.from, path: 'risk', lane: centreMostLane(fork.riskLanes, fork.riskSide === 1 ? -1 : 1) })
}

/** The centre lane, or with an even lane count the lane on `innerSide` of the centre line. */
function centreMostLane(count: LaneCount, innerSide: -1 | 1): number {
  return count % 2 === 1 ? 0 : innerSide
}

/** Tier 0 couriers learn edges on railings: open edges before 400 m become rails. */
function protectOpening(out: Assembly): void {
  const limit = metres(TIER0_PROTECTED_METRES)
  const railed = (edge: EdgeKind): EdgeKind => (edge === 'open' ? 'rail' : edge)
  for (let i = 0; i < out.segments.length; i++) {
    const segment = out.segments[i]!
    if (segment.from >= limit) break
    out.segments[i] = { ...segment, leftEdge: railed(segment.leftEdge), rightEdge: railed(segment.rightEdge) }
  }
  for (let i = 0; i < out.forks.length; i++) {
    const fork = out.forks[i]!
    if (fork.from >= limit) continue
    out.forks[i] = {
      ...fork,
      safeEdges: { left: railed(fork.safeEdges.left), right: railed(fork.safeEdges.right) },
      riskEdges: { left: railed(fork.riskEdges.left), right: railed(fork.riskEdges.right) },
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-module fairness filter
// ---------------------------------------------------------------------------

interface Landmarks {
  ramps: readonly Zone[]
  pulseGates: readonly Gate[]
  events: readonly WorldEvent[]
}

/**
 * Module boundaries can put two authored hazards too close together, or a hazard where
 * the courier is still airborne from the previous module's ramp, lining up a pulse gate or
 * reading a world event. Walking the route in order and dropping the later hazard keeps the
 * authored rhythm and guarantees the content invariants.
 */
function admitHazards(sorted: readonly Hazard[], landmarks: Landmarks, tier: Tier): Hazard[] {
  const spacing = metres(HAZARD_SPACING_METRES[tier])
  const last: Record<Path, number> = { main: -spacing, safe: -spacing, risk: -spacing }
  const admitted: Hazard[] = []
  for (const hazard of sorted) {
    if (!isPlaceable(hazard, landmarks)) continue
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

function isPlaceable(hazard: Hazard, landmarks: Landmarks): boolean {
  if (crowdsPulseGate(hazard, landmarks.pulseGates)) return false
  if (crowdsEvent(hazard, landmarks.events)) return false
  return hazard.kind === 'gust' || clearOfRamps(hazard, landmarks.ramps)
}

/** A hazard, or a gust's whole zone, too close to a pulse gate on a connected path. */
function crowdsPulseGate(hazard: Hazard, pulseGates: readonly Gate[]): boolean {
  const clear = metres(PULSE_GATE_CLEAR_METRES)
  const reach = hazard.kind === 'gust' ? hazard.length : 0
  return pulseGates.some(gate =>
    pathsTouch(gate.path, hazard.path) && gate.dist > hazard.dist - clear && gate.dist < hazard.dist + reach + clear)
}

/** A hazard inside or next to a world event's area; a gust overlapping a crosswind. */
function crowdsEvent(hazard: Hazard, events: readonly WorldEvent[]): boolean {
  const clear = metres(EVENT_CLEAR_METRES)
  const reach = hazard.kind === 'gust' ? hazard.length : 0
  return events.some(event => {
    if (!pathsTouch(event.path, hazard.path) || event.kind === 'pulse-tunnel') return false
    if (hazard.kind === 'gust' && event.kind !== 'crosswind') return false
    return hazard.dist + reach > event.dist - clear && hazard.dist < event.dist + event.length + clear
  })
}

function clearOfRamps(hazard: Hazard, ramps: readonly Zone[]): boolean {
  const jumpable = hazard.kind === 'barrier' || hazard.kind === 'sweeper'
  const overhead = hazard.kind === 'beam' || hazard.kind === 'drone'
  const clearAfter = metres(overhead ? RAMP_OVERHEAD_CLEAR_AFTER_METRES : RAMP_CLEAR_AFTER_METRES)
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
