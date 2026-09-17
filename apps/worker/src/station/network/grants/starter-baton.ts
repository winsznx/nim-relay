import { GENESIS_STATION_ID } from '@nim-relay/shared'
import { ApiError } from '../../model'
import { requireAtlasRoute, starterRoute } from '../atlas'
import { createBaton } from '../batons'
import { openingRoute } from '../route'
import type { NetworkContext } from '../types'
import type { GrantRecord } from './ledger'

export const STARTER_BATON_TITLE = 'Starter Baton'

/**
 * The first baton a confirmed starter grant hands its runner: a new Global baton held by them, starting at Genesis
 * Station. The grant is recorded on the baton only; it adds no handoff, so no handoff count, transacting wallet,
 * relay metric, Atlas statistic, ghost, crew or rivalry sees it. Returns the baton id, or null when none could be made.
 */
export function createStarterBaton(context: NetworkContext, record: GrantRecord, now: number): string | null {
  const profile = context.product.players[record.playerId]
  if (!profile) return null
  try {
    const baton = createBaton(context, profile, { mode: 'global', title: STARTER_BATON_TITLE })
    const route = requireAtlasRoute(starterRoute().routeId)
    baton.route = openingRoute(route)
    baton.world = route.world
    baton.starterGrant = { kind: 'treasury_starter_grant', at: now, toRunner: { name: profile.name, handle: profile.handle }, txHash: record.txHash, station: GENESIS_STATION_ID }
    return baton.id
  } catch (error) {
    // The grant itself stands: it is confirmed on chain. The runner can still start a baton of their own.
    console.error('Starter baton not created', record.id, error instanceof ApiError ? error.code : 'unknown')
    return null
  }
}
