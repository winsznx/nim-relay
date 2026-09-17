import {
  ATLAS_ROUTES,
  ATLAS_STATIONS,
  ATLAS_VERSION,
  GENESIS_STATION_ID,
  atlasLegOf,
  atlasRoute,
  defaultRouteFrom,
  genesisRouteFor,
  outgoingRoutes,
  type AtlasJourneyEntry,
  type AtlasLeg,
  type AtlasNextRoute,
  type AtlasProfile,
  type AtlasProgress,
  type AtlasRoute,
  type AtlasRouteDetail,
  type AtlasRouteStats,
  type AtlasSnapshot,
  type BatonAtlas,
  type BatonHandoff,
  type HandoffAtlas,
  type RaceConfig,
  type RaceMode,
  type StationWorld,
} from '@nim-relay/shared'
import { ApiError } from '../model'
import { atlasMissions, settleAtlasMissions } from './atlas-missions'
import { ATLAS_HEAT_HALF_LIFE_MS, ATLAS_HEAT_SCALE } from './constants'
import { isAtlasCourse, racesRoute } from './route'
import type { AtlasLedger, AtlasPlayerLedger, AtlasRouteLedger, BatonRecord, NetworkState } from './types'

/**
 * Relay Atlas on the Worker: which route each leg races, how the holder picks the next one, and the route, station and
 * runner aggregates derived from qualified legs. Stations are game-world destinations, never player locations.
 */

/** Modes whose holders pick the next route after a qualified leg. The Daily course is fixed and carries no baton. */
export const ROUTE_CHOICE_MODES: Readonly<Record<RaceMode, boolean>> = { global: true, quick: true, crew: true, rival: true, daily: false }

export function freshAtlasLedger(): AtlasLedger {
  return { routes: {}, stations: {}, players: {} }
}

/** The first route out of Genesis Station, for batons that start there without a choice, such as treasury starter batons. */
export function starterRoute(): { routeId: string; origin: typeof GENESIS_STATION_ID; destination: string } {
  const route = outgoingRoutes(GENESIS_STATION_ID)[0]
  if (!route) throw new Error('Genesis Station has no route')
  return { routeId: route.id, origin: GENESIS_STATION_ID, destination: route.to }
}

/** A new baton's opening route out of Genesis Station, rotating through its routes as batons are created. */
export function openingAtlasRoute(batonsCreated: number): AtlasRoute {
  const routes = outgoingRoutes(GENESIS_STATION_ID)
  return routes[batonsCreated % routes.length]!
}

/** Where a leg raced before the Atlas is placed: from Genesis Station into the world it raced. */
export function backfilledLeg(world: StationWorld): AtlasLeg {
  return atlasLegOf(genesisRouteFor(world))
}

export function requireAtlasRoute(routeId: string): AtlasRoute {
  const route = atlasRoute(routeId)
  if (!route) throw new ApiError('route_not_found', 404)
  return route
}

/**
 * How the holder's pass sets the next leg's route. A Quick round's opening pass keeps the route, so both players race
 * the same course; every other pass picks a route out of the station the leg reached, or races the same route again so
 * the next runner chases this runner's ghost.
 */
export function nextRouteFor(baton: BatonRecord, leg = baton.handoffCount + 1): AtlasNextRoute | null {
  if (baton.status === 'completed' || !ROUTE_CHOICE_MODES[baton.mode]) return null
  const current = baton.route
  if (baton.mode === 'quick' && leg % 2 === 1) {
    return { policy: 'fixed', station: current.destination, routeIds: [current.routeId], rerunRouteId: current.routeId, defaultRouteId: current.routeId }
  }
  const rerunRouteId = isAtlasCourse(current) ? current.routeId : null
  const onward = outgoingRoutes(current.destination).map(route => route.id)
  return {
    policy: 'choose',
    station: current.destination,
    routeIds: rerunRouteId ? [rerunRouteId, ...onward.filter(id => id !== rerunRouteId)] : onward,
    rerunRouteId,
    defaultRouteId: defaultRouteFrom(current.destination, `${baton.code}:${leg}`).id,
  }
}

/** The route a prepared pass binds: the holder's pick when the policy allows it, otherwise the server default. */
export function chooseNextRoute(baton: BatonRecord, leg: number, routeId: string | undefined): AtlasLeg {
  const next = nextRouteFor(baton, leg)
  if (!next) throw new ApiError('journey_completed', 409)
  if (routeId !== undefined && !next.routeIds.includes(routeId)) throw new ApiError('route_not_available', 409)
  return atlasLegOf(requireAtlasRoute(routeId ?? next.defaultRouteId))
}

