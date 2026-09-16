import type { NetworkBaton, NetworkRival, NetworkRunner } from '@nim-relay/shared'

export type TeamSide = 'gold' | 'cyan'

export interface RivalTeam {
  side: TeamSide
  /** The team baton, or null when the snapshot no longer lists it. */
  baton: NetworkBaton | null
  /** Runner who started the team baton. */
  captain: NetworkRunner | null
  holder: NetworkRunner | null
  /** Verified handoffs of the team baton, as the rivalry records them. */
  score: number
  /** Share of the target reached, 0 to 1. */
  progress: number
  won: boolean
  /** The viewer started or holds this team's baton. */
  yours: boolean
  /** The viewer holds the team baton and can carry the next leg. */
  yourTurn: boolean
  /** The baton is in play with nobody reserved for the next leg. */
  needsRunner: boolean
}

export interface RivalView {
  id: string
  title: string
  target: number
  endsAt: number
  teams: [RivalTeam, RivalTeam]
  /** live: racing. won: a team reached the target. ended: time ran out before either did. */
  state: 'live' | 'won' | 'ended'
  winner: RivalTeam | null
  leader: TeamSide | null
  yourTeam: RivalTeam | null
}

function team(rival: NetworkRival, index: 0 | 1, batons: readonly NetworkBaton[], playerId: string | null): RivalTeam {
  const baton = batons.find(candidate => candidate.id === rival.batonIds[index]) ?? null
  const score = rival.scores[index]
  const won = rival.winnerId !== null && rival.winnerId === rival.batonIds[index]
  const inPlay = baton !== null && baton.status !== 'completed' && rival.winnerId === null
  const yourTurn = inPlay && playerId !== null && baton.holder.id === playerId
  return {
    side: index === 0 ? 'gold' : 'cyan',
    baton,
    captain: baton?.origin ?? null,
    holder: baton && baton.status !== 'completed' ? baton.holder : null,
    score,
    progress: rival.target > 0 ? Math.min(1, score / rival.target) : 0,
    won,
    yours: playerId !== null && baton !== null && (baton.origin.id === playerId || baton.holder.id === playerId),
    yourTurn,
    needsRunner: inPlay && !yourTurn && baton.recipientId === null,
  }
}

export function rivalView(rival: NetworkRival, batons: readonly NetworkBaton[], playerId: string | null, now: number): RivalView {
  const teams: [RivalTeam, RivalTeam] = [team(rival, 0, batons, playerId), team(rival, 1, batons, playerId)]
  const [gold, cyan] = teams
  const winner = teams.find(entry => entry.won) ?? null
  return {
    id: rival.id,
    title: rival.title,
    target: rival.target,
    endsAt: rival.endsAt,
    teams,
    state: winner ? 'won' : now >= rival.endsAt ? 'ended' : 'live',
    winner,
    leader: gold.score === cyan.score ? null : gold.score > cyan.score ? 'gold' : 'cyan',
    yourTeam: teams.find(entry => entry.yours) ?? null,
  }
}

/** Live rivalries first, the viewer's own ahead of others, then the most recently started. */
export function sortRivals(views: readonly RivalView[], createdAt: ReadonlyMap<string, number>): RivalView[] {
  const rank = (view: RivalView) => (view.state === 'live' ? 0 : 1) * 2 + (view.yourTeam ? 0 : 1)
  return [...views].sort((a, b) => rank(a) - rank(b) || (createdAt.get(b.id) ?? 0) - (createdAt.get(a.id) ?? 0))
}
