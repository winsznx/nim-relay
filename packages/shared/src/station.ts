export type StationWorld = 'coast' | 'alpine' | 'metro' | 'solar' | 'ocean'
export type RaceMode = 'quick' | 'global' | 'crew' | 'rival' | 'daily'

/** Station race v4 input sample: [ticksSincePreviousSample, steer, boost, action]. */
export type StationRaceSample = readonly [number, number, 0 | 1, 0 | 1 | 2]
/** Relay Leg v5 input sample: [ticksSincePreviousSample, steer, action]. */
export type RelayLegSample = readonly [number, number, 0 | 1 | 2]
export type StationRaceTrace = readonly StationRaceSample[]
export type RelayLegTrace = readonly RelayLegSample[]
export type RaceTrace = StationRaceTrace | RelayLegTrace

export interface StationRaceConfig { engineVersion: '4'; challenge: 'station-race'; challengeVersion: '4'; seed: string; world: StationWorld }
export type RelayLegTier = 0 | 1 | 2
/** Mirrors `relayLeg.Config` from @nim-relay/game-engine. `openingFlow` is Q16.16, 0..relayLeg.MAX_OPENING_FLOW. */
export interface RelayLegConfig {
  engineVersion: '5'
  challenge: 'relay-leg'
  challengeVersion: '5'
  seed: string
  world: StationWorld
  tier: RelayLegTier
  openingFlow: number
}
/** Discriminate on `engineVersion`: v5 for every new network race, v4 for station races and historic runs. */
export type RaceConfig = StationRaceConfig | RelayLegConfig

export interface StationRaceMetrics { hazardsHit: number; nearMisses: number; gates: number; missedGates: number; beatHits: number; boostTicks: number; overheats: number; jumps: number; landings: number; grindTicks: number; shortcutTicks: number }
/** Mirrors `relayLeg.Metrics`. */
export interface RelayLegMetrics {
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
interface RaceResultBase { score: number; resultHash: string; completed: boolean; ticks: number; timeMs: number }
export interface StationRaceResult extends RaceResultBase { metrics: StationRaceMetrics }
export interface RelayLegResult extends RaceResultBase { metrics: RelayLegMetrics }
export type RaceResult = StationRaceResult | RelayLegResult

export function isRelayLegResult(result: RaceResult): result is RelayLegResult {
  return 'flowSum' in result.metrics
}

/** Public identity of a ghost's runner. Country only when that runner consents to sharing it. */
export interface GhostRunner { name: string; country: string | null }
export interface CanonicalGhost {
  runId: string
  /** Same as `runner.name`; kept for existing clients. */
  name: string
  runner: GhostRunner
  timeMs: number
  config: RaceConfig
  inputTrace: RaceTrace
  result: RaceResult
  verified: true
}
export interface StationRaceGhost extends CanonicalGhost { config: StationRaceConfig; inputTrace: StationRaceTrace; result: StationRaceResult }
export interface RelayLegGhost extends CanonicalGhost { config: RelayLegConfig; inputTrace: RelayLegTrace; result: RelayLegResult }

/** The server only stores a trace and result next to the config of the engine that produced them. */
export function isRelayLegGhost(ghost: CanonicalGhost): ghost is RelayLegGhost {
  return ghost.config.engineVersion === '5'
}

export function isStationRaceGhost(ghost: CanonicalGhost): ghost is StationRaceGhost {
  return ghost.config.engineVersion === '4'
}

/**
 * A mark a verified runner left on a baton's route sector.
 * ghost-record: fastest verified leg on the sector. risk-pioneer: first runner to finish the risk route.
 * near-miss-legend: a leg with at least 6 near misses. rescue: the handoff that moved a stranded baton.
 * milestone: handoffs 10, 25, 50, 100 and 250.
 */
export type RelayEchoKind = 'ghost-record' | 'risk-pioneer' | 'near-miss-legend' | 'rescue' | 'milestone'
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
  /** Relay Echoes on this leg's sector, for the renderer. Not signed and not stored with the run. */
  echoes?: RelayEcho[]
}
export interface StationProfile { id: string; name: string; handle: string; xp: number; level: number; seasonRank: string; runs: number; handoffs: number; achievements: string[]; unlocked: string[]; equipped: { suit: string; helmet: string; board: string; trail: string }; crewId: string | null }
export interface StationCrew { id: string; name: string; code: string; members: string[] }
export interface StationChallenge { id: string; from: string; fromName: string; to: string; runId: string; status: 'pending' | 'completed'; createdAt: number }
export interface Chronicle { id: string; name: string; kind: 'run' | 'handoff'; world: StationWorld; at: number; score: number; leg: number }
export interface StationSnapshot { pendingHandoff?: HandoffIntent | null; profile: StationProfile; global: { holderId: string | null; holderName: string | null; leg: number; world: StationWorld; seed: string }; daily: { date: string; world: StationWorld; seed: string; best: number | null }; crews: StationCrew[]; rivals: { id: string; name: string; score: number }[]; inbox: StationChallenge[]; rankings: { id: string; name: string; score: number; xp: number }[]; chronicles: Chronicle[]; cosmetics: { id: string; category: 'suit' | 'helmet' | 'board' | 'trail'; name: string; xp: number }[] }
export interface SubmittedRace { runId: string; result: RaceResult; created: boolean; xpEarned: number; profile: StationProfile; qualifiedHandoff: boolean }
export interface HandoffIntent { throw?: { angle: number; power: number }; id: string; runId: string; recipientId: string; recipientName: string; sender: string; recipient: string; value: number; data: string; network: 'TestAlbatross' | 'MainAlbatross'; leg: number; status: 'pending' | 'verified'; txHash: string | null }
