import type { BatonHandoff, HandoffRace, NetworkHandoffIntent, NetworkRival } from '@nim-relay/shared'
import type { Profile, Run } from '../model'
import { awardHandoffAchievements, awardRivalChampions } from './achievements'
import { defaultNextRoute, handoffAtlas, recordAtlasLeg, requireAtlasRoute } from './atlas'
import { utcDate } from './calendar'
import { BATON_HOLD_MS } from './constants'
import { recordLegEchoes } from './echoes'
import { findBaton, handoffsOf, loadRun, notify, outscores } from './lookups'
import { moveToAtlasRoute, racesRoute } from './route'
import { networkRunner } from './runners'
import type { BatonRecord, NetworkContext, NetworkState } from './types'

export interface VerifiedTransfer {
  intent: NetworkHandoffIntent
  txHash: string
  baton: BatonRecord
  run: Run
  confirmations: number
  blockNumber: number
}

export interface OpeningRound {
  runnerId: string
  score: number | undefined
}

interface Rivalry {
  rival: NetworkRival
  batons: [BatonRecord, BatonRecord]
}

/**
 * Moves custody for a transfer that passed independent chain verification. Everything that can fail is resolved
 * before the first mutation, so a failure never leaves a half-applied handoff behind.
 */
export async function applyVerifiedHandoff(context: NetworkContext, transfer: VerifiedTransfer): Promise<void> {
  const { state } = context
  const { intent, baton, run } = transfer
  const sender = context.product.players[baton.holder.id]
  const recipient = context.product.players[intent.recipientId]
  if (!sender || !recipient) throw new Error('Handoff runner profile missing')
  const ghostRun = run.issued.ghost ? await loadRun(context.storage, run.issued.ghost.runId) : undefined
  const openingRound = await openingRoundOf(context, baton, intent.leg)
  const rivalry = baton.rivalId ? resolveRivalry(state, baton.rivalId) : null
  const nextRoute = intent.route ? requireAtlasRoute(intent.route.routeId) : defaultNextRoute(baton, intent.leg)

  const now = Date.now()
  const race = handoffRace(run)
  const handoff: BatonHandoff = {
    id: intent.id,
    batonId: baton.id,
    leg: intent.leg,
    from: networkRunner(state, sender),
    to: networkRunner(state, recipient),
    value: intent.value,
    txHash: transfer.txHash,
    network: baton.network,
    at: now,
    runId: intent.runId,
    resultHash: run.result.resultHash,
    qualified: true,
    confirmations: transfer.confirmations,
    blockNumber: transfer.blockNumber,
    // A leg issued on a course the baton has since left (a v4 leg in flight at upgrade) belongs to no sector.
    sector: racesRoute(run.issued.config, baton.route) ? baton.route.sector : null,
    race,
    rescue: baton.status === 'stranded',
    note: intent.note,
    atlas: handoffAtlas(baton, run.issued.config),
  }
  state.handoffs.push(handoff)
  intent.state = 'verified'
  intent.status = 'verified'
  intent.failure = null
  context.product.usedTx[transfer.txHash] = intent.id

  moveCustody(baton, handoff, now)
  updateLineage(state, baton)
  if (race.beatGhost) creditGhostWin(state, baton, handoff, sender, ghostRun)
  creditSender(sender)
  if (baton.crewId) countCrewDay(state, baton.crewId, now)
  if (openingRound) scoreQuickRound(baton, openingRound, { runnerId: sender.id, score: run.result.score })
  const wonRivalry = rivalry ? updateRivalry(state, rivalry, baton, recipient, now) : false

  recordLegEchoes(state, handoff, run)
  recordAtlasLeg(state, baton.code, handoff)
  if (nextRoute) moveToAtlasRoute(baton, nextRoute)
  awardHandoffAchievements(state, context.product, baton, handoff)
  if (wonRivalry && rivalry) awardRivalChampions(state, baton, rivalry.rival.title, now)
  if (baton.status === 'completed') baton.completedAt ??= now
  notify(state, recipient.id, { type: 'incoming_baton', title: `${sender.name} passed you the baton`, body: `${baton.displayName} · Handoff ${intent.leg}`, batonId: baton.id, runId: intent.runId, note: intent.note?.text ?? null })
}

function handoffRace(run: Run): HandoffRace {
  const { config } = run.issued
  const ghost = run.issued.ghost
  return {
    engineVersion: config.engineVersion,
    world: config.world,
    timeMs: run.result.timeMs,
    score: run.result.score,
    completed: run.result.completed,
    ghostRunId: ghost?.runId ?? null,
    ghostTimeMs: ghost?.result.timeMs ?? null,
    beatGhost: ghost ? outscores(run.result, ghost.result) : null,
  }
}

/** Quick rounds close on even legs: the opening leg's score against the closing leg's. */
async function openingRoundOf(context: NetworkContext, baton: BatonRecord, leg: number): Promise<OpeningRound | null> {
  if (!baton.quick || leg % 2 !== 0) return null
  const opening = handoffsOf(context.state, baton.id).at(-1)
  if (!opening) return null
  if (opening.race) return { runnerId: opening.from.id, score: opening.race.score }
  const openingRun = await loadRun(context.storage, opening.runId)
  return { runnerId: opening.from.id, score: openingRun?.result.score }
}

