import type { RelayLegTier, StationWorld } from './station'

/**
 * Relay Atlas: a fixed catalogue of virtual Relay Stations and the directed routes between them.
 *
 * Stations are game-world destinations placed on the globe. They are never where a player is: no runner's physical
 * location is read, stored or implied by anything in the Atlas.
 *
 * Every route races one fixed course: the destination station's world, the route's tier and the route's own seed. All
 * batons on a route race the same track, so its fastest run and ghost record compare like with like. Route ids and
 * seeds are frozen: a catalogue change adds stations and routes under a new ATLAS_VERSION and never rewrites one.
 */

export const ATLAS_VERSION = 1
export const GENESIS_STATION_ID = 'genesis'

export interface AtlasStation {
  id: string
  name: string
  /** The playable world a leg arriving here races. */
  world: StationWorld
  /** Globe placement of the game-world destination, in degrees. */
  lat: number
  lon: number
  description: string
}

export interface AtlasRoute {
  id: string
  from: string
  to: string
  /** The destination station's world. */
  world: StationWorld
  tier: RelayLegTier
  /** Frozen course seed. */
  seed: string
}

/** The route a relay leg raced: which station it left and which it reached. */
export interface AtlasLeg {
  routeId: string
  origin: string
  destination: string
}

export const ATLAS_STATIONS: readonly AtlasStation[] = [
  { id: 'genesis', name: 'Genesis Station', world: 'ocean', lat: 0, lon: 0, description: 'Where every baton starts: a floating platform at zero latitude, zero longitude.' },
  { id: 'cape-verdigris', name: 'Cape Verdigris', world: 'coast', lat: 38.7, lon: -9.5, description: 'Copper-green cliffs where the Atlantic runs meet the old sea road.' },
  { id: 'meridian-yard', name: 'Meridian Yard', world: 'metro', lat: 51.5, lon: -0.1, description: 'A rail yard on the prime meridian, lit around the clock.' },
  { id: 'fjordgate', name: 'Fjordgate', world: 'alpine', lat: 61.2, lon: 6.8, description: 'Switchback ramps cut into a fjord wall.' },
  { id: 'polar-drift', name: 'Polar Drift', world: 'ocean', lat: 78.5, lon: 15.5, description: 'An ice-rimmed ocean deck near the top of the world.' },
  { id: 'dune-array', name: 'Dune Array', world: 'solar', lat: 23.4, lon: 8.5, description: 'Mirror fields across the deep desert.' },
  { id: 'highland-kibo', name: 'Highland Kibo', world: 'alpine', lat: -3.1, lon: 37.4, description: 'A summit course above the equatorial cloud line.' },
  { id: 'cape-horizon', name: 'Cape Horizon', world: 'coast', lat: -34.2, lon: 18.5, description: 'The last headland before two oceans meet.' },
  { id: 'monsoon-deck', name: 'Monsoon Deck', world: 'ocean', lat: -6.0, lon: 72.5, description: 'A storm deck in the middle of the Indian Ocean.' },
  { id: 'roof-station', name: 'Roof Station', world: 'alpine', lat: 28.0, lon: 86.9, description: 'The highest station on the Atlas.' },
  { id: 'gobi-mirror', name: 'Gobi Mirror', world: 'solar', lat: 43.5, lon: 104.0, description: 'Heliostat rows on a high steppe plateau.' },
  { id: 'neon-delta', name: 'Neon Delta', world: 'metro', lat: 22.3, lon: 114.2, description: 'Stacked skyways over a river delta.' },
  { id: 'kuroshio', name: 'Kuroshio Current', world: 'ocean', lat: 31.0, lon: 142.0, description: 'A fast deck riding the warm Pacific current.' },
  { id: 'outback-flare', name: 'Outback Flare', world: 'solar', lat: -25.3, lon: 131.0, description: 'Red-earth solar towers in the continent’s heart.' },
  { id: 'coral-reach', name: 'Coral Reach', world: 'coast', lat: -18.3, lon: 147.7, description: 'Boardwalks strung along the reef.' },
  { id: 'ice-shelf', name: 'Ice Shelf Relay', world: 'alpine', lat: -77.8, lon: 166.7, description: 'A wind-cut course on the southern ice.' },
  { id: 'southern-gyre', name: 'Southern Gyre', world: 'ocean', lat: -48.0, lon: -123.4, description: 'The remotest ocean deck, far from any shore.' },
  { id: 'andes-spine', name: 'Andes Spine', world: 'alpine', lat: -13.2, lon: -72.5, description: 'Ridge-line ramps along the mountain spine.' },
  { id: 'atacama-field', name: 'Atacama Field', world: 'solar', lat: -23.6, lon: -68.2, description: 'The driest, brightest solar field on the Atlas.' },
  { id: 'rio-breakwater', name: 'Rio Breakwater', world: 'coast', lat: -22.9, lon: -43.2, description: 'A harbour wall course under granite peaks.' },
  { id: 'trade-wind-quay', name: 'Trade Wind Quay', world: 'coast', lat: 18.2, lon: -66.0, description: 'Island quays in the steady trade winds.' },
  { id: 'lakeshore-grid', name: 'Lakeshore Grid', world: 'metro', lat: 41.9, lon: -87.6, description: 'Elevated tracks on a freshwater shoreline.' },
  { id: 'pacific-arc', name: 'Pacific Arc', world: 'metro', lat: 37.8, lon: -122.4, description: 'Bridges and hills on the Pacific edge.' },
  { id: 'aurora-ridge', name: 'Aurora Ridge', world: 'alpine', lat: 64.8, lon: -147.7, description: 'A northern ridge under the aurora.' },
]

