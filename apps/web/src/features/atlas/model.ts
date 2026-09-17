import {
  ATLAS_ROUTES,
  ATLAS_STATIONS,
  atlasRoute,
  atlasStation,
  type AtlasJourneyEntry,
  type AtlasLeg,
  type AtlasNextRoute,
  type AtlasRoute,
  type AtlasRouteStats,
  type AtlasSnapshot,
  type AtlasStation,
} from '@nim-relay/shared'
import { formatRaceTime, worldName } from '../relays/format'

/**
 * View models for the Relay Atlas. Stations are game-world destinations on the globe, never where a runner is. Every
 * number comes from the relay's verified record; a route nobody raced says so rather than showing zeros as records.
 */

export function stationName(id: string): string {
  return atlasStation(id)?.name ?? 'Unknown station'
}

export function stationOf(id: string): AtlasStation | null {
  return atlasStation(id) ?? null
}

export function routeTitle(route: Pick<AtlasLeg, 'origin' | 'destination'>): string {
  return `${stationName(route.origin)} to ${stationName(route.destination)}`
}

const TIER_NAMES = ['Opening course', 'Standard course', 'Veteran course'] as const

export function tierName(tier: AtlasRoute['tier']): string {
  return TIER_NAMES[tier]
}

export type HeatBand = 'dark' | 'warm' | 'hot' | 'blazing'

/** Words for a route's decayed verified activity. */
export function heatBand(stats: Pick<AtlasRouteStats, 'lit' | 'heatLevel'> | undefined): HeatBand {
  if (!stats?.lit) return 'dark'
  if (stats.heatLevel >= 0.66) return 'blazing'
  if (stats.heatLevel >= 0.3) return 'hot'
  return 'warm'
}

export function heatLabel(band: HeatBand): string {
  switch (band) {
    case 'dark':
      return 'Dark, never raced'
    case 'warm':
      return 'Warm'
    case 'hot':
      return 'Hot'
    case 'blazing':
      return 'Blazing'
  }
}

export interface RouteOption {
  routeId: string
  destination: AtlasStation
  world: string
  tier: string
  heat: HeatBand
  /** "Fastest 41.20s by Mariana", or null when no on-course run exists. */
  record: string | null
  /** Races the route just raced again, so the next runner chases this runner's ghost. */
  rerun: boolean
  recommended: boolean
}

export function recordLine(stats: AtlasRouteStats | undefined): string | null {
  const fastest = stats?.fastest
  return fastest ? `Fastest ${formatRaceTime(fastest.timeMs)} by ${fastest.runnerName}` : null
}

/** The routes a holder can send the next leg along, in the order the relay offers them. */
export function routeOptions(next: AtlasNextRoute, snapshot: AtlasSnapshot | undefined): RouteOption[] {
  const stats = new Map((snapshot?.routes ?? []).map(entry => [entry.routeId, entry]))
  return next.routeIds.flatMap(routeId => {
    const route = atlasRoute(routeId)
    const destination = route && atlasStation(route.to)
    if (!route || !destination) return []
    const routeStats = stats.get(routeId)
    return [
      {
        routeId,
        destination,
        world: worldName(route.world),
        tier: tierName(route.tier),
        heat: heatBand(routeStats),
        record: recordLine(routeStats),
        rerun: routeId === next.rerunRouteId,
        recommended: routeId === next.defaultRouteId,
      },
    ]
  })
}

export interface LightTheWorld {
  stationsLit: number
  stationsTotal: number
  routesLit: number
  routesTotal: number
  /** 0..1 over stations and routes together. */
  share: number
}

/** Community progress. Before the Atlas loads the totals are the catalogue's and nothing counts as lit. */
export function lightTheWorld(snapshot: AtlasSnapshot | undefined): LightTheWorld {
  const counts = snapshot?.lightTheWorld ?? { stationsLit: 0, stationsTotal: ATLAS_STATIONS.length, routesLit: 0, routesTotal: ATLAS_ROUTES.length }
  const total = counts.stationsTotal + counts.routesTotal
  return { ...counts, share: total === 0 ? 0 : (counts.stationsLit + counts.routesLit) / total }
}

export interface JourneyStep {
  key: string
  kind: 'leg' | 'grant'
  from: string
  to: string
  title: string
  detail: string
  at: number
  txHash: string | null
  /** A leg still being raced. */
  inProgress: boolean
  backfilled: boolean
}

/** The baton's Atlas journey as ordered steps. A treasury starter baton is a gift at Genesis Station, never a handoff. */
export function journeySteps(entries: readonly AtlasJourneyEntry[]): JourneyStep[] {
  return entries.map((entry, index) => {
    if (entry.kind === 'treasury_starter_grant') {
      return {
        key: `grant-${index}`,
        kind: 'grant',
        from: entry.station,
        to: entry.station,
        title: 'Starter baton from Genesis Station',
        detail: `Given to ${entry.toRunner.name}`,
        at: entry.at,
        txHash: entry.txHash,
        inProgress: false,
        backfilled: false,
      }
    }
    const inProgress = entry.txHash === null
    const time = entry.timeMs === null ? null : formatRaceTime(entry.timeMs)
    return {
      key: `leg-${entry.leg}`,
      kind: 'leg',
      from: entry.origin,
      to: entry.destination,
      title: `Leg ${entry.leg}: ${routeTitle(entry)}`,
      detail: inProgress ? `${entry.runner.name} is carrying it now` : `${entry.runner.name}${time ? `, ${time}` : ''}`,
      at: entry.at,
      txHash: entry.txHash,
      inProgress,
      backfilled: entry.backfilled,
    }
  })
}

/** Distinct stations a baton has touched, in the order it reached them. */
export function stationsOnJourney(hops: readonly AtlasLeg[]): string[] {
  const seen: string[] = []
  for (const hop of hops) {
    for (const station of [hop.origin, hop.destination]) if (!seen.includes(station)) seen.push(station)
  }
  return seen
}
