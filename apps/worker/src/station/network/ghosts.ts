import { isRelayLegV6Ghost, type CanonicalGhost, type RelayLegGhostline, type RelayLegV6Ghost } from '@nim-relay/shared'
import type { Run } from '../model'
import { canonicalGhost, deriveGhostline, isRelayLegV6Run, type RelayLegV6Run } from '../race-engines'
import { loadRun } from './lookups'
import { sectorGhostRun } from './route'
import { consentedCountry } from './runners'
import type { BatonRecord, NetworkContext } from './types'

/** A ghost a v6 leg drafts: the verified run the client shows, and the ghostline its signed config carries. */
export interface DraftedGhost {
  ghost: RelayLegV6Ghost
  ghostline: RelayLegGhostline
}

/** Only completed verified runs become ghosts; a failed leg never completes. */
export function ghostOfRun(context: NetworkContext, run: Run | undefined): CanonicalGhost | null {
  if (!run || !run.result.completed) return null
  const playerId = run.issued.playerId
  const name = context.product.players[playerId]?.name ?? 'Courier'
  return canonicalGhost(run, { name, country: consentedCountry(context.state, playerId) })
}

export async function loadGhost(context: NetworkContext, runId: string | null): Promise<CanonicalGhost | null> {
  return ghostOfRun(context, await loadRun(context.storage, runId))
}

/** The run as a ghost a v6 leg can race, or null: earlier ghosts still replay to watch, but no leg races them. */
export function raceableGhost(context: NetworkContext, run: Run | undefined): RelayLegV6Ghost | null {
  const ghost = ghostOfRun(context, run)
  return ghost && isRelayLegV6Ghost(ghost) ? ghost : null
}

/** A raceable ghost together with the ghostline a leg drafts. */
export async function draftedGhost(context: NetworkContext, run: Run | undefined): Promise<DraftedGhost | null> {
  const ghost = raceableGhost(context, run)
  if (!run || !ghost || !isRelayLegV6Run(run)) return null
  return { ghost, ghostline: await ghostlineOf(context.storage, run) }
}

/**
 * The ghost the holder races next on the baton's current route: the previous runner's canonical v6 run on the same
 * sector course. The first leg of a sector sets the time instead.
 */
export function sectorGhost(context: NetworkContext, baton: BatonRecord, previousRun: Run | undefined): CanonicalGhost | null {
  return ghostOfRun(context, sectorGhostRun(baton, baton.route, previousRun))
}

/**
 * Derived from the run's replay on its own issued config the first time a leg races it, then kept on the run record so
 * every later leg reuses it. The issued config and verified result of the run itself never change.
 */
async function ghostlineOf(storage: DurableObjectStorage, run: RelayLegV6Run): Promise<RelayLegGhostline> {
  if (run.ghostline) return run.ghostline
  const ghostline = deriveGhostline(run)
  await storage.put(`run:${run.issued.runId}`, { ...run, ghostline })
  return ghostline
}