/** [from, to, tier]. Genesis has one route into each world, so any leg ever raced has a Genesis route to backfill onto. */
const ROUTE_TABLE: readonly (readonly [string, string, RelayLegTier])[] = [
  ['genesis', 'cape-verdigris', 0],
  ['genesis', 'dune-array', 0],
  ['genesis', 'highland-kibo', 0],
  ['genesis', 'meridian-yard', 0],
  ['genesis', 'monsoon-deck', 0],
  ['cape-verdigris', 'meridian-yard', 1],
  ['cape-verdigris', 'trade-wind-quay', 2],
  ['meridian-yard', 'fjordgate', 1],
  ['meridian-yard', 'dune-array', 1],
  ['fjordgate', 'polar-drift', 1],
  ['fjordgate', 'meridian-yard', 0],
  ['polar-drift', 'aurora-ridge', 2],
  ['polar-drift', 'gobi-mirror', 2],
  ['dune-array', 'highland-kibo', 1],
  ['dune-array', 'cape-horizon', 1],
  ['highland-kibo', 'monsoon-deck', 1],
  ['highland-kibo', 'roof-station', 2],
  ['cape-horizon', 'ice-shelf', 2],
  ['cape-horizon', 'rio-breakwater', 2],
  ['cape-horizon', 'monsoon-deck', 1],
  ['monsoon-deck', 'roof-station', 1],
  ['monsoon-deck', 'outback-flare', 1],
  ['monsoon-deck', 'neon-delta', 1],
  ['roof-station', 'gobi-mirror', 1],
  ['roof-station', 'neon-delta', 0],
  ['gobi-mirror', 'kuroshio', 1],
  ['gobi-mirror', 'polar-drift', 2],
  ['neon-delta', 'kuroshio', 0],
  ['neon-delta', 'coral-reach', 1],
  ['kuroshio', 'pacific-arc', 2],
  ['kuroshio', 'southern-gyre', 2],
  ['kuroshio', 'aurora-ridge', 1],
  ['outback-flare', 'coral-reach', 0],
  ['outback-flare', 'ice-shelf', 2],
  ['coral-reach', 'southern-gyre', 1],
  ['coral-reach', 'outback-flare', 0],
  ['ice-shelf', 'southern-gyre', 2],
  ['ice-shelf', 'cape-horizon', 2],
  ['southern-gyre', 'andes-spine', 2],
  ['southern-gyre', 'pacific-arc', 1],
  ['andes-spine', 'atacama-field', 0],
  ['andes-spine', 'rio-breakwater', 1],
  ['atacama-field', 'trade-wind-quay', 1],
  ['atacama-field', 'andes-spine', 0],
  ['rio-breakwater', 'genesis', 1],
  ['rio-breakwater', 'trade-wind-quay', 1],
  ['trade-wind-quay', 'lakeshore-grid', 1],
  ['trade-wind-quay', 'cape-verdigris', 2],
  ['lakeshore-grid', 'pacific-arc', 1],
  ['lakeshore-grid', 'meridian-yard', 2],
  ['lakeshore-grid', 'aurora-ridge', 1],
  ['pacific-arc', 'kuroshio', 2],
  ['pacific-arc', 'atacama-field', 1],
  ['aurora-ridge', 'lakeshore-grid', 1],
  ['aurora-ridge', 'fjordgate', 2],
]

const stationsById = new Map(ATLAS_STATIONS.map(station => [station.id, station]))

export function atlasRouteId(from: string, to: string): string {
  return `${from}-to-${to}`
}

export const ATLAS_ROUTES: readonly AtlasRoute[] = ROUTE_TABLE.map(([from, to, tier]) => {
  const destination = stationsById.get(to)
  if (!destination || !stationsById.has(from)) throw new Error(`Atlas route ${from} -> ${to} names an unknown station`)
  const id = atlasRouteId(from, to)
  return { id, from, to, world: destination.world, tier, seed: `atlas-v1-${id}` }
})

const routesById = new Map(ATLAS_ROUTES.map(route => [route.id, route]))

export function atlasStation(id: string): AtlasStation | undefined {
  return stationsById.get(id)
}

export function atlasRoute(id: string): AtlasRoute | undefined {
  return routesById.get(id)
}

/** Routes leaving a station, in catalogue order. */
export function outgoingRoutes(stationId: string): AtlasRoute[] {
  return ATLAS_ROUTES.filter(route => route.from === stationId)
}

