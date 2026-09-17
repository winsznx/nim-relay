export type StationWorld = 'coast' | 'alpine' | 'metro' | 'solar' | 'ocean'
export type RaceMode = 'quick' | 'global' | 'crew' | 'rival' | 'daily'

/** Station race v4 input sample: [ticksSincePreviousSample, steer, boost, action]. */
export type StationRaceSample = readonly [number, number, 0 | 1, 0 | 1 | 2]
/** Relay Leg v5 input sample: [ticksSincePreviousSample, steer, action]. Historic runs only. */
export type RelayLegV5Sample = readonly [number, number, 0 | 1 | 2]
/** Mirrors `relayLeg.Sample`: [ticksSincePreviousSample, shift, nudge, action]. Shift and action are impulses; nudge holds. */
export type RelayLegV6Sample = readonly [number, -1 | 0 | 1, number, 0 | 1 | 2]
export type StationRaceTrace = readonly StationRaceSample[]
export type RelayLegV5Trace = readonly RelayLegV5Sample[]
export type RelayLegV6Trace = readonly RelayLegV6Sample[]
export type RelayLegTrace = RelayLegV5Trace | RelayLegV6Trace
export type RaceTrace = StationRaceTrace | RelayLegTrace

/** Mirrors `relayLeg.Path`: the main route, or the safe or risk side of a fork. */
export type RelayLegPath = 'main' | 'safe' | 'risk'

export interface StationRaceConfig { engineVersion: '4'; challenge: 'station-race'; challengeVersion: '4'; seed: string; world: StationWorld }
export type RelayLegTier = 0 | 1 | 2
/** Mirrors `relayLegV5.Config`. Historic runs only: the network no longer issues v5 legs. */
export interface RelayLegV5Config {
  engineVersion: '5'
  challenge: 'relay-leg'
  challengeVersion: '5'
  seed: string
  world: StationWorld
  tier: RelayLegTier
  openingFlow: number
}
/**
 * Mirrors `relayLeg.Ghostline`: the previous runner's verified route, derived by the server from their canonical
 * replay. `path` 0 main, 1 safe, 2 risk; `x` centimetres from that path's centre line; `tick` when the ghost got there.
 */
export interface RelayLegGhostline {
  step: number
  path: readonly (0 | 1 | 2)[]
  x: readonly number[]
  tick: readonly number[]
}
/**
 * Mirrors `relayLeg.Config`. `openingFlow` is Q16.16, 0..relayLeg.MAX_OPENING_FLOW. `tetherSaves` and `ghostline`
 * are issued and signed with the rest of the config, so a submission can never change them.
 */
export interface RelayLegV6Config {
  engineVersion: '6'
  challenge: 'relay-leg'
  challengeVersion: '6'
  seed: string
  world: StationWorld
  tier: RelayLegTier
  openingFlow: number
  tetherSaves: 0 | 1
  ghostline: RelayLegGhostline | null
}
export type RelayLegConfig = RelayLegV5Config | RelayLegV6Config
/** Discriminate on `engineVersion`: v6 for every new network race, v5 for historic legs, v4 for station races. */
export type RaceConfig = StationRaceConfig | RelayLegV5Config | RelayLegV6Config

export interface StationRaceMetrics { hazardsHit: number; nearMisses: number; gates: number; missedGates: number; beatHits: number; boostTicks: number; overheats: number; jumps: number; landings: number; grindTicks: number; shortcutTicks: number }
/** Mirrors `relayLegV5.Metrics`. */
export interface RelayLegV5Metrics {
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
  flowSum: number
  flowPeak: number
}
/** Mirrors `relayLeg.Metrics`. */
export interface RelayLegV6Metrics {
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
  flowSum: number
  flowPeak: number
}
/** Mirrors `relayLeg.MomentKind`. */
export type RelayLegMomentKind = 'edge-save' | 'relay-cut' | 'rush' | 'ghost-overtake' | 'tether-save'
/** Mirrors `relayLeg.Moment`: a significant verified moment of a v6 leg, at a Q16.16 route distance. */
export interface RelayLegMoment {
  kind: RelayLegMomentKind
  dist: number
  tick: number
  path: RelayLegPath
}
interface RaceResultBase { score: number; resultHash: string; completed: boolean; ticks: number; timeMs: number }
export interface StationRaceResult extends RaceResultBase { metrics: StationRaceMetrics }
export interface RelayLegV5Result extends RaceResultBase { metrics: RelayLegV5Metrics }
/** Mirrors `relayLeg.Result`. A failed leg ended in a fall with no tether save left: verified, but it never qualifies. */
export interface RelayLegV6Result extends RaceResultBase {
  failed: boolean
  metrics: RelayLegV6Metrics
  moments: readonly RelayLegMoment[]
}
export type RelayLegResult = RelayLegV5Result | RelayLegV6Result
export type RaceResult = StationRaceResult | RelayLegResult

export function isRelayLegResult(result: RaceResult): result is RelayLegResult {
  return 'flowSum' in result.metrics
}

export function isRelayLegV6Result(result: RaceResult): result is RelayLegV6Result {
  return 'moments' in result
}

/** Only v6 legs can fail; every earlier result either finished or ran out of time. */
export function isFailedLeg(result: RaceResult): boolean {
  return isRelayLegV6Result(result) && result.failed
}

