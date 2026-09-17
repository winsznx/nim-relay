/**
 * Relay Leg engine v6 contract.
 *
 * v6 evolves v5 (frozen in ../relay-leg-v5) with lane-aware locomotion, real road
 * edges, falls with a baton tether save, several route forks, deterministic world
 * events, drafting the previous runner's verified Ghostline, and Relay Rush.
 *
 * The simulation is authoritative and renderer-independent. Every value that
 * affects the outcome is an integer; distances and lateral positions are Q16.16
 * metres (ONE = 1 m). Presentation layers read State/Track but never write them.
 */

export const ENGINE_VERSION = '6'
export const CHALLENGE = 'relay-leg'
export const TICK_RATE = 60
/** 90 seconds at 60 Hz. A leg that has not finished by then ends incomplete. */
export const MAX_TICKS = 5400

export type World = 'coast' | 'metro' | 'alpine' | 'solar' | 'ocean'
export const WORLDS: readonly World[] = ['coast', 'metro', 'alpine', 'solar', 'ocean']

/**
 * 0: first legs of a new courier (teaching opening, protected edges early, forgiving windows)
 * 1: standard
 * 2: veteran (denser events, tighter cut timing)
 */
export type Tier = 0 | 1 | 2

/**
 * The previous runner's verified route, derived server-side from their canonical replay
 * with `deriveGhostline`. Sampled every `step` metres of route progress.
 */
export interface Ghostline {
  /** Sample spacing, Q16.16 metres (4 m). */
  step: number
  /** Path the ghost was on at each sample: 0 main, 1 safe, 2 risk (fork index is implied by distance). */
  path: readonly (0 | 1 | 2)[]
  /** Ghost lateral position at each sample, centimetres relative to that path's centre line. */
  x: readonly number[]
  /** Tick at which the ghost reached each sample. */
  tick: readonly number[]
}

export interface Config {
  engineVersion: '6'
  challenge: 'relay-leg'
  challengeVersion: '6'
  seed: string
  world: World
  tier: Tier
  /**
   * Inherited opening FLOW, 0..MAX_OPENING_FLOW (Q16.16 fraction of full FLOW).
   * Issued and signed by the server from the previous verified leg.
   */
  openingFlow: number
  /** Baton tether saves available this leg (0 or 1). A fall with none left fails the leg. */
  tetherSaves: 0 | 1
  /** Previous runner's verified route on this exact track, or null when there is no ghost. */
  ghostline: Ghostline | null
}
export const MAX_OPENING_FLOW = 16384

/** Which physical path a feature sits on. `main` spans the route; each fork splits into `safe` and `risk`. */
export type Path = 'main' | 'safe' | 'risk'

/**
 * Lanes. A path of N lanes has lane slots in half-lane units from the centre line:
 * 1 lane: [0]; 2 lanes: [-1, 1]; 3 lanes: [-2, 0, 2]; 4 lanes: [-3, -1, 1, 3].
 * Lane centre x = slot * laneWidth / 2. Slots are what the sim stores in `lane` and `targetLane`.
 */
export type LaneCount = 1 | 2 | 3 | 4

/**
 * rail: protected edge. Contact starts an edge grind; recover inward or go over.
 * open: unprotected drop. Crossing the edge line is a fall.
 * wall: tunnel or barrier wall. Contact bumps the courier back; no fall.
 */
export type EdgeKind = 'rail' | 'open' | 'wall'

export type ModuleKind =
  | 'opening'
  | 'straight'
  | 'curve'
  | 'climb'
  | 'drop'
  | 'ramp-run'
  | 'rail-run'
  | 'hazard-corridor'
  | 'fork'
  | 'pulse'
  | 'set-piece-approach'
  | 'set-piece'
  | 'finish'

