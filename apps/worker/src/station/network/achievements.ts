import { relayLeg } from '@nim-relay/game-engine'
import type { AchievementId, BatonHandoff, RelayArtifact, RunnerAchievement } from '@nim-relay/shared'
import type { State } from '../model'
import { utcMidnight } from './calendar'
import { CREW_KEEPER_STREAK_DAYS, DAY_MS, GHOST_BREAKER_WINS, GHOST_WALL_SURVIVALS, HANDOFF_MILESTONES } from './constants'
import { crewStreak } from './crews'
import { handoffsOf, handoffsSentBy, isRaced, outscores, type RacedHandoff } from './lookups'
import type { BatonRecord, NetworkState } from './types'

export const ACHIEVEMENT_TITLES: Record<AchievementId, string> = {
  'first-pass': 'FIRST PASS',
  'handoffs-10': '10 VERIFIED HANDOFFS',
  'handoffs-50': '50 VERIFIED HANDOFFS',
  'handoffs-100': '100 VERIFIED HANDOFFS',
  'ghost-breaker': 'GHOST BREAKER',
  'ghost-wall': 'GHOST WALL',
  'crew-keeper': 'CREW KEEPER',
  'world-runner': 'WORLD RUNNER',
  'global-milestone': 'GLOBAL RELAY MILESTONE',
  'daily-top-10': 'DAILY TOP 10%',
  'rival-champion': 'RIVAL CHAMPION',
}

const HANDOFF_COUNT_ACHIEVEMENTS: readonly (readonly [number, AchievementId])[] = [
  [1, 'first-pass'],
  [10, 'handoffs-10'],
  [50, 'handoffs-50'],
  [100, 'handoffs-100'],
]

export interface UnlockSource {
  subtitle: string
  batonId: string | null
  leg: number | null
  at: number
}

/** Idempotent: each achievement unlocks once per runner and produces exactly one artifact. */
export function unlockAchievement(state: NetworkState, playerId: string, id: AchievementId, source: UnlockSource): boolean {
  const awards = state.awards[playerId] ?? { unlocked: {}, artifacts: [] }
  state.awards[playerId] = awards
  if (awards.unlocked[id] !== undefined) return false
  awards.unlocked[id] = source.at
  awards.artifacts.push({ id: crypto.randomUUID(), kind: id, title: ACHIEVEMENT_TITLES[id], subtitle: source.subtitle, batonId: source.batonId, leg: source.leg, at: source.at })
  return true
}

function isAchievementId(value: string): value is AchievementId {
  return Object.hasOwn(ACHIEVEMENT_TITLES, value)
}

export function runnerAchievements(state: NetworkState, playerId: string): RunnerAchievement[] {
  const unlocked = state.awards[playerId]?.unlocked ?? {}
  return Object.entries(unlocked)
    .flatMap(([id, unlockedAt]) => (isAchievementId(id) && unlockedAt !== undefined ? [{ id, title: ACHIEVEMENT_TITLES[id], unlockedAt }] : []))
    .sort((a, b) => a.unlockedAt - b.unlockedAt)
}

export function runnerArtifacts(state: NetworkState, playerId: string): RelayArtifact[] {
  return [...(state.awards[playerId]?.artifacts ?? [])].sort((a, b) => b.at - a.at)
}

/** Everything a verified handoff can complete. Thresholds use >=, so a missed evaluation catches up on the next one. */
export function awardHandoffAchievements(state: NetworkState, product: State, baton: BatonRecord, handoff: BatonHandoff): void {
  const source: UnlockSource = { subtitle: `${baton.displayName} · Handoff ${handoff.leg}`, batonId: baton.id, leg: handoff.leg, at: handoff.at }
  awardSenderProgress(state, handoff.from.id, source)
  awardGhostWalls(state, baton, handoff)
  if (baton.mode === 'global' && HANDOFF_MILESTONES.includes(handoff.leg)) {
    unlockAchievement(state, handoff.from.id, 'global-milestone', source)
    unlockAchievement(state, handoff.to.id, 'global-milestone', source)
  }
  if (baton.crewId) awardCrewKeepers(state, product, baton.crewId, handoff.at)
}

function awardSenderProgress(state: NetworkState, senderId: string, source: UnlockSource): void {
  const sent = handoffsSentBy(state, senderId)
  for (const [count, id] of HANDOFF_COUNT_ACHIEVEMENTS) {
    if (sent.length >= count) unlockAchievement(state, senderId, id, source)
  }
  if (sent.filter(handoff => handoff.race?.beatGhost === true).length >= GHOST_BREAKER_WINS) unlockAchievement(state, senderId, 'ghost-breaker', source)
  const worlds = new Set(sent.flatMap(handoff => (handoff.race ? [handoff.race.world] : [])))
  if (relayLeg.WORLDS.every(world => worlds.has(world))) unlockAchievement(state, senderId, 'world-runner', source)
}

/** Later canonical legs by other runners on the sector that failed to outscore `leg`, counted until one does. */
export function ghostSurvivals(leg: RacedHandoff, sectorLegs: readonly RacedHandoff[]): number {
  let survived = 0
  for (const attempt of sectorLegs) {
    if (attempt.leg <= leg.leg || attempt.from.id === leg.from.id) continue
    if (outscores(attempt.race, leg.race)) break
    survived++
  }
  return survived
}

function awardGhostWalls(state: NetworkState, baton: BatonRecord, latest: BatonHandoff): void {
  if (latest.sector === null) return
  const sectorLegs = handoffsOf(state, baton.id).filter(isRaced).filter(handoff => handoff.sector === latest.sector && handoff.race.completed)
  for (const leg of sectorLegs) {
    if (ghostSurvivals(leg, sectorLegs) < GHOST_WALL_SURVIVALS) continue
    unlockAchievement(state, leg.from.id, 'ghost-wall', { subtitle: `${baton.displayName} · Handoff ${leg.leg}`, batonId: baton.id, leg: leg.leg, at: latest.at })
  }
}

/** CREW KEEPER: every runner who passed a crew baton during a streak that has reached 7 days. */
function awardCrewKeepers(state: NetworkState, product: State, crewId: string, now: number): void {
  const streak = crewStreak(state.crewDays[crewId] ?? {}, now)
  if (streak < CREW_KEEPER_STREAK_DAYS) return
  const streakStart = utcMidnight(now) - (streak - 1) * DAY_MS
  const crewName = product.crews.find(crew => crew.id === crewId)?.name ?? 'Crew'
  const contributors = new Set(
    state.handoffs
      .filter(handoff => handoff.qualified && handoff.at >= streakStart && state.batons[handoff.batonId]?.crewId === crewId)
      .map(handoff => handoff.from.id),
  )
  for (const playerId of contributors) {
    unlockAchievement(state, playerId, 'crew-keeper', { subtitle: `${crewName} · ${streak}-day streak`, batonId: null, leg: null, at: now })
  }
}

/** RIVAL CHAMPION: everyone who carried the baton that won the rivalry. */
export function awardRivalChampions(state: NetworkState, baton: BatonRecord, rivalryTitle: string, at: number): void {
  const runners = new Set([baton.origin.id, ...handoffsOf(state, baton.id).flatMap(handoff => [handoff.from.id, handoff.to.id])])
  for (const playerId of runners) {
    unlockAchievement(state, playerId, 'rival-champion', { subtitle: rivalryTitle, batonId: baton.id, leg: baton.handoffCount, at })
  }
}