/** The Genesis route into `world`: where legacy legs, raced before the Atlas, are placed. */
export function genesisRouteFor(world: StationWorld): AtlasRoute {
  const route = ATLAS_ROUTES.find(candidate => candidate.from === GENESIS_STATION_ID && candidate.world === world)
  if (!route) throw new Error(`Genesis Station has no route into ${world}`)
  return route
}

/** FNV-1a over UTF-16 units: a small, portable, deterministic hash. */
export function atlasHash(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** The route the server picks when the holder leaves the choice to it: stable for the same station and key. */
export function defaultRouteFrom(stationId: string, key: string): AtlasRoute {
  const routes = outgoingRoutes(stationId)
  const route = routes[atlasHash(`${stationId}:${key}`) % Math.max(1, routes.length)]
  if (!route) throw new Error(`Atlas station ${stationId} has no outgoing route`)
  return route
}

export function atlasLegOf(route: AtlasRoute): AtlasLeg {
  return { routeId: route.id, origin: route.from, destination: route.to }
}

/** Route statistics, derived only from verified qualified legs. */
export interface AtlasRunRecord {
  runnerName: string
  runnerHandle: string
  timeMs: number
  runId: string
  batonCode: string
  leg: number
  at: number
}

/** The latest leg on the route that beat the ghost it chased. */
export interface AtlasGhostRecord extends AtlasRunRecord {
  ghostTimeMs: number
}

export interface AtlasRouteStats {
  routeId: string
  /** Qualified legs raced on the route, legacy legs placed on their Genesis route included. */
  verifiedRuns: number
  /** Distinct runners with a qualified leg on the route. */
  qualifiedRunners: number
  /** Fastest verified completion on the route's own course; legacy legs raced other courses and never set it. */
  fastest: AtlasRunRecord | null
  ghostRecord: AtlasGhostRecord | null
  /** Active batons whose current leg races this route. */
  activeBatons: { code: string; displayName: string }[]
  /** Verified activity with a 3-day half-life, 0 when never raced. */
  heat: number
  /** Heat mapped to 0..1 for display. */
  heatLevel: number
  lit: boolean
  lastRunAt: number | null
}

export interface AtlasStationStats {
  stationId: string
  lit: boolean
  /** Qualified legs that left from or arrived at the station. */
  legs: number
}

export interface AtlasLightTheWorld {
  stationsLit: number
  stationsTotal: number
  routesLit: number
  routesTotal: number
}

/** GET /network/atlas. */
export interface AtlasSnapshot {
  version: number
  generatedAt: number
  routes: AtlasRouteStats[]
  stations: AtlasStationStats[]
  lightTheWorld: AtlasLightTheWorld
}

/** GET /network/atlas/routes/:routeId. */
export interface AtlasRouteDetail {
  version: number
  route: AtlasRoute
  stats: AtlasRouteStats
}

export type AtlasMissionId = 'explorer' | 'station-hopper' | 'world-carrier' | 'lamplighter' | 'legs-25' | 'legs-50' | 'legs-100'

export interface AtlasMission {
  id: AtlasMissionId
  title: string
  description: string
  target: number
  /** Capped at `target`. */
  progress: number
  completedAt: number | null
  /** A profile mark, never NIM. */
  reward: string
}

export interface AtlasProgress {
  stationsVisited: number
  routesCompleted: number
  routesDiscovered: number
  journeys: number
}

export interface AtlasProfile extends AtlasProgress {
  stations: string[]
  routes: string[]
  missions: AtlasMission[]
}

/** A verified leg on a baton's journey. `txHash` is null while the leg's handoff has not verified. */
export interface AtlasJourneyHop extends AtlasLeg {
  kind: 'leg'
  leg: number
  runner: { name: string; handle: string }
  timeMs: number | null
  txHash: string | null
  at: number
  /** Raced before the Atlas: placed on its Genesis route by the world it raced. */
  backfilled: boolean
}

/** The treasury's starter baton, handed out at Genesis Station. Never a handoff and never counted as one. */
export interface AtlasStarterGrant {
  kind: 'treasury_starter_grant'
  at: number
  toRunner: { name: string; handle: string }
  txHash: string | null
  station: typeof GENESIS_STATION_ID
}

export type AtlasJourneyEntry = AtlasJourneyHop | AtlasStarterGrant

/** How the holder's next route is set after a qualified leg. */
export interface AtlasNextRoute {
  /** `choose`: pick one of `routeIds`. `fixed`: the mode keeps the current route (a Quick round's second leg). */
  policy: 'choose' | 'fixed'
  /** The station the holder's leg arrives at. */
  station: string
  routeIds: string[]
  /**
   * The route the holder just raced, when it may be raced again so the next runner chases the holder's ghost. Also in
   * `routeIds`. Every other route id leaves from `station`.
   */
  rerunRouteId: string | null
  /** What the server picks when no route is sent. */
  defaultRouteId: string
}

export interface BatonAtlas {
  /** Oldest first. The current holder's leg in progress is last, without a transaction. */
  journey: AtlasJourneyEntry[]
  /** The route the current leg races. */
  current: AtlasLeg
  /** Null once the baton is completed. */
  next: AtlasNextRoute | null
}