export interface Segment {
  index: number
  /** Authored module template id, e.g. `coast.bridge-break.a`. */
  module: string
  kind: ModuleKind
  from: number
  to: number
  elevationFrom: number
  elevationTo: number
  /** Lanes on the main path (forks override per path inside their span). */
  laneCount: LaneCount
  /** Lane width, Q16.16 m. */
  laneWidth: number
  /** Shoulder width outside the outer lanes, Q16.16 m. */
  shoulder: number
  leftEdge: EdgeKind
  rightEdge: EdgeKind
  /** Presentation-only horizontal bend in milli-radians per 100 m of route. */
  bend: number
}

export interface Fork {
  /** 0-based order along the route. */
  index: number
  from: number
  to: number
  /** Side of the risk path: -1 = left, 1 = right. */
  riskSide: -1 | 1
  /** Risk path progress multiplier, Q16.16 (> ONE: shorter physical path). Safe progresses at ONE. */
  riskProgress: number
  /** Presentation: physical lateral separation of the two paths at the midpoint (Q16.16 m). */
  separation: number
  safeLanes: LaneCount
  riskLanes: LaneCount
  safeEdges: { left: EdgeKind; right: EdgeKind }
  riskEdges: { left: EdgeKind; right: EdgeKind }
  /**
   * Selection rule at `from`: the courier's lane slot decides. Slots on the risk side of the
   * main path centre select risk; everything else selects safe. Renderers draw the split so
   * the risk lane visibly peels off.
   */
  label: 'relay-cut' | 'shortcut'
}

export type GateKind = 'gold' | 'pulse'
export interface Gate {
  dist: number
  /** Lane slot the gate marks. */
  lane: number
  kind: GateKind
  path: Path
  /** Pulse gates only: ticks per beat (25). Gold gates: 0. Pulse gates alternate between `lane` and `-lane` each beat. */
  period: number
}

/**
 * Static and moving obstacles, authored on lanes.
 * barrier: low block over `lanes` (jump or change lane)
 * beam: overhead bar over `lanes` (slide or change lane)
 * sweeper: low mover oscillating between lane slots `lanes[0]` and `lanes[1]` on `period`
 * drone: head-height mover like sweeper (slide or change lane)
 * gust: lateral push over `length` metres (no collision), `amplitude` mm/tick signed
 */
export type HazardKind = 'barrier' | 'beam' | 'sweeper' | 'drone' | 'gust'
export interface Hazard {
  dist: number
  kind: HazardKind
  path: Path
  /** Blocked lane slots (static), or the two endpoint slots for movers. */
  lanes: readonly number[]
  period: number
  phase: number
  amplitude: number
  length: number
}

/**
 * Deterministic world events. Each starts when the courier's route distance reaches
 * `triggerDist` (so every courier gets the same telegraph time), then plays out over ticks.
 * lane-closure: barriers slide into `lanes` over `duration` ticks, then block them
 * maintenance-drone: a large machine drifts across lanes along `lanes` over `duration`, colliding low
 * rising-bridge: a deck section lifts on the safe side of a fork; on the risk side it becomes a launch ramp
 * transit-crossing: a vehicle crosses the road from `lanes[0]` to `lanes[last]` over `duration`, colliding low
 * crosswind: lateral push `amplitude` over `length`, gusting on `period`
 * collapsing-gantry: an overhead gantry falls after `duration` ticks and then blocks `lanes` (slide under while falling is a hit)
 * drone-pattern: `count` drones move through a formation over `lanes` on `period`
 * pulse-tunnel: lighting and pulse gates follow the 144 BPM grid over `length`
 * bridge-break: the final bridge set piece; the safe loop routes around, the relay cut needs lane, speed and a jump
 */
export type WorldEventKind =
  | 'lane-closure'
  | 'maintenance-drone'
  | 'rising-bridge'
  | 'transit-crossing'
  | 'crosswind'
  | 'collapsing-gantry'
  | 'drone-pattern'
  | 'pulse-tunnel'
  | 'bridge-break'
