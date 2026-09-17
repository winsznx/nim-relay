import type { CanonicalGhost, IssuedRace, RaceAtlas, RaceSector, RelayEcho, RelayLegV6Config } from '@nim-relay/shared'
import { z } from 'zod'
import { ApiError, type Profile, type Run } from '../model'
import { mac, signedFields } from '../signing'
import { LEG_TETHER_SAVES, OFFICIAL_DAILY_TETHER_SAVES, RACE_ISSUE_TTL_MS } from './constants'
import { dailyCourse, dailyKey, recordDailyBest, recordOfficialDaily, selectDailyGhostRun, type DailyCourse } from './daily'
import { legEchoes } from './echoes'
import { draftedGhost, ghostOfRun, raceableGhost } from './ghosts'
import { assertHolder, findBaton, handoffsOf, loadRun } from './lookups'
import { inheritedOpeningFlow, isFirstLegOfSector, legConfig, nextLegRoute, sectorGhostRun, tierFor, type LegTerms } from './route'
import { memberFor } from './runners'
import type { BatonRecord, NetworkContext } from './types'

const issueBody = z.object({
  batonId: z.string().optional(),
  daily: z.boolean().optional(),
  practice: z.boolean().optional(),
  ghostRunId: z.string().optional(),
})

/** The official Daily attempt: no inherited FLOW, no tether save and no ghostline to draft. */
const OFFICIAL_DAILY_TERMS: LegTerms = { openingFlow: 0, tetherSaves: OFFICIAL_DAILY_TETHER_SAVES, ghostline: null }

interface RacePlan {
  config: RelayLegV6Config
  ghost: CanonicalGhost | null
  sector: RaceSector | null
  echoes: RelayEcho[]
  atlas?: RaceAtlas
}

/** Issues a signed v6 race: a baton leg on its route sector, the Daily course, or practice. */
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

  const plan = await planRace(context, profile, { baton, daily, practice, course, ghostRunId: input.ghostRunId ?? null })
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
  return plan.sector ? { ...issued, sector: plan.sector, echoes: plan.echoes, ...(plan.atlas ? { atlas: plan.atlas } : {}) } : issued
}

interface RaceRequest {
  baton: BatonRecord | null
  daily: boolean
  practice: boolean
  course: DailyCourse
  ghostRunId: string | null
}

async function planRace(context: NetworkContext, profile: Profile, request: RaceRequest): Promise<RacePlan> {
  if (request.ghostRunId) return practiceAgainst(context, request.ghostRunId)
  if (request.daily) return dailyRace(context, profile, request.course, request.practice)
  if (request.baton) return batonLeg(context, request.baton, request.practice)
  const config = legConfig({ seed: crypto.randomUUID(), world: 'coast', tier: tierFor(context.state, profile.id) }, { openingFlow: 0, tetherSaves: LEG_TETHER_SAVES, ghostline: null })
  return { config, ghost: null, sector: null, echoes: [] }
}

/** A selected v6 ghost is raced on its own course with the FLOW it opened with; earlier ghosts are watch-only. */
async function practiceAgainst(context: NetworkContext, ghostRunId: string): Promise<RacePlan> {
  const run = await loadRun(context.storage, ghostRunId)
  if (!ghostOfRun(context, run)) throw new ApiError('verified_replay_not_found', 404)
  const drafted = await draftedGhost(context, run)
  if (!drafted) throw new ApiError('ghost_is_watch_only', 409)
  const { config } = drafted.ghost
  return { config: legConfig(config, { openingFlow: config.openingFlow, tetherSaves: LEG_TETHER_SAVES, ghostline: drafted.ghostline }), ghost: drafted.ghost, sector: null, echoes: [] }
}

/**
 * Both rides show the skill-matched ghost. Practice drafts it; the official attempt races it without its ghostline and
 * without a tether save, so no ranked result depends on which ghost a runner drew.
 */
async function dailyRace(context: NetworkContext, profile: Profile, course: DailyCourse, practice: boolean): Promise<RacePlan> {
  const ghostRun = await selectDailyGhostRun(context, profile.id, course)
  if (!practice) return { config: legConfig(course, OFFICIAL_DAILY_TERMS), ghost: raceableGhost(context, ghostRun), sector: null, echoes: [] }
  const drafted = await draftedGhost(context, ghostRun)
  return { config: legConfig(course, { openingFlow: 0, tetherSaves: LEG_TETHER_SAVES, ghostline: drafted?.ghostline ?? null }), ghost: drafted?.ghost ?? null, sector: null, echoes: [] }
}

/**
 * The holder's own leg moves the baton onto the route it races, a new sector when the previous canonical run cannot be
 * raced on the current one, before the ticket is signed. Practice rides that course without moving the baton.
 */
async function batonLeg(context: NetworkContext, baton: BatonRecord, practice: boolean): Promise<RacePlan> {
  const previousRun = await loadRun(context.storage, baton.previousRunId)
  const route = nextLegRoute(baton, previousRun, tierFor(context.state, baton.holder.id))
  if (!practice) {
    baton.route = route
    baton.world = route.world
  }
  const drafted = await draftedGhost(context, sectorGhostRun(baton, route, previousRun))
  const previousRoute = handoffsOf(context.state, baton.id).at(-1)?.atlas.routeId
  const ghost: RaceAtlas['ghost'] = drafted ? 'previous-runner' : previousRoute !== undefined && previousRoute !== route.routeId ? 'different-route' : 'none'
  return {
    config: legConfig(route, { openingFlow: inheritedOpeningFlow(previousRun), tetherSaves: LEG_TETHER_SAVES, ghostline: drafted?.ghostline ?? null }),
    ghost: drafted?.ghost ?? null,
    sector: { index: route.sector, startedLeg: route.sectorStartedLeg, firstLeg: isFirstLegOfSector(baton, route) },
    echoes: legEchoes(context.state, baton.id, route.sector),
    atlas: { routeId: route.routeId, origin: route.origin, destination: route.destination, ghost },
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