/** The route an intent prepared before the Atlas moves on to: the server default, or none once the baton completed. */
export function defaultNextRoute(baton: BatonRecord, leg: number): AtlasRoute | null {
  const next = nextRouteFor(baton, leg)
  return next ? requireAtlasRoute(next.defaultRouteId) : null
}

/** The Atlas route a canonical leg raced on the baton's current course. */
export function handoffAtlas(baton: BatonRecord, config: RaceConfig): HandoffAtlas {
  const { routeId, origin, destination } = baton.route
  const atlasCourse = isAtlasCourse(baton.route)
  return { routeId, origin, destination, backfilled: !atlasCourse, onCourse: atlasCourse && racesRoute(config, baton.route) }
}

/** Records a verified qualified leg on the ledger. Call once per handoff, after it is recorded. */
export function recordAtlasLeg(state: NetworkState, batonCode: string, handoff: BatonHandoff): void {
  if (!handoff.qualified) return
  const { atlas } = state
  const { routeId, origin, destination } = handoff.atlas
  const existing = atlas.routes[routeId]
  const routeLedger: AtlasRouteLedger = existing ?? { runs: 0, runners: 0, fastest: null, ghostRecord: null, heat: 0, heatAt: handoff.at, lastRunAt: handoff.at }
  atlas.routes[routeId] = routeLedger
  const player = playerLedger(atlas, handoff.from.id)

  routeLedger.runs++
  routeLedger.heat = decayedHeat(routeLedger, handoff.at) + 1
  routeLedger.heatAt = Math.max(routeLedger.heatAt, handoff.at)
  routeLedger.lastRunAt = Math.max(routeLedger.lastRunAt, handoff.at)
  if (!player.routes.includes(routeId)) {
    player.routes.push(routeId)
    routeLedger.runners++
  }
  if (!existing) player.routesLit++
  recordTimes(routeLedger, batonCode, handoff)

  for (const stationId of new Set([origin, destination])) {
    atlas.stations[stationId] = (atlas.stations[stationId] ?? 0) + 1
    if (!player.stations.includes(stationId)) player.stations.push(stationId)
  }
  player.legs++
  settleAtlasMissions(player, handoff.at)
}

function recordTimes(routeLedger: AtlasRouteLedger, batonCode: string, handoff: BatonHandoff): void {
  const race = handoff.race
  if (!handoff.atlas.onCourse || !race?.completed) return
  const record = { runnerName: handoff.from.name, runnerHandle: handoff.from.handle, timeMs: race.timeMs, runId: handoff.runId, batonCode, leg: handoff.leg, at: handoff.at }
  if (!routeLedger.fastest || race.timeMs < routeLedger.fastest.timeMs) routeLedger.fastest = record
  if (race.beatGhost === true && race.ghostTimeMs !== null) routeLedger.ghostRecord = { ...record, ghostTimeMs: race.ghostTimeMs }
}

function playerLedger(atlas: AtlasLedger, playerId: string): AtlasPlayerLedger {
  const existing = atlas.players[playerId]
  if (existing) return existing
  const created: AtlasPlayerLedger = { stations: [], routes: [], legs: 0, routesLit: 0, missions: {} }
  atlas.players[playerId] = created
  return created
}

/** Rebuilds the ledger from recorded handoffs, oldest first: how state written before the Atlas gains one. */
export function rebuildAtlasLedger(state: NetworkState): AtlasLedger {
  state.atlas = freshAtlasLedger()
  const ordered = [...state.handoffs].sort((a, b) => a.at - b.at)
  for (const handoff of ordered) recordAtlasLeg(state, state.batons[handoff.batonId]?.code ?? '', handoff)
  return state.atlas
}

function decayedHeat(route: Pick<AtlasRouteLedger, 'heat' | 'heatAt'>, now: number): number {
  const elapsed = Math.max(0, now - route.heatAt)
  return route.heat * 0.5 ** (elapsed / ATLAS_HEAT_HALF_LIFE_MS)
}

export function heatLevel(heat: number): number {
  return 1 - Math.exp(-heat / ATLAS_HEAT_SCALE)
}

function routeStats(state: NetworkState, route: AtlasRoute, activeBatons: AtlasRouteStats['activeBatons'], now: number): AtlasRouteStats {
  const ledger = state.atlas.routes[route.id]
  const heat = ledger ? decayedHeat(ledger, now) : 0
  return {
    routeId: route.id,
    verifiedRuns: ledger?.runs ?? 0,
    qualifiedRunners: ledger?.runners ?? 0,
    fastest: ledger?.fastest ?? null,
    ghostRecord: ledger?.ghostRecord ?? null,
    activeBatons,
    heat: Math.round(heat * 1000) / 1000,
    heatLevel: Math.round(heatLevel(heat) * 1000) / 1000,
    lit: ledger !== undefined,
    lastRunAt: ledger?.lastRunAt ?? null,
  }
}

