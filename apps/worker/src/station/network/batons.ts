import { relayLeg } from '@nim-relay/game-engine'
import type { BatonAppearance, BatonDetail, BatonHandoff, BatonLive, BatonMode, BatonStop, NetworkBaton } from '@nim-relay/shared'
import { ApiError, type Profile } from '../model'
import { BATON_HOLD_MS, BATON_VALUE_LUNA, HANDOFF_MILESTONES, MAX_ACTIVE_ORIGIN_BATONS, MAX_NOTABLE_RUNS } from './constants'
import { batonEchoes } from './echoes'
import { sectorGhost } from './ghosts'
import { batonDisplayName, nextSerial, shortCode } from './identity'
import { handoffsOf, loadRun, notify, openIntentFor } from './lookups'
import { handoffForViewer } from './notes'
import { openingRoute, tierFor } from './route'
import { networkRunner, requireCourier } from './runners'
import type { BatonRecord, NetworkContext } from './types'

export interface CreateBatonInput {
  mode: BatonMode
  title: string
  recipient?: string | undefined
  bestOf?: 3 | 5 | undefined
  crewId?: string | undefined
}

export function createBaton(context: NetworkContext, profile: Profile, input: CreateBatonInput, rematchOf: string | null = null): BatonRecord {
  const { state } = context
  const activeOrigins = Object.values(state.batons).filter(baton => baton.origin.id === profile.id && baton.status === 'active')
  if (activeOrigins.length >= MAX_ACTIVE_ORIGIN_BATONS) throw new ApiError('finish_an_active_journey_first', 429)
  const opponent = input.recipient ? requireCourier(context.product, input.recipient, profile) : null
  if (input.mode === 'quick' && !opponent) throw new ApiError('choose_your_opponent')
  const crewMismatch = Boolean(input.crewId) && input.crewId !== profile.crewId
  if (input.mode === 'crew' && (!profile.crewId || crewMismatch)) throw new ApiError('join_a_crew_first')

  const now = Date.now()
  const runner = networkRunner(state, profile)
  const code = shortCode()
  const serial = nextSerial(state, input.mode)
  const world = relayLeg.WORLDS[Object.keys(state.batons).length % relayLeg.WORLDS.length]!
  const baton: BatonRecord = {
    id: crypto.randomUUID(),
    code,
    serial,
    title: input.title,
    displayName: batonDisplayName(input.mode, serial, input.title),
    mode: input.mode,
    network: context.env.NIMIQ_NETWORK,
    value: BATON_VALUE_LUNA,
    origin: runner,
    holder: runner,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    status: 'active',
    handoffCount: 0,
    world,
    route: openingRoute(code, world, tierFor(state, profile.id)),
    previousRunId: null,
    crewId: input.mode === 'crew' ? profile.crewId : null,
    rivalId: null,
    recipientId: opponent?.id ?? null,
    recipientReservedAt: opponent ? now : null,
    recipientAcceptedAt: null,
    expiresAt: now + BATON_HOLD_MS,
    lineage: { countries: [], runners: 1, ghostWins: 0 },
    quick: input.mode === 'quick' && opponent
      ? { players: [profile.id, opponent.id], bestOf: input.bestOf ?? 3, scores: { [profile.id]: 0, [opponent.id]: 0 }, rounds: 0, winnerId: null, rematchOf }
      : null,
  }
  state.batons[baton.id] = baton
  if (opponent) {
    notify(state, opponent.id, {
      type: rematchOf ? 'rematch' : 'your_turn',
      title: `${profile.name} invited you`,
      body: `${baton.displayName} is ready. Accept the journey before the first pass.`,
      batonId: baton.id,
    })
  }
  return baton
}

export function rematchBaton(context: NetworkContext, profile: Profile, original: BatonRecord): BatonRecord {
  if (!original.quick || !original.quick.players.includes(profile.id)) throw new ApiError('match_not_found', 404)
  if (original.status === 'active') throw new ApiError('finish_match_first', 409)
  const opponent = original.quick.players.find(id => id !== profile.id)
  if (!opponent) throw new ApiError('match_not_found', 404)
  context.state.rematches++
  return createBaton(context, profile, { mode: 'quick', title: original.title, bestOf: original.quick.bestOf, recipient: opponent }, original.id)
}

export function presentBaton(baton: BatonRecord, handoffs: readonly BatonHandoff[], now: number): NetworkBaton {
  const aliveMs = (baton.completedAt ?? now) - baton.createdAt
  return { ...baton, appearance: batonAppearance(baton, now), aliveMs, transactingWallets: transactingWallets(handoffs) }
}

/**
 * Presented baton with its ordered globe stops (origin, then every recipient, as recorded with consent at the time)
 * and the leg its holder is racing, as snapshots and baton pages show it.
 */
export function presentBatonWithStops(baton: BatonRecord, handoffs: readonly BatonHandoff[], now: number, live: BatonLive | null): NetworkBaton {
  const stops: BatonStop[] = [{ countryCode: baton.origin.country }, ...handoffs.map(handoff => ({ countryCode: handoff.to.country }))]
  return { ...presentBaton(baton, handoffs, now), stops, live }
}

function batonAppearance(baton: BatonRecord, now: number): BatonAppearance {
  return {
    handoffCount: baton.handoffCount,
    ageMs: now - baton.createdAt,
    countries: baton.lineage.countries.length,
    ghostWins: baton.lineage.ghostWins,
    milestones: HANDOFF_MILESTONES.filter(milestone => baton.handoffCount >= milestone),
  }
}

export function transactingWallets(handoffs: readonly BatonHandoff[]): number {
  return new Set(handoffs.filter(handoff => handoff.qualified).flatMap(handoff => [handoff.from.wallet, handoff.to.wallet])).size
}

/**
 * `profile` is the runner acting on the baton, who also sees its open pass while holding it. `viewerId` reads the
 * private notes of the handoffs they sent or received and defaults to that runner; the public baton page passes only
 * its signed-in reader, or null.
 */
export async function batonDetail(context: NetworkContext, baton: BatonRecord, profile: Profile | null, viewerId: string | null = profile?.id ?? null): Promise<BatonDetail> {
  const handoffs = handoffsOf(context.state, baton.id)
  const previousRun = await loadRun(context.storage, baton.previousRunId)
  const now = Date.now()
  const live = context.live.liveFor(baton, now)
  return {
    baton: presentBatonWithStops(baton, handoffs, now, live),
    handoffs: handoffs.map(handoff => handoffForViewer(handoff, viewerId)),
    ghost: sectorGhost(context, baton, previousRun),
    pendingHandoff: profile?.id === baton.holder.id ? openIntentFor(context.state, baton.id) : null,
    notableRuns: await notableRuns(context, handoffs),
    echoes: batonEchoes(context.state, baton.id),
    live,
  }
}

async function notableRuns(context: NetworkContext, handoffs: readonly BatonHandoff[]): Promise<BatonDetail['notableRuns']> {
  return Promise.all(
    handoffs.slice(-MAX_NOTABLE_RUNS).map(async handoff => {
      const score = handoff.race ? handoff.race.score : ((await loadRun(context.storage, handoff.runId))?.result.score ?? 0)
      return { runId: handoff.runId, name: handoff.from.name, score, resultHash: handoff.resultHash }
    }),
  )
}
