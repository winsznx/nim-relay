import type { NetworkCrew, NetworkHandoffIntent, NetworkRival, NetworkSnapshot, StationProfile, StationSnapshot, StationWorld } from '@nim-relay/shared'
import { relayViews, type RelayView } from '../../relays/model'

/**
 * Everything the station reads from the snapshots, selected once. Player-specific
 * records are only trusted when they belong to the player the station is built for.
 */

export interface PendingPass {
  intent: NetworkHandoffIntent
  relay: RelayView | null
}

export interface QuickMatch {
  relay: RelayView
  /** Null when the opponent is not in the snapshot; never invented. */
  opponent: string | null
  yourWins: number
  theirWins: number
  yourTurn: boolean
}

export interface CrewStatus {
  crew: NetworkCrew
  /** A running streak with no confirmed handoff today breaks at the deadline. */
  atRisk: boolean
  msLeft: number
  relay: RelayView | null
}

export type RivalryOutcome = 'open' | 'won' | 'lost' | 'decided' | 'ended'

export interface RivalryStatus {
  rival: NetworkRival
  /** The player's side in `rival.batonIds`, or null for a public rivalry. */
  side: 0 | 1 | null
  outcome: RivalryOutcome
}

export interface DailyStatus {
  world: StationWorld
  /** Entries on the published board, which the server caps at its top 100. */
  riders: number
  leader: { name: string; score: number } | null
  position: number | null
  started: boolean
}

export interface StationContext {
  snapshot: NetworkSnapshot
  station: StationSnapshot | null
  profile: StationProfile | null
  playerId: string | null
  now: number
  relays: RelayView[]
  liveGlobal: RelayView | null
  legend: RelayView | null
  pendingPass: PendingPass | null
  yourTurns: RelayView[]
  quickMatches: QuickMatch[]
  crew: CrewStatus | null
  rivalries: RivalryStatus[]
  daily: DailyStatus
  unread: number
}

export function createStationContext(snapshot: NetworkSnapshot, station: StationSnapshot | null, playerId: string | null, now: number): StationContext {
  const relays = relayViews(snapshot, now)
  const relaysById = new Map(relays.map(relay => [relay.id, relay]))
  const ownSnapshot = playerId !== null && snapshot.playerId === playerId
  const pendingPass = ownSnapshot && snapshot.pendingHandoff ? pendingPassOf(snapshot.pendingHandoff, relaysById) : null

  return {
    snapshot,
    station,
    profile: playerId !== null && station?.profile.id === playerId ? station.profile : null,
    playerId,
    now,
    relays,
    liveGlobal: liveGlobalOf(relays),
    legend: legendOf(relays),
    pendingPass,
    yourTurns: playerId === null ? [] : yourTurnsOf(relays, playerId, pendingPass),
    quickMatches: playerId === null ? [] : quickMatchesOf(snapshot, relays, playerId),
    crew: playerId === null ? null : crewOf(snapshot, relays, playerId, now),
    rivalries: rivalriesOf(snapshot.rivals, relaysById, playerId, now),
    daily: dailyOf(snapshot, playerId, ownSnapshot),
    unread: ownSnapshot ? snapshot.inbox.filter(notification => notification.readAt === null).length : 0,
  }
}

function pendingPassOf(intent: NetworkHandoffIntent, relaysById: ReadonlyMap<string, RelayView>): PendingPass {
  return { intent, relay: relaysById.get(intent.batonId) ?? null }
}

/** Same pick as the world screen: the most recently moved active Global Relay. */
function liveGlobalOf(relays: readonly RelayView[]): RelayView | null {
  const live = relays.filter(relay => relay.status === 'active' && relay.mode === 'global')
  return live.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
}

function legendOf(relays: readonly RelayView[]): RelayView | null {
  const travelled = relays.filter(relay => relay.mode === 'global' && relay.handoffCount > 0)
  return travelled.sort((a, b) => b.handoffCount - a.handoffCount || a.createdAt - b.createdAt)[0] ?? null
}