export interface WorldEvent {
  /** Stable index within the route (renderers key visuals by it). */
  id: number
  kind: WorldEventKind
  path: Path
  /** Route distance where the event's hazard area starts. */
  dist: number
  length: number
  /** Distance at which the event starts playing. Always before `dist`. */
  triggerDist: number
  /** Ticks the event takes to reach its blocking/final state. */
  duration: number
  lanes: readonly number[]
  period: number
  amplitude: number
  count: number
}

export interface Zone {
  from: number
  to: number
  /** Lane slots covered. */
  lanes: readonly number[]
  path: Path
}

export interface PulseSection {
  from: number
  to: number
  /** Ticks per beat (25 = 144 BPM). */
  period: number
  /** Ticks after the beat that still count as on-beat for pads. */
  window: number
}

export type SetPieceKind =
  | 'suspension-bridge'
  | 'transit-crossing'
  | 'tunnel'
  | 'cliff-drop'
  | 'turbine-field'
  | 'wave-arch'
  | 'skyline-jump'
  | 'bridge-break'
  | 'handoff-gate'
export interface SetPiece {
  dist: number
  kind: SetPieceKind
  length: number
}

/** Recoverable respawn points for a tether save: the last one behind the fall is used. */
export interface Checkpoint {
  dist: number
  path: Path
  lane: number
}

export interface Track {
  world: World
  tier: Tier
  finishDist: number
  segments: readonly Segment[]
  forks: readonly Fork[]
  gates: readonly Gate[]
  hazards: readonly Hazard[]
  events: readonly WorldEvent[]
  ramps: readonly Zone[]
  gaps: readonly Zone[]
  rails: readonly Zone[]
  boostPads: readonly Zone[]
  pulse: PulseSection
  setPieces: readonly SetPiece[]
  checkpoints: readonly Checkpoint[]
}

/**
 * Input channel.
 * shift: lane change impulse (-1 left, 0 none, 1 right). From an outer lane, shifting outward
 *        moves onto the shoulder toward the edge.
 * nudge: held fine offset inside the lane, -8..8 (each unit 5 cm). 0 = magnetize to lane centre.
 * action: impulse (0 none, 1 jump, 2 slide).
 */
export interface Input {
  shift: -1 | 0 | 1
  nudge: number
  action: 0 | 1 | 2
}
export const NUDGE_RANGE = 8
export const ACTION_NONE = 0
export const ACTION_JUMP = 1
export const ACTION_SLIDE = 2
/** [ticksSincePreviousSample, shift, nudge, action]. shift and action are impulses on the sample tick; nudge holds. */
export type Sample = readonly [number, -1 | 0 | 1, number, 0 | 1 | 2]
export type InputTrace = readonly Sample[]

/** Bit flags for the tick that just ran. Presentation cues only; part of the hashed state. Rush ending is `rushTicks` reaching 0. */
export const EVENT = {
  PERFECT_GATE: 1 << 0,
  MISSED_GATE: 1 << 1,
  PULSE_HIT: 1 << 2,
  NEAR_MISS: 1 << 3,
  HIT: 1 << 4,
  JUMP: 1 << 5,
  LAND: 1 << 6,
  CLEAN_LAND: 1 << 7,
  SLIDE: 1 << 8,
  RAIL_ON: 1 << 9,
  RAIL_OFF: 1 << 10,
  BOOST_PAD: 1 << 11,
  FORK_SAFE: 1 << 12,
  FORK_RISK: 1 << 13,
  RISK_CLEAR: 1 << 14,
  FALL: 1 << 15,
  FLOW_MAX: 1 << 16,
  FINISH: 1 << 17,
  LANE_SHIFT: 1 << 18,
  LANE_ACQUIRED: 1 << 19,
  SHOULDER: 1 << 20,
  EDGE_GRIND: 1 << 21,
  EDGE_SAVE: 1 << 22,
  TETHER_SAVE: 1 << 23,
  LEG_FAILED: 1 << 24,
  GHOST_OVERTAKE: 1 << 25,
  GHOST_OVERTAKEN: 1 << 26,
  DRAFTING: 1 << 27,
  RUSH_START: 1 << 28,
  HARD_LANDING: 1 << 29,
  EVENT_TRIGGERED: 1 << 30,
} as const
// 31 flags: bit 31 would make the mask a negative 32-bit integer under bitwise operators, so it stays unused.

