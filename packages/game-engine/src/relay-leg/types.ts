/**
 * Relay Leg engine v5 contract.
 *
 * The simulation is authoritative and renderer-independent. Every value that
 * affects the outcome is an integer; distances and lateral positions are Q16.16
 * metres (ONE = 1 m). Presentation layers read State/Track but never write them.
 */

export const ENGINE_VERSION = '5'
export const CHALLENGE = 'relay-leg'
export const TICK_RATE = 60
/** 90 seconds at 60 Hz. A leg that has not finished by then ends incomplete. */
export const MAX_TICKS = 5400

export type World = 'coast' | 'metro' | 'alpine' | 'solar' | 'ocean'
export const WORLDS: readonly World[] = ['coast', 'metro', 'alpine', 'solar', 'ocean']

/**
 * 0: first legs of a new courier (forgiving, no gaps before the first ramp tutorial)
 * 1: standard
 * 2: veteran (denser hazards, tighter risk route)
 */
export type Tier = 0 | 1 | 2

export interface Config {
  engineVersion: '5'
  challenge: 'relay-leg'
  challengeVersion: '5'
  seed: string
  world: World
  tier: Tier
  /**
   * Inherited opening FLOW, 0..MAX_OPENING_FLOW (Q16.16 fraction of full FLOW).
   * Issued and signed by the server from the previous verified leg; bounded so
   * no previous runner can make the next leg impossible or trivial.
   */
  openingFlow: number
}
export const MAX_OPENING_FLOW = 16384

/** Which physical path a feature sits on. `main` spans the full route; forks split into `safe` and `risk`. */
export type Path = 'main' | 'safe' | 'risk'

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
  /** Stable index within the route. */
  index: number
  /** Authored module template id, e.g. `metro.rail-run.b`. Renderers key their kit pieces off this. */
  module: string
  kind: ModuleKind
  from: number
  to: number
  /** Ground height at `from` and `to` (Q16.16 m). Height is linearly interpolated inside the segment. */
  elevationFrom: number
  elevationTo: number
  /** Track half-width (Q16.16 m). Lateral position is clamped to ±halfWidth. */
  halfWidth: number
  /**
   * Presentation-only horizontal bend in milli-radians per 100 m of route.
   * The simulation is 1-D along the route; renderers bend the ribbon with this.
   */
  bend: number
}

export interface Fork {
  from: number
  to: number
  /** Side of the risk path: -1 = left, 1 = right. Entering the fork with x on this side selects risk. */
  riskSide: -1 | 1
  /**
   * Route progress multiplier on the risk path, Q16.16 (> ONE: shorter physical path).
   * Safe path progresses at ONE.
   */
  riskProgress: number
  /** Presentation: physical lateral separation of the two paths at the midpoint (Q16.16 m). */
  separation: number
  /** Half-width of the safe path between `from` and `to` (Q16.16 m). */
  safeHalfWidth: number
  /** Half-width of the risk path between `from` and `to` (Q16.16 m). Always narrower than the safe path. */
  riskHalfWidth: number
}

export type GateKind = 'gold' | 'pulse'
export interface Gate {
  dist: number
  x: number
  /** Half-width of the perfect window (Q16.16 m). */
  half: number
  kind: GateKind
  path: Path
}

/**
 * barrier: low wall, jump over or steer around
 * beam:    overhead bar spanning the track, slide under
 * sweeper: lateral mover, steer around or jump
 * drone:   hovering mover at head height, slide under or steer around
 * door:    two panels alternating open side on a period, pass through the open side
 * train:   crosses one half of the track on a period, pick the free half
 * gust:    no collision; pushes lateral position while inside its zone
 */
export type HazardKind = 'barrier' | 'beam' | 'sweeper' | 'drone' | 'door' | 'train' | 'gust'
export interface Hazard {
  dist: number
  x: number
  half: number
  kind: HazardKind
  path: Path
  /** Ticks per cycle for moving/periodic hazards; 0 for static. */
  period: number
  /** Tick offset into the cycle. */
  phase: number
  /** Gust only: lateral push per tick (Q16.16 m, signed). Movers: lateral amplitude. */
  amplitude: number
  /** Gust only: zone length (Q16.16 m). */
  length: number
}

export interface Zone {
  from: number
  to: number
  x: number
  half: number
  path: Path
}

export interface PulseSection {
  from: number
  to: number
  /** Ticks per beat. */
  period: number
  /** Ticks after the beat that still count as on-beat. */
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
  | 'handoff-gate'
export interface SetPiece {
  dist: number
  kind: SetPieceKind
  length: number
}

export interface Track {
  world: World
  tier: Tier
  finishDist: number
  segments: readonly Segment[]
  fork: Fork
  gates: readonly Gate[]
  hazards: readonly Hazard[]
  ramps: readonly Zone[]
  gaps: readonly Zone[]
  rails: readonly Zone[]
  boostPads: readonly Zone[]
  pulse: PulseSection
  setPieces: readonly SetPiece[]
}

/** Input channel. steer is a target lateral position, -64..64 mapping to ±halfWidth. action is an impulse. */
export interface Input {
  steer: number
  action: 0 | 1 | 2
}
export const ACTION_NONE = 0
export const ACTION_JUMP = 1
export const ACTION_SLIDE = 2
/** [ticksSincePreviousSample, steer, action] */
export type Sample = readonly [number, number, 0 | 1 | 2]
export type InputTrace = readonly Sample[]

/** Bit flags emitted for the tick that just ran. Presentation cues only; they are part of the hashed state. */
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
} as const

export interface Metrics {
  perfectGates: number
  totalGates: number
  pulseHits: number
  nearMisses: number
  hits: number
  falls: number
  jumps: number
  cleanLandings: number
  slides: number
  railTicks: number
  boostPadTicks: number
  riskRoutes: number
  /** Sum of flow over every tick (for average FLOW control). */
  flowSum: number
  flowPeak: number
}

export interface State {
  config: Readonly<Config>
  track: Readonly<Track>
  tick: number
  /** Route progress (Q16.16 m), 0..finishDist. */
  dist: number
  /** Lateral position (Q16.16 m), relative to the active path centre line. */
  x: number
  /** Height above ground (Q16.16 m). */
  y: number
  vy: number
  /** Metres per tick (Q16.16). */
  speed: number
  /** 0..ONE */
  flow: number
  path: Path
  slideTicks: number
  stumbleTicks: number
  railing: 0 | 1
  /** Ground height at dist (Q16.16 m), for renderers. */
  ground: number
  events: number
  gateIdx: number
  hazardIdx: number
  finished: 0 | 1
  metrics: Readonly<Metrics>
  /** Ticks spent airborne in the current air sequence; 0 while grounded. */
  airTicks: number
  /** 1 once the current air sequence launched from a ramp or cleared a hazard or gap (clean landings only pay then). */
  airCleared: 0 | 1
  /** 1 while on the risk path with no hit or fall since the fork. */
  riskClean: 0 | 1
  /** An action pressed while it could not fire (airborne, stumbling) waits here for `bufferTicks`. */
  bufferedAction: 0 | 1 | 2
  bufferTicks: number
}

export interface Result {
  resultHash: string
  ticks: number
  timeMs: number
  completed: boolean
  /** Ranking score. Time dominates; clean play breaks ties. */
  score: number
  metrics: Readonly<Metrics>
}
