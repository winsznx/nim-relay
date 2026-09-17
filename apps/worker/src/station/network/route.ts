import { relayLeg } from '@nim-relay/game-engine'
import { atlasLegOf, atlasRoute, isRelayLegResult, type AtlasRoute, type BatonRoute, type RaceConfig, type RelayLegGhostline, type RelayLegTier, type RelayLegV6Config } from '@nim-relay/shared'
import type { Run } from '../model'
import { NEW_COURIER_COMPLETED_RUNS, VETERAN_QUALIFIED_HANDOFFS } from './constants'
import { handoffsSentBy } from './lookups'
import type { BatonRecord, NetworkState } from './types'

export type Course = Pick<BatonRoute, 'seed' | 'world' | 'tier'>

/** What a v6 leg is issued with besides its course. All of it is signed with the config. */
export interface LegTerms {
  openingFlow: number
  tetherSaves: 0 | 1
  ghostline: RelayLegGhostline | null
}

export function sectorSeed(code: string, sector: number): string {
  return `relay-${code}-s${sector}`
}

/** A new baton's first leg: sector 0 on its Atlas route's own course. */
export function openingRoute(route: AtlasRoute): BatonRoute {
  return { seed: route.seed, world: route.world, tier: route.tier, sector: 0, sectorStartedLeg: 0, ...atlasLegOf(route) }
}

/** Whether the course is the Atlas route's own course, rather than a pre-Atlas sector course placed on it. */
export function isAtlasCourse(route: BatonRoute): boolean {
  return atlasRoute(route.routeId)?.seed === route.seed
}

/**
 * Moves the baton onto the Atlas route its next leg races, once custody moved. The same route on its own course keeps
 * the sector, so the next runner chases the previous runner's ghost; any other route opens a new sector at this leg.
 */
export function moveToAtlasRoute(baton: BatonRecord, route: AtlasRoute): void {
  if (route.id === baton.route.routeId && isAtlasCourse(baton.route)) return
  baton.route = { ...openingRoute(route), sector: baton.route.sector + 1, sectorStartedLeg: baton.handoffCount }
  baton.world = route.world
}

export function isFirstLegOfSector(baton: Pick<BatonRecord, 'handoffCount'>, route: BatonRoute): boolean {
  return baton.handoffCount <= route.sectorStartedLeg
}

/**
 * The route the baton's next leg races. A sector that already has legs continues only while the previous canonical
 * run can be raced on it; after a v5 leg, or without the run, a new sector starts at this leg on the same Atlas route
 * with no ghost. An Atlas course keeps its seed and tier; a pre-Atlas course gets a new seed, opened at `openerTier`.
 */
export function nextLegRoute(baton: BatonRecord, previousRun: Run | undefined, openerTier: RelayLegTier): BatonRoute {
  if (isFirstLegOfSector(baton, baton.route) || sectorGhostRun(baton, baton.route, previousRun)) return baton.route
  const sector = baton.route.sector + 1
  const course = isAtlasCourse(baton.route) ? { seed: baton.route.seed, tier: baton.route.tier } : { seed: sectorSeed(baton.code, sector), tier: openerTier }
  return { ...baton.route, ...course, sector, sectorStartedLeg: baton.handoffCount }
}

/** The previous runner's canonical run when the next leg on `route` races it as a ghost. */
export function sectorGhostRun(baton: BatonRecord, route: BatonRoute, previousRun: Run | undefined): Run | undefined {
  if (isFirstLegOfSector(baton, route)) return undefined
  if (!previousRun || previousRun.issued.runId !== baton.previousRunId) return undefined
  return raceableOn(previousRun.issued.config, route) ? previousRun : undefined
}

export function legConfig(course: Course, terms: LegTerms): RelayLegV6Config {
  return {
    engineVersion: '6',
    challenge: 'relay-leg',
    challengeVersion: '6',
    seed: course.seed,
    world: course.world,
    tier: course.tier,
    openingFlow: terms.openingFlow,
    tetherSaves: terms.tetherSaves,
    ghostline: terms.ghostline,
  }
}

/** A relay leg raced on the route's course, by either relay engine. Inherited opening FLOW may differ. */
export function racesRoute(config: RaceConfig, route: BatonRoute): boolean {
  return config.engineVersion !== '4' && config.seed === route.seed && config.world === route.world && config.tier === route.tier
}

/** Only a v6 leg on the identical course can be raced as a ghost: v5 ghosts are watch-only. */
export function raceableOn(config: RaceConfig, route: BatonRoute): boolean {
  return config.engineVersion === '6' && racesRoute(config, route)
}

/** FLOW inherited from the previous canonical run: a quarter of its average, capped at MAX_OPENING_FLOW. */
export function inheritedOpeningFlow(previous: Run | undefined): number {
  if (!previous || !isRelayLegResult(previous.result) || previous.result.ticks <= 0) return 0
  const averageFlow = previous.result.metrics.flowSum / previous.result.ticks
  return Math.min(relayLeg.MAX_OPENING_FLOW, Math.trunc(averageFlow / 4))
}

/** Forgiving courses until a runner has completed 3 verified runs; veteran courses from 40 qualified handoffs. */
export function tierFor(state: NetworkState, playerId: string): RelayLegTier {
  if (handoffsSentBy(state, playerId).length >= VETERAN_QUALIFIED_HANDOFFS) return 2
  const completedRuns = state.members[playerId]?.completedRuns ?? 0
  return completedRuns < NEW_COURIER_COMPLETED_RUNS ? 0 : 1
}
