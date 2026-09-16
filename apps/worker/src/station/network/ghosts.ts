import type { CanonicalGhost } from '@nim-relay/shared'
import type { Run } from '../model'
import { canonicalGhost } from '../race-engines'
import { loadRun } from './lookups'
import { racesRoute } from './route'
import { consentedCountry } from './runners'
import type { BatonRecord, NetworkContext } from './types'

/** Only completed verified runs become ghosts. */
export function ghostOfRun(context: NetworkContext, run: Run | undefined): CanonicalGhost | null {
  if (!run || !run.result.completed) return null
  const playerId = run.issued.playerId
  const name = context.product.players[playerId]?.name ?? 'Courier'
  return canonicalGhost(run, { name, country: consentedCountry(context.state, playerId) })
}

export async function loadGhost(context: NetworkContext, runId: string | null): Promise<CanonicalGhost | null> {
  return ghostOfRun(context, await loadRun(context.storage, runId))
}

/**
 * The ghost the holder races next: the previous runner's canonical run on the same sector course.
 * The first leg of a sector sets the time instead.
 */
export function sectorGhost(context: NetworkContext, baton: BatonRecord, previousRun: Run | undefined): CanonicalGhost | null {
  if (baton.handoffCount <= baton.route.sectorStartedLeg) return null
  if (!previousRun || previousRun.issued.runId !== baton.previousRunId) return null
  if (!racesRoute(previousRun.issued.config, baton.route)) return null
  return ghostOfRun(context, previousRun)
}
