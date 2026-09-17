import { relayLeg } from '@nim-relay/game-engine'
import type { IssuedRace, LegProgressInput, LegProgressResult, RelayLegV6Config } from '@nim-relay/shared'
import { z } from 'zod'
import { ApiError, type Profile } from '../model'
import { assertHolder, findBaton, loadRun } from './lookups'
import type { NetworkContext } from './types'

/** Network path of live progress reports, relative to /network. */
export const LEG_PROGRESS_PATH = '/leg/progress'

const ONE = 65_536
const MS_PER_TICK = 1000 / relayLeg.TICK_RATE
/** Full FLOW in Relay Rush on a rail over a boost pad: no courier moves faster along a path. */
const TOP_SPEED = relayLeg.BASE_SPEED + relayLeg.FLOW_SPEED + relayLeg.RUSH_SPEED + relayLeg.RAIL_SPEED + relayLeg.PAD_SPEED
/** No leg runs longer than MAX_TICKS, so no ghost can lead or trail by more. */
const MAX_LEG_MS = Math.ceil(relayLeg.MAX_TICKS * MS_PER_TICK)

const progressBody = z
  .object({
    runId: z.string().uuid(),
    tick: z.number().int().min(0).max(relayLeg.MAX_TICKS),
    dist: z.number().int().min(0),
    finishDist: z.number().int().positive(),
    ghostDeltaMs: z.number().int().min(-MAX_LEG_MS).max(MAX_LEG_MS).nullable(),
    path: z.enum(['main', 'safe', 'risk']),
  })
  .refine(input => input.dist <= input.finishDist)

type BatonLegIssue = IssuedRace & { batonId: string; relayLeg: number; config: RelayLegV6Config }

/** A signed v6 leg of a baton that counts: not practice and not the Daily. */
function isBatonLeg(issued: IssuedRace): issued is BatonLegIssue {
  return issued.networkRace === true && issued.batonId !== undefined && !issued.practice && issued.mode !== 'daily' && issued.relayLeg !== null && issued.config.engineVersion === '6'
}

/**
 * Takes the holder's progress on their own issued, unexpired and unsubmitted baton leg. It reads network state and
 * never writes it: an accepted report only replaces the baton's live report.
 */
export async function reportLegProgress(context: NetworkContext, profile: Profile, body: unknown, now: number): Promise<LegProgressResult> {
  const input = progressBody.parse(body)
  const issued = await context.storage.get<IssuedRace>(`issue:${input.runId}`)
  if (!issued || issued.playerId !== profile.id) throw new ApiError('run_not_found', 404)
  if (!isBatonLeg(issued)) throw new ApiError('not_a_baton_leg', 409)
  if (now > issued.expiresAt) throw new ApiError('run_expired', 410)
  if (await loadRun(context.storage, issued.runId)) throw new ApiError('run_already_submitted', 409)
  const baton = findBaton(context.state, issued.batonId)
  assertHolder(baton, profile)
  if (baton.handoffCount !== issued.relayLeg) throw new ApiError('relay_leg_changed', 409)
  if (!isPlausibleProgress(input, relayLeg.buildTrack(issued.config), issued.config.ghostline !== null)) throw new ApiError('invalid_progress')
  if (context.live.tooSoon(issued.runId, now)) return { accepted: false }
  await context.live.record({
    batonId: baton.id,
    runId: issued.runId,
    runnerId: profile.id,
    runnerName: baton.holder.name,
    runnerHandle: baton.holder.handle,
    relayLeg: issued.relayLeg,
    progress: Math.round((input.dist / input.finishDist) * 10_000) / 10_000,
    ghostDeltaMs: input.ghostDeltaMs,
    world: issued.config.world,
    sector: baton.route.sector,
    updatedAt: now,
    expiresAt: issued.expiresAt,
  })
  return { accepted: true }
}

/**
 * Whether a report could come from a real run of `track`: its finish line, a distance reachable in `tick` ticks at
 * top speed on the quickest path, a fork path exactly while inside a fork, and a ghost gap no wider than the ticks
 * raced allow. `hasGhost` is whether the leg carries a ghostline.
 */
export function isPlausibleProgress(input: LegProgressInput, track: relayLeg.Track, hasGhost: boolean): boolean {
  if (input.finishDist !== track.finishDist) return false
  const quickestPath = track.forks.reduce((quickest, fork) => Math.max(quickest, fork.riskProgress), ONE)
  const fastestPerTick = Math.trunc((TOP_SPEED * quickestPath) / ONE)
  if (input.dist > input.tick * fastestPerTick) return false
  const onFork = relayLeg.forkAt(track, input.dist) !== null
  if ((input.path !== 'main') !== onFork) return false
  if (input.ghostDeltaMs === null) return true
  return hasGhost && input.ghostDeltaMs <= Math.ceil(input.tick * MS_PER_TICK) && input.ghostDeltaMs >= Math.floor((input.tick - relayLeg.MAX_TICKS) * MS_PER_TICK)
}
