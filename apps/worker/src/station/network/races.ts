import type { CanonicalGhost, IssuedRace, RaceConfig, RaceSector, RelayEcho } from '@nim-relay/shared'
import { z } from 'zod'
import { ApiError, type Profile, type Run } from '../model'
import { mac, signedFields } from '../signing'
import { RACE_ISSUE_TTL_MS } from './constants'
import { dailyCourse, dailyKey, recordDailyBest, recordOfficialDaily, selectDailyGhost, type DailyCourse } from './daily'
import { sectorEchoes } from './echoes'
import { loadGhost, sectorGhost } from './ghosts'
import { assertHolder, findBaton, loadRun } from './lookups'
import { inheritedOpeningFlow, isFirstLegOfSector, legConfig, tierFor } from './route'
import { memberFor } from './runners'
import type { BatonRecord, NetworkContext } from './types'

const issueBody = z.object({
  batonId: z.string().optional(),
  daily: z.boolean().optional(),
  practice: z.boolean().optional(),
  ghostRunId: z.string().optional(),
})

interface RacePlan {
  config: RaceConfig
  ghost: CanonicalGhost | null
  sector: RaceSector | null
  echoes: RelayEcho[]
}

/** Issues a signed v5 race: a baton leg on its route sector, the Daily course, or practice. */
export async function issueRace(context: NetworkContext, profile: Profile, body: unknown): Promise<IssuedRace> {
  const input = issueBody.parse(body)
  const practice = input.practice ?? false
  const daily = input.daily ?? false
  const baton = input.batonId ? findBaton(context.state, input.batonId) : null
  if (baton && !practice) assertHolder(baton, profile)
  const now = Date.now()
  const course = dailyCourse(now)
  const officialKey = dailyKey(course.date, profile.id)
  if (daily && !practice && context.state.dailyIssues[officialKey]) throw new ApiError('official_daily_already_started', 409)
  if (input.ghostRunId && !practice) throw new ApiError('selected_ghost_is_practice_only')

  const plan = await planRace(context, profile, { baton, daily, course, ghostRunId: input.ghostRunId ?? null })
  const issued: IssuedRace = {
    networkRace: true,
    practice,
    ...(baton ? { batonId: baton.id } : {}),
    relayLeg: baton?.handoffCount ?? null,
    runId: crypto.randomUUID(),
    playerId: profile.id,
    mode: daily ? 'daily' : (baton?.mode ?? 'quick'),
    config: plan.config,
    expiresAt: now + RACE_ISSUE_TTL_MS,
    target: null,
    mac: '',
    ghost: plan.ghost,
  }
  issued.mac = await mac(context.env.RUN_CHALLENGE_SECRET, signedFields(issued))
  await context.storage.put(`issue:${issued.runId}`, issued)
  if (daily && !practice) context.state.dailyIssues[officialKey] = issued.runId
  return plan.sector ? { ...issued, sector: plan.sector, echoes: plan.echoes } : issued
}

interface RaceRequest {
  baton: BatonRecord | null
  daily: boolean
  course: DailyCourse
  ghostRunId: string | null
}

async function planRace(context: NetworkContext, profile: Profile, request: RaceRequest): Promise<RacePlan> {
  if (request.ghostRunId) return practiceAgainst(context, request.ghostRunId)
  if (request.daily) return { config: request.course.config, ghost: await selectDailyGhost(context, profile.id, request.course), sector: null, echoes: [] }
  if (request.baton) return batonLeg(context, request.baton)
  const config = legConfig({ seed: crypto.randomUUID(), world: 'coast', tier: tierFor(context.state, profile.id) }, 0)
  return { config, ghost: null, sector: null, echoes: [] }
}

/** A selected historic ghost is raced on exactly its own course, whichever engine version recorded it. */
async function practiceAgainst(context: NetworkContext, ghostRunId: string): Promise<RacePlan> {
  const ghost = await loadGhost(context, ghostRunId)
  if (!ghost) throw new ApiError('verified_replay_not_found', 404)
  return { config: ghost.config, ghost, sector: null, echoes: [] }
}

async function batonLeg(context: NetworkContext, baton: BatonRecord): Promise<RacePlan> {
  const previousRun = await loadRun(context.storage, baton.previousRunId)
  return {
    config: legConfig(baton.route, inheritedOpeningFlow(previousRun)),
    ghost: sectorGhost(context, baton, previousRun),
    sector: { index: baton.route.sector, startedLeg: baton.route.sectorStartedLeg, firstLeg: isFirstLegOfSector(baton) },
    echoes: sectorEchoes(context.state, baton.id, baton.route.sector),
  }
}

/** Applies a replayed run to network records. Throws before any change when the run no longer fits its leg. */
export function recordRun(context: NetworkContext, run: Run, profile: Profile): void {
  const { issued } = run
  if (issued.mode === 'daily') recordDailyBest(context.state, run)
  if (issued.practice) return
  const baton = issued.batonId ? findBaton(context.state, issued.batonId) : null
  if (baton) {
    assertHolder(baton, profile)
    if (baton.handoffCount !== issued.relayLeg) throw new ApiError('relay_leg_changed', 409)
  }
  if (issued.mode === 'daily') recordOfficialDaily(context.state, run, profile)
  if (run.result.completed) countCompletedRun(context, profile, baton, issued.relayLeg)
}

function countCompletedRun(context: NetworkContext, profile: Profile, baton: BatonRecord | null, relayLeg: number | null): void {
  const member = memberFor(context.state, profile.id, Date.now())
  member.completedRuns++
  if (!baton || relayLeg === null) return
  const counted = member.legMarks[baton.id]
  if (counted !== undefined && counted >= relayLeg) return
  member.legs++
  member.legMarks[baton.id] = relayLeg
}
