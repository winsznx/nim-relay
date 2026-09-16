import { relayLeg } from '@nim-relay/game-engine'
import { isRelayLegResult, type BatonRoute, type RaceConfig, type RelayLegConfig, type RelayLegTier, type StationWorld } from '@nim-relay/shared'
import type { Run } from '../model'
import { NEW_COURIER_COMPLETED_RUNS, SECTOR_HANDOFFS, VETERAN_QUALIFIED_HANDOFFS } from './constants'
import { handoffsSentBy } from './lookups'
import type { BatonRecord, NetworkState } from './types'

export function sectorSeed(code: string, sector: number): string {
  return `relay-${code}-s${sector}`
}

export function openingRoute(code: string, world: StationWorld, tier: RelayLegTier): BatonRoute {
  return { seed: sectorSeed(code, 0), world, tier, sector: 0, sectorStartedLeg: 0 }
}

export function worldAfter(world: StationWorld): StationWorld {
  const index = relayLeg.WORLDS.indexOf(world)
  return relayLeg.WORLDS[(index + 1) % relayLeg.WORLDS.length]!
}

/**
 * Opens the next sector (next world, new seed) once the current one has seen SECTOR_HANDOFFS qualified
 * handoffs. The runner receiving the baton opens it, so their experience sets its tier. Quick matches keep one sector.
 */
export function advanceRoute(baton: BatonRecord, openerTier: RelayLegTier): void {
  if (baton.mode === 'quick') return
  if (baton.handoffCount - baton.route.sectorStartedLeg < SECTOR_HANDOFFS) return
  const sector = baton.route.sector + 1
  const world = worldAfter(baton.route.world)
  baton.route = { seed: sectorSeed(baton.code, sector), world, tier: openerTier, sector, sectorStartedLeg: baton.handoffCount }
  baton.world = world
}

export function isFirstLegOfSector(baton: BatonRecord): boolean {
  return baton.handoffCount <= baton.route.sectorStartedLeg
}

export function legConfig(course: Pick<BatonRoute, 'seed' | 'world' | 'tier'>, openingFlow: number): RelayLegConfig {
  return { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: course.seed, world: course.world, tier: course.tier, openingFlow }
}

/** A ghost is raceable on a sector only on the identical course; inherited opening FLOW may differ. */
export function racesRoute(config: RaceConfig, route: BatonRoute): boolean {
  return config.engineVersion === '5' && config.seed === route.seed && config.world === route.world && config.tier === route.tier
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
