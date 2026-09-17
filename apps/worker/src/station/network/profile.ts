import type { RunnerProfile } from '@nim-relay/shared'
import { ApiError, type Profile, type State } from '../model'
import { runnerAchievements, runnerArtifacts } from './achievements'
import { atlasProfileFor } from './atlas'
import { MAX_PROFILE_BATONS, MAX_RECENT_RUNNERS } from './constants'
import { crewStreak } from './crews'
import { handoffsSentBy } from './lookups'
import { consentedCountry } from './runners'
import type { NetworkContext, NetworkState } from './types'

/** Public runner card. Never exposes a wallet, and a country only with the runner's consent. */
export function runnerProfile(context: NetworkContext, handle: string): RunnerProfile {
  const { state, product } = context
  const player = findByHandle(product, handle)
  if (!player) throw new ApiError('runner_not_found', 404)
  const sent = handoffsSentBy(state, player.id)
  const crew = product.crews.find(candidate => candidate.id === player.crewId)
  return {
    handle: player.handle,
    name: player.name,
    level: player.level,
    seasonRank: player.seasonRank,
    country: consentedCountry(state, player.id),
    qualifiedHandoffs: sent.length,
    legs: state.members[player.id]?.legs ?? 0,
    ghostWins: sent.filter(handoff => handoff.race?.beatGhost === true).length,
    ghostLosses: sent.filter(handoff => handoff.race?.beatGhost === false).length,
    quick: quickRecord(state, player.id),
    crew: crew ? { name: crew.name, streak: crewStreak(state.crewDays[crew.id] ?? {}, Date.now()) } : null,
    daily: dailyRecord(state, player.id),
    historicBatons: historicBatons(state, player.id),
    achievements: runnerAchievements(state, player.id),
    artifacts: runnerArtifacts(state, player.id),
    cosmetics: { ...player.equipped },
    recentRunners: recentRunners(state, product, player.id),
    atlas: atlasProfileFor(state, player.id),
  }
}

function findByHandle(product: State, handle: string): Profile | undefined {
  const wanted = handle.trim().replace(/^@/, '').toLowerCase()
  return Object.values(product.players).find(player => player.handle.toLowerCase() === wanted)
}

function quickRecord(state: NetworkState, playerId: string): RunnerProfile['quick'] {
  const record = { wins: 0, losses: 0 }
  for (const baton of Object.values(state.batons)) {
    const match = baton.quick
    if (!match?.winnerId || baton.status !== 'completed' || !match.players.includes(playerId)) continue
    if (match.winnerId === playerId) record.wins++
    else record.losses++
  }
  return record
}

function dailyRecord(state: NetworkState, playerId: string): RunnerProfile['daily'] {
  let entries = 0
  let bestTimeMs: number | null = null
  for (const results of Object.values(state.daily)) {
    const entry = results[playerId]
    if (!entry) continue
    entries++
    if (entry.completed && (bestTimeMs === null || entry.timeMs < bestTimeMs)) bestTimeMs = entry.timeMs
  }
  return { bestTimeMs, entries }
}

function historicBatons(state: NetworkState, playerId: string): RunnerProfile['historicBatons'] {
  const carried = new Set(state.handoffs.filter(handoff => handoff.from.id === playerId || handoff.to.id === playerId).map(handoff => handoff.batonId))
  return Object.values(state.batons)
    .filter(baton => baton.origin.id === playerId || baton.holder.id === playerId || carried.has(baton.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PROFILE_BATONS)
    .map(baton => ({
      id: baton.id,
      code: baton.code,
      displayName: baton.displayName,
      handoffCount: baton.handoffCount,
      role: baton.origin.id === playerId ? 'origin' : baton.holder.id === playerId ? 'holder' : 'runner',
    }))
}

function recentRunners(state: NetworkState, product: State, playerId: string): RunnerProfile['recentRunners'] {
  const seen = new Set<string>()
  const runners: RunnerProfile['recentRunners'] = []
  for (let index = state.handoffs.length - 1; index >= 0 && runners.length < MAX_RECENT_RUNNERS; index--) {
    const handoff = state.handoffs[index]!
    const counterpart = handoff.from.id === playerId ? handoff.to : handoff.to.id === playerId ? handoff.from : null
    if (!counterpart || seen.has(counterpart.id)) continue
    seen.add(counterpart.id)
    const current = product.players[counterpart.id]
    runners.push({ name: current?.name ?? counterpart.name, handle: current?.handle ?? counterpart.handle })
  }
  return runners
}