function activeBatonsByRoute(state: NetworkState): Map<string, AtlasRouteStats['activeBatons']> {
  const byRoute = new Map<string, AtlasRouteStats['activeBatons']>()
  for (const baton of Object.values(state.batons)) {
    if (baton.status !== 'active') continue
    const list = byRoute.get(baton.route.routeId) ?? []
    list.push({ code: baton.code, displayName: baton.displayName })
    byRoute.set(baton.route.routeId, list)
  }
  return byRoute
}

/** GET /network/atlas: public, and one pass over the catalogue and active batons. */
export function atlasSnapshot(state: NetworkState, now: number): AtlasSnapshot {
  const active = activeBatonsByRoute(state)
  const routes = ATLAS_ROUTES.map(route => routeStats(state, route, active.get(route.id) ?? [], now))
  const stations = ATLAS_STATIONS.map(station => ({ stationId: station.id, lit: state.atlas.stations[station.id] !== undefined, legs: state.atlas.stations[station.id] ?? 0 }))
  return {
    version: ATLAS_VERSION,
    generatedAt: now,
    routes,
    stations,
    lightTheWorld: {
      stationsLit: stations.filter(station => station.lit).length,
      stationsTotal: stations.length,
      routesLit: routes.filter(route => route.lit).length,
      routesTotal: routes.length,
    },
  }
}

/** GET /network/atlas/routes/:routeId. */
export function atlasRouteDetail(state: NetworkState, routeId: string, now: number): AtlasRouteDetail {
  const route = requireAtlasRoute(routeId)
  return { version: ATLAS_VERSION, route, stats: routeStats(state, route, activeBatonsByRoute(state).get(route.id) ?? [], now) }
}

/** Distinct batons the runner sent or received a qualified handoff on. */
function journeysOf(state: NetworkState, playerId: string): number {
  const batons = new Set<string>()
  for (const handoff of state.handoffs) {
    if (handoff.qualified && (handoff.from.id === playerId || handoff.to.id === playerId)) batons.add(handoff.batonId)
  }
  return batons.size
}

/** Routes the runner completed, plus every route leaving a station they visited. */
function discoveredRoutes(player: AtlasPlayerLedger | undefined): number {
  if (!player) return 0
  const routes = new Set(player.routes)
  for (const stationId of player.stations) for (const route of outgoingRoutes(stationId)) routes.add(route.id)
  return routes.size
}

export function atlasProgressFor(state: NetworkState, playerId: string): AtlasProgress {
  const player = state.atlas.players[playerId]
  return {
    stationsVisited: player?.stations.length ?? 0,
    routesCompleted: player?.routes.length ?? 0,
    routesDiscovered: discoveredRoutes(player),
    journeys: journeysOf(state, playerId),
  }
}

export function atlasProfileFor(state: NetworkState, playerId: string): AtlasProfile {
  const player = state.atlas.players[playerId]
  return { ...atlasProgressFor(state, playerId), stations: [...(player?.stations ?? [])], routes: [...(player?.routes ?? [])], missions: atlasMissions(player) }
}

/** The baton's journey across the Atlas: every verified leg, then the holder's leg in progress. */
export function batonAtlas(baton: BatonRecord, handoffs: readonly BatonHandoff[]): BatonAtlas {
  const journey: AtlasJourneyEntry[] = handoffs.map(handoff => ({
    kind: 'leg',
    leg: handoff.leg,
    routeId: handoff.atlas.routeId,
    origin: handoff.atlas.origin,
    destination: handoff.atlas.destination,
    runner: { name: handoff.from.name, handle: handoff.from.handle },
    timeMs: handoff.race?.completed ? handoff.race.timeMs : null,
    txHash: handoff.txHash,
    at: handoff.at,
    backfilled: handoff.atlas.backfilled,
  }))
  if (baton.status !== 'completed') {
    journey.push({ kind: 'leg', leg: baton.handoffCount + 1, ...atlasLegOf(requireAtlasRoute(baton.route.routeId)), runner: { name: baton.holder.name, handle: baton.holder.handle }, timeMs: null, txHash: null, at: baton.updatedAt, backfilled: !isAtlasCourse(baton.route) })
  }
  const { routeId, origin, destination } = baton.route
  return { journey, current: { routeId, origin, destination }, next: nextRouteFor(baton) }
}