/** Public identity of a ghost's runner. Country only when that runner consents to sharing it. */
export interface GhostRunner { name: string; country: string | null }
export interface CanonicalGhost {
  runId: string
  /** Same as `runner.name`; kept for existing clients. */
  name: string
  runner: GhostRunner
  timeMs: number
  /** Exactly the config the run was issued and replayed with, so the ghost always replays to its verified result. */
  config: RaceConfig
  inputTrace: RaceTrace
  result: RaceResult
  verified: true
}
export interface StationRaceGhost extends CanonicalGhost { config: StationRaceConfig; inputTrace: StationRaceTrace; result: StationRaceResult }
/** Watch-only: a v5 ghost replays forever but can no longer be raced. */
export interface RelayLegV5Ghost extends CanonicalGhost { config: RelayLegV5Config; inputTrace: RelayLegV5Trace; result: RelayLegV5Result }
export interface RelayLegV6Ghost extends CanonicalGhost { config: RelayLegV6Config; inputTrace: RelayLegV6Trace; result: RelayLegV6Result }
export type RelayLegGhost = RelayLegV5Ghost | RelayLegV6Ghost

/** The server only stores a trace and result next to the config of the engine that produced them. */
export function isRelayLegGhost(ghost: CanonicalGhost): ghost is RelayLegGhost {
  return ghost.config.engineVersion === '5' || ghost.config.engineVersion === '6'
}

/** Only v6 ghosts can be raced. */
export function isRelayLegV6Ghost(ghost: CanonicalGhost): ghost is RelayLegV6Ghost {
  return ghost.config.engineVersion === '6'
}

export function isStationRaceGhost(ghost: CanonicalGhost): ghost is StationRaceGhost {
  return ghost.config.engineVersion === '4'
}

/**
 * A mark a verified runner left on a baton's route sector. The client words each kind.
 * ghost-record: fastest verified leg on the sector. relay-cut ("<RUNNER>'S CUT"): first runner to finish the sector
 * through its relay cut. edge-save ("<RUNNER>'S SAVE"): an edge save in a canonical v6 leg. rescue: the handoff that
 * moved a stranded baton. milestone: handoffs 10, 25, 50, 100 and 250.
 * v5 sectors also kept risk-pioneer (first runner to finish the risk route) and near-miss-legend (6+ near misses).
 */
export type RelayEchoKind = 'ghost-record' | 'relay-cut' | 'edge-save' | 'rescue' | 'milestone' | 'risk-pioneer' | 'near-miss-legend'
export interface RelayEcho {
  id: string
  batonId: string
  kind: RelayEchoKind
  runner: { id: string; name: string }
  /** The qualified handoff that made the run canonical. */
  leg: number
  runId: string
  sector: number
  /** Q16.16 route distance where the echo belongs in the world, or null when it spans the leg. */
  dist: number | null
  /** edge-save and relay-cut only: the path the moment happened on. */
  path?: RelayLegPath
  at: number
  /** ghost-record only: the record leg's verified time. Records left before it was kept have none. */
  timeMs?: number
}

/** Route sector of a baton leg. The first leg of a sector has no ghost to race. */
export interface RaceSector { index: number; startedLeg: number; firstLeg: boolean }

export interface IssuedRace {
  batonId?: string
  networkRace?: boolean
  practice?: boolean
  official?: boolean
  relayLeg: number | null
  runId: string
  playerId: string
  mode: RaceMode
  config: RaceConfig
  expiresAt: number
  target: string | null
  mac: string
  ghost: CanonicalGhost | null
  /** Baton legs only. Presentation data: not signed and not stored with the run. */
  sector?: RaceSector
  /** Relay Echoes on this leg's sector for the renderer, most meaningful first, at most 4. Not signed and not stored with the run. */
  echoes?: RelayEcho[]
}
export interface StationProfile { id: string; name: string; handle: string; xp: number; level: number; seasonRank: string; runs: number; handoffs: number; achievements: string[]; unlocked: string[]; equipped: { suit: string; helmet: string; board: string; trail: string }; crewId: string | null }
export interface StationCrew { id: string; name: string; code: string; members: string[] }
export interface StationChallenge { id: string; from: string; fromName: string; to: string; runId: string; status: 'pending' | 'completed'; createdAt: number }
export interface Chronicle { id: string; name: string; kind: 'run' | 'handoff'; world: StationWorld; at: number; score: number; leg: number }
export interface StationSnapshot { pendingHandoff?: HandoffIntent | null; profile: StationProfile; global: { holderId: string | null; holderName: string | null; leg: number; world: StationWorld; seed: string }; daily: { date: string; world: StationWorld; seed: string; best: number | null }; crews: StationCrew[]; rivals: { id: string; name: string; score: number }[]; inbox: StationChallenge[]; rankings: { id: string; name: string; score: number; xp: number }[]; chronicles: Chronicle[]; cosmetics: { id: string; category: 'suit' | 'helmet' | 'board' | 'trail'; name: string; xp: number }[] }
/** `qualifiedHandoff` is false for practice, unfinished and failed legs. */
export interface SubmittedRace { runId: string; result: RaceResult; created: boolean; xpEarned: number; profile: StationProfile; qualifiedHandoff: boolean }
export interface HandoffIntent { throw?: { angle: number; power: number }; id: string; runId: string; recipientId: string; recipientName: string; sender: string; recipient: string; value: number; data: string; network: 'TestAlbatross' | 'MainAlbatross'; leg: number; status: 'pending' | 'verified'; txHash: string | null }