function yourTurnsOf(relays: readonly RelayView[], playerId: string, pendingPass: PendingPass | null): RelayView[] {
  return relays
    .filter(relay => relay.status === 'active' && relay.holder.id === playerId && relay.id !== pendingPass?.relay?.id)
    .sort((a, b) => a.expiresAt - b.expiresAt)
}

function quickMatchesOf(snapshot: NetworkSnapshot, relays: readonly RelayView[], playerId: string): QuickMatch[] {
  const matches: QuickMatch[] = []
  for (const relay of relays) {
    const quick = relay.quick
    if (relay.status !== 'active' || relay.mode !== 'quick' || !quick?.players.includes(playerId)) continue
    const opponentId = quick.players.find(id => id !== playerId) ?? null
    const opponent = opponentId === null ? null : (snapshot.runners.find(runner => runner.id === opponentId) ?? [relay.origin, relay.holder].find(runner => runner.id === opponentId))
    matches.push({
      relay,
      opponent: opponent?.name ?? null,
      yourWins: quick.scores[playerId] ?? 0,
      theirWins: opponentId === null ? 0 : (quick.scores[opponentId] ?? 0),
      yourTurn: relay.holder.id === playerId,
    })
  }
  return matches
}

function crewOf(snapshot: NetworkSnapshot, relays: readonly RelayView[], playerId: string, now: number): CrewStatus | null {
  const crew = snapshot.crews.find(candidate => candidate.members.some(member => member.id === playerId))
  if (!crew) return null
  const crewRelays = relays
    .filter(relay => relay.status === 'active' && crew.batonIds.includes(relay.id))
    .sort((a, b) => Number(b.holder.id === playerId) - Number(a.holder.id === playerId) || b.updatedAt - a.updatedAt)
  return {
    crew,
    atRisk: crew.streak > 0 && crew.todayHandoffs === 0,
    msLeft: Math.max(0, crew.deadline - now),
    relay: crewRelays[0] ?? null,
  }
}

function rivalriesOf(rivals: readonly NetworkRival[], relaysById: ReadonlyMap<string, RelayView>, playerId: string | null, now: number): RivalryStatus[] {
  if (playerId === null) {
    const open = rivals.filter(rival => rival.winnerId === null && rival.endsAt > now)
    const closest = open.sort((a, b) => b.scores[0] + b.scores[1] - (a.scores[0] + a.scores[1]))[0]
    return closest ? [{ rival: closest, side: null, outcome: 'open' }] : []
  }
  const involved = (batonId: string) => {
    const relay = relaysById.get(batonId)
    return relay !== undefined && (relay.origin.id === playerId || relay.holder.id === playerId)
  }
  const statuses: RivalryStatus[] = []
  for (const rival of rivals) {
    const side = involved(rival.batonIds[0]) ? 0 : involved(rival.batonIds[1]) ? 1 : null
    if (side === null) continue
    statuses.push({ rival, side, outcome: outcomeOf(rival, side, now) })
  }
  return statuses.sort((a, b) => Number(b.outcome === 'open') - Number(a.outcome === 'open') || a.rival.endsAt - b.rival.endsAt)
}

function outcomeOf(rival: NetworkRival, side: 0 | 1 | null, now: number): RivalryOutcome {
  if (rival.winnerId !== null) {
    if (side === null) return 'decided'
    return rival.batonIds[side] === rival.winnerId ? 'won' : 'lost'
  }
  return rival.endsAt <= now ? 'ended' : 'open'
}

function dailyOf(snapshot: NetworkSnapshot, playerId: string | null, ownSnapshot: boolean): DailyStatus {
  const board = snapshot.daily.leaderboard
  const index = playerId === null ? -1 : board.findIndex(entry => entry.player.id === playerId)
  const first = board[0]
  return {
    world: snapshot.daily.world,
    riders: board.length,
    leader: first ? { name: first.player.name, score: first.score } : null,
    position: index >= 0 ? index + 1 : null,
    started: ownSnapshot && snapshot.daily.officialRunId !== null,
  }
}
