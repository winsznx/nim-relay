import type { GrantMilestoneId } from '@nim-relay/shared'
import { atlasProgressFor } from '../atlas'
import { utcDate } from '../calendar'
import { bestCrewStreak } from '../crews'
import { handoffsSentBy } from '../lookups'
import type { NetworkContext } from '../types'

/** Distinct Atlas routes a runner's qualified legs completed for the explorer grant. */
export const ATLAS_EXPLORER_ROUTES = 3
/** Best streak, in UTC days, a runner's crew must reach, with at least one of the runner's own handoffs. */
export const SOCIAL_CREW_STREAK_DAYS = 3

export const MILESTONE_COPY: Readonly<Record<GrantMilestoneId, { title: string; requirement: string }>> = {
  starter: { title: 'Starter Baton', requirement: 'Your first relay is on us, while your wallet holds less than one baton.' },
  first_handoff: { title: 'First handoff', requirement: 'Pass a baton to another runner and have it verified on chain.' },
  atlas_explorer: { title: 'Atlas explorer', requirement: `Complete ${ATLAS_EXPLORER_ROUTES} different Atlas routes.` },
  return_handoff: { title: 'Back for more', requirement: 'Make a verified handoff on a later day than your first.' },
  social: { title: 'Bring a runner', requirement: `A runner you invited makes a verified handoff, or your crew holds a ${SOCIAL_CREW_STREAK_DAYS}-day streak with you in it.` },
}

/**
 * Whether the runner's own verified relay history meets a milestone. Starter is decided by the wallet's chain balance
 * at claim time, and social referrals also need the invited runner's device to differ (see `socialReferrals`).
 */
export function meetsRequirement(context: NetworkContext, playerId: string, milestone: GrantMilestoneId, now: number): boolean {
  const sent = handoffsSentBy(context.state, playerId)
  switch (milestone) {
    case 'starter':
      return true
    case 'first_handoff':
      return sent.length > 0
    case 'atlas_explorer':
      return atlasProgressFor(context.state, playerId).routesCompleted >= ATLAS_EXPLORER_ROUTES
    case 'return_handoff': {
      const [first] = sent
      return first !== undefined && sent.some(handoff => utcDate(handoff.at) !== utcDate(first.at) && handoff.at > first.at)
    }
    case 'social':
      return crewMilestone(context, playerId, now) || socialReferrals(context, playerId).length > 0
  }
}

/** Runners who claimed an invitation from `playerId`, on another wallet, and have since sent a verified handoff. */
export function socialReferrals(context: NetworkContext, playerId: string): string[] {
  const { state, product } = context
  const wallet = product.players[playerId]?.wallet
  const invited = new Set(Object.values(state.invites).flatMap(invite => (invite.from.id === playerId && invite.claimedBy && invite.claimedBy !== playerId ? [invite.claimedBy] : [])))
  return [...invited].filter(id => product.players[id]?.wallet !== wallet && handoffsSentBy(state, id).length > 0)
}

/** Crew milestone alone, which needs no device check: the streak takes real handoffs between crew members. */
export function crewMilestone(context: NetworkContext, playerId: string, now: number): boolean {
  const { state, product } = context
  const crew = product.crews.find(candidate => candidate.members.includes(playerId))
  if (!crew) return false
  const contributed = state.handoffs.some(handoff => handoff.qualified && handoff.from.id === playerId && state.batons[handoff.batonId]?.crewId === crew.id && handoff.at <= now)
  return contributed && bestCrewStreak(state.crewDays[crew.id] ?? {}) >= SOCIAL_CREW_STREAK_DAYS
}