/** Significant verified moments; bounded, in route order, for Relay Echoes. */
export type MomentKind = 'edge-save' | 'relay-cut' | 'rush' | 'ghost-overtake' | 'tether-save'
export interface Moment {
  kind: MomentKind
  dist: number
  tick: number
  path: Path
}
export const MAX_MOMENTS = 8

export interface Metrics {
  perfectGates: number
  totalGates: number
  pulseHits: number
  nearMisses: number
  hits: number
  falls: number
  jumps: number
  cleanLandings: number
  hardLandings: number
  slides: number
  railTicks: number
  boostPadTicks: number
  riskRoutes: number
  laneChanges: number
  cleanLaneChanges: number
  edgeGrinds: number
  edgeSaves: number
  tetherSaves: number
  draftTicks: number
  overtakes: number
  rushes: number
  rushTicks: number
  /** Sum of flow over every tick (for average FLOW control). */
  flowSum: number
  flowPeak: number
}

/** Courier locomotion phase, for renderers and rules. */
export type Motion = 'riding' | 'grinding' | 'falling' | 'tethering' | 'failed' | 'finished'

export interface State {
  config: Readonly<Config>
  track: Readonly<Track>
  tick: number
  /** Route progress (Q16.16 m), 0..finishDist. */
  dist: number
  path: Path
  /** Lane slot the courier currently occupies (last acquired lane). */
  lane: number
  /** Lane slot the courier is moving to. Equal to `lane` when settled. */
  targetLane: number
  /** Lateral position (Q16.16 m) relative to the active path centre line. */
  x: number
  /** Lateral velocity (Q16.16 m per tick). */
  vx: number
  /** Held fine offset -8..8. */
  nudge: number
  /** Height above ground (Q16.16 m); negative while falling below the deck. */
  y: number
  vy: number
  /** Metres per tick (Q16.16). */
  speed: number
  /** 0..ONE */
  flow: number
  motion: Motion
  /** Ticks remaining in the current motion when it is timed (grind recovery window, fall, tether). */
  motionTicks: number
  /** -1 left edge, 1 right edge, 0 none: the edge being ground or fallen from. */
  edgeSide: -1 | 0 | 1
  tetherSaves: number
  /** Ticks of Relay Rush remaining. */
  rushTicks: number
  slideTicks: number
  stumbleTicks: number
  railing: 0 | 1
  ground: number
  events: number
  gateIdx: number
  hazardIdx: number
  /** Tick each world event triggered, -1 until triggered; indexed by WorldEvent.id. */
  eventTicks: readonly number[]
  /** Which fork paths were taken so far: 0 not reached, 1 safe, 2 risk; indexed by Fork.index. */
  forkChoices: readonly (0 | 1 | 2)[]
  /** Ghost lead in ticks at the current distance: positive means the ghost reached here earlier. 0 without a ghostline. */
  ghostLeadTicks: number
  /**
   * 1 while the ghost holds a clear lead (at least GHOST_LEAD_MARGIN ticks) that has not been
   * overtaken yet. The latch gives overtakes hysteresis, so running level with the ghost cannot
   * farm GHOST_OVERTAKE.
   */
  ghostAhead: 0 | 1
  airTicks: number
  airCleared: 0 | 1
  riskClean: 0 | 1
  bufferedAction: 0 | 1 | 2
  bufferTicks: number
  moments: readonly Moment[]
  finished: 0 | 1
  metrics: Readonly<Metrics>
}

export interface Result {
  resultHash: string
  ticks: number
  timeMs: number
  completed: boolean
  /** True when the leg ended by a fall with no tether save left. */
  failed: boolean
  score: number
  metrics: Readonly<Metrics>
  moments: readonly Moment[]
}
