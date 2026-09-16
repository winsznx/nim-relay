import type { BatonHandoff, NetworkBaton, NetworkCrew } from '@nim-relay/shared'

/**
 * Crew identity colors. Each stays readable on midnight and keeps clear of the
 * hues the product already speaks with: red for danger, cyan for live and
 * verified, and gold for the baton and its value.
 */
export const CREW_COLORS = ['#B8E35A', '#7FE08A', '#4FD6A0', '#7AA2FF', '#A18BFF', '#D48CFF', '#F07FE0', '#FF8FC7'] as const

/** FNV-1a, so a crew keeps its color on every device and every visit. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

export function crewColor(crewId: string): string {
  return CREW_COLORS[hash(crewId) % CREW_COLORS.length] ?? CREW_COLORS[0]
}

/**
 * secured: a verified crew pass already counts today.
 * at-risk: the streak ends at midnight UTC unless a verified pass lands first.
 * open: no streak is running, so today's pass would start one.
 */
export type StreakState = 'secured' | 'at-risk' | 'open'

export function streakState(crew: Pick<NetworkCrew, 'streak' | 'todayHandoffs'>): StreakState {
  if (crew.todayHandoffs > 0) return 'secured'
  return crew.streak > 0 ? 'at-risk' : 'open'
}

export type StreakCell = 'kept' | 'today-kept' | 'today-open' | 'empty'

/**
 * The last `days` UTC days, oldest first, ending today. The server counts a
 * streak through today once today has a pass and through yesterday until then.
 */
export function streakCells(crew: Pick<NetworkCrew, 'streak' | 'todayHandoffs'>, days = 7): StreakCell[] {
  const secured = crew.todayHandoffs > 0
  const before = Math.min(days - 1, Math.max(0, secured ? crew.streak - 1 : crew.streak))
  return Array.from({ length: days }, (_, index): StreakCell => {
    if (index === days - 1) return secured ? 'today-kept' : 'today-open'
    return index >= days - 1 - before ? 'kept' : 'empty'
  })
}

export function crewOf(crews: readonly NetworkCrew[], playerId: string | null): NetworkCrew | null {
  if (!playerId) return null
  return crews.find(crew => crew.members.some(member => member.id === playerId)) ?? null
}

/** The crew baton a runner can act on: the most recently moved one still in play. */
export function crewBatonInPlay(crew: NetworkCrew, batons: readonly NetworkBaton[]): NetworkBaton | null {
  const ids = new Set(crew.batonIds)
  return (
    batons
      .filter(baton => ids.has(baton.id) && baton.status !== 'completed')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .at(0) ?? null
  )
}

/** Codes of the crew's most recently moved batons, whose handoffs make up its recent history. */
export function recentCrewBatonCodes(crew: NetworkCrew, batons: readonly NetworkBaton[], limit = 4): string[] {
  const ids = new Set(crew.batonIds)
  return batons
    .filter(baton => ids.has(baton.id) && baton.handoffCount > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(baton => baton.code)
}

export interface CrewContribution {
  memberId: string
  passes: number
  /** Share of the top contributor's passes, 0 to 1. */
  share: number
}

export function crewContributions(crew: NetworkCrew): CrewContribution[] {
  const top = Math.max(0, ...crew.members.map(member => crew.contributions[member.id] ?? 0))
  return crew.members
    .map(member => {
      const passes = crew.contributions[member.id] ?? 0
      return { memberId: member.id, passes, share: top > 0 ? passes / top : 0 }
    })
    .sort((a, b) => b.passes - a.passes)
}

/** Newest verified handoffs across the crew's batons. */
export function recentCrewHandoffs(handoffs: readonly BatonHandoff[], limit = 6): BatonHandoff[] {
  return handoffs
    .filter(handoff => handoff.qualified)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}