function resolveRivalry(state: NetworkState, rivalId: string): Rivalry {
  const rival = state.rivals.find(candidate => candidate.id === rivalId)
  if (!rival) throw new Error('Rivalry missing for rival baton')
  return { rival, batons: [findBaton(state, rival.batonIds[0]), findBaton(state, rival.batonIds[1])] }
}

function moveCustody(baton: BatonRecord, handoff: BatonHandoff, now: number): void {
  const senderId = handoff.from.id
  baton.holder = handoff.to
  baton.handoffCount = handoff.leg
  baton.updatedAt = now
  baton.expiresAt = now + BATON_HOLD_MS
  baton.status = 'active'
  baton.previousRunId = handoff.runId
  if (!baton.quick) {
    baton.recipientId = null
    baton.recipientReservedAt = null
    baton.recipientAcceptedAt = null
    return
  }
  // An opening pass after a released reservation seats the runner who actually received the baton.
  if (!baton.quick.players.includes(handoff.to.id)) {
    baton.quick.players = [senderId, handoff.to.id]
    baton.quick.scores = { [senderId]: 0, [handoff.to.id]: 0 }
  }
  // Match players alternate, and both have already accepted by playing.
  baton.recipientId = senderId
  baton.recipientReservedAt = now
  baton.recipientAcceptedAt = now
}

function updateLineage(state: NetworkState, baton: BatonRecord): void {
  const handoffs = handoffsOf(state, baton.id)
  baton.lineage.countries = [...new Set(handoffs.flatMap(handoff => [handoff.from.country, handoff.to.country]).filter((country): country is string => !!country))]
  baton.lineage.runners = new Set(handoffs.flatMap(handoff => [handoff.from.id, handoff.to.id])).size
}

function creditGhostWin(state: NetworkState, baton: BatonRecord, handoff: BatonHandoff, sender: Profile, ghostRun: Run | undefined): void {
  baton.lineage.ghostWins++
  if (!ghostRun) return
  notify(state, ghostRun.issued.playerId, { type: 'ghost_beaten', title: `${sender.name} beat your ghost`, body: baton.displayName, batonId: baton.id, runId: handoff.runId })
}

function creditSender(sender: Profile): void {
  sender.handoffs++
  sender.xp += 250
  sender.level = 1 + Math.floor(sender.xp / 500)
  if (!sender.achievements.includes('Baton bearer')) sender.achievements.push('Baton bearer')
}

function countCrewDay(state: NetworkState, crewId: string, now: number): void {
  const days = state.crewDays[crewId] ?? {}
  state.crewDays[crewId] = days
  const today = utcDate(now)
  days[today] = (days[today] ?? 0) + 1
}

/** Closes a Quick round: the higher verified score takes it, a tie takes nobody, and ties never invent a match winner. */
export function scoreQuickRound(baton: BatonRecord, opening: OpeningRound, closing: { runnerId: string; score: number }): void {
  const match = baton.quick
  if (!match) return
  const winner = roundWinner(opening, closing)
  if (winner) match.scores[winner] = (match.scores[winner] ?? 0) + 1
  match.rounds++
  const clinched = Object.keys(match.scores).find(id => (match.scores[id] ?? 0) > match.bestOf / 2)
  if (!clinched && match.rounds < match.bestOf) return
  match.winnerId = clinched ?? leaderOf(match.players, match.scores)
  baton.status = 'completed'
}

/** A missing opening run cannot win the round; equal scores split it. */
function roundWinner(opening: OpeningRound, closing: { runnerId: string; score: number }): string | null {
  if (opening.score === undefined) return closing.runnerId
  if (opening.score > closing.score) return opening.runnerId
  if (opening.score === closing.score) return null
  return closing.runnerId
}

function leaderOf(players: readonly string[], scores: Record<string, number>): string | null {
  const [first, second] = players
  if (first === undefined || second === undefined) return null
  const firstScore = scores[first] ?? 0
  const secondScore = scores[second] ?? 0
  if (firstScore === secondScore) return null
  return firstScore > secondScore ? first : second
}

/** Rivalry scores are each team baton's handoff count; the first to the target wins and both batons complete. */
function updateRivalry(state: NetworkState, rivalry: Rivalry, baton: BatonRecord, recipient: Profile, now: number): boolean {
  const { rival, batons } = rivalry
  rival.scores = [batons[0].handoffCount, batons[1].handoffCount]
  let won = false
  if (!rival.winnerId && baton.handoffCount >= rival.target) {
    rival.winnerId = baton.id
    won = true
    for (const teamBaton of batons) {
      teamBaton.status = 'completed'
      teamBaton.completedAt ??= now
    }
  }
  // A transfer still verifying when the rivalry ended cannot reopen it.
  if (rival.winnerId) baton.status = 'completed'
  notify(state, recipient.id, { type: 'rival_update', title: 'Your team’s baton moved', body: rival.title, batonId: baton.id })
  return won
}
