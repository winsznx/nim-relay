import { paymentAddress } from '@nim-relay/relay-protocol'
import type { BatonHandoff, NetworkCrew, NetworkSnapshot, StationCrew } from '@nim-relay/shared'
import type { Profile } from '../model'
import { presentBatonWithStops } from './batons'
import { utcDate, utcMidnight } from './calendar'
import { DAY_MS } from './constants'
import { bestCrewStreak, crewStreak } from './crews'
import { dailySnapshot } from './daily'
import { isOpenIntent } from './lookups'
import { networkMetrics } from './metrics'
import { networkRunner } from './runners'
import type { NetworkContext } from './types'

export function networkSnapshot(context: NetworkContext, profile: Profile | null): NetworkSnapshot {
  const { state, product } = context
  const now = Date.now()
  const handoffsByBaton = groupByBaton(state.handoffs)
  const batons = Object.values(state.batons)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(baton => presentBatonWithStops(baton, handoffsByBaton.get(baton.id) ?? [], now))
  const runners = Object.keys(state.members).flatMap(playerId => {
    const player = product.players[playerId]
    return player ? [networkRunner(state, player)] : []
  })
  return {
    network: context.env.NIMIQ_NETWORK,
    batons,
    crews: product.crews.map(crew => crewView(context, crew, now, profile?.id ?? null)),
    rivals: state.rivals,
    daily: dailySnapshot(context, profile, now),
    metrics: networkMetrics(context),
    playerId: profile?.id ?? null,
    runners,
    inbox: profile ? (state.notifications[profile.id] ?? []) : [],
    invites: profile ? Object.values(state.invites).filter(invite => invite.from.id === profile.id || invite.claimedBy === profile.id) : [],
    pendingHandoff: profile ? (Object.values(state.intents).find(intent => intent.sender === paymentAddress(profile.wallet) && isOpenIntent(intent)) ?? null) : null,
    countryConsent: profile ? (state.members[profile.id]?.consent ?? false) : false,
  }
}

/** A crew's join code is an invitation secret: only members see it. */
function crewView(context: NetworkContext, crew: StationCrew, now: number, viewerId: string | null): NetworkCrew {
  const { state, product } = context
  const days = state.crewDays[crew.id] ?? {}
  const contributions: Record<string, number> = {}
  for (const handoff of state.handoffs) {
    if (!handoff.qualified || state.batons[handoff.batonId]?.crewId !== crew.id) continue
    contributions[handoff.from.id] = (contributions[handoff.from.id] ?? 0) + 1
  }
  const members = crew.members.flatMap(playerId => {
    const player = product.players[playerId]
    return player ? [networkRunner(state, player)] : []
  })
  return {
    id: crew.id,
    code: viewerId !== null && crew.members.includes(viewerId) ? crew.code : null,
    name: crew.name,
    members,
    batonIds: Object.values(state.batons).filter(baton => baton.crewId === crew.id).map(baton => baton.id),
    streak: crewStreak(days, now),
    bestStreak: bestCrewStreak(days),
    todayHandoffs: days[utcDate(now)] ?? 0,
    contributions,
    deadline: utcMidnight(now) + DAY_MS,
  }
}

function groupByBaton(handoffs: readonly BatonHandoff[]): Map<string, BatonHandoff[]> {
  const groups = new Map<string, BatonHandoff[]>()
  for (const handoff of handoffs) {
    const group = groups.get(handoff.batonId)
    if (group) group.push(handoff)
    else groups.set(handoff.batonId, [handoff])
  }
  return groups
}
