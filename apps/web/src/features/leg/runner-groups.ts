import type { BatonHandoff, NetworkBaton, NetworkCrew, NetworkRunner, NetworkSnapshot } from '@nim-relay/shared'
import type { RunnerChoice } from '../handoff/machine'
import { formatSince } from '../relays/format'

export interface RunnerOption extends RunnerChoice {
  wallet: string | null
  country: string | null
  /** Why this runner is offered, in the player's words: "Crew member", "Passed Aurora 2h ago". */
  context: string
}

export type RosterSectionId = 'friends' | 'crew' | 'opponents'

export interface RosterSection {
  id: RosterSectionId
  title: string
  runners: RunnerOption[]
}

/** The runners a pass may go to when no single runner is waiting for it. */
export interface OpenRoster {
  sections: RosterSection[]
  /** The most recently active runner the pass may go to. Shown on its own, so it is left out of the sections. */
  recommended: RunnerOption | null
  /** An invite link can bring in a runner who is on no list. False when the pass has to stay inside a crew or match. */
  invite: boolean
  /** Every runner the rules allow, by name, for the handle search. */
  directory: RunnerOption[]
  /** The rule that limits who can take the pass, if one does. */
  rule: 'crew' | 'match' | null
}

export type HandoffRoster =
  /** Exactly one sensible runner: the reserved runner, the match opponent, or the only other crew member. */
  | { kind: 'known'; runner: RunnerOption; status: 'ready' | 'invited'; others: OpenRoster | null }
  | ({ kind: 'open' } & OpenRoster)

export interface RosterInput {
  snapshot: NetworkSnapshot
  /** The baton as the leg started. The snapshot's copy wins when it has one, since reservations change during a leg. */
  baton: NetworkBaton
  selfId: string | null
  /** This baton's verified handoffs, oldest first. */
  handoffs: readonly BatonHandoff[]
  /** The player's latest handoff partners, newest first, from their runner profile. */
  partners: readonly { handle: string }[]
  now: number
}

interface Activity {
  runnerId: string
  at: number
  context: string
}

function option(runner: NetworkRunner, context: string): RunnerOption {
  return { id: runner.id, name: runner.name, handle: runner.handle, wallet: runner.wallet, country: runner.country, context }
}

const byName = (a: NetworkRunner, b: NetworkRunner) => a.name.localeCompare(b.name, 'en')

/**
 * Who can take this baton next. A reservation, a match or a two-runner crew leaves one runner, shown on its own.
 * Otherwise the player picks from the people they relay with, with the most recently active runner recommended.
 */
export function handoffRoster(input: RosterInput): HandoffRoster {
  const { snapshot, selfId } = input
  const baton = snapshot.batons.find(item => item.id === input.baton.id) ?? input.baton
  const others = snapshot.runners.filter(runner => runner.id !== selfId)
  const accepted = baton.recipientAcceptedAt !== null

  if (baton.quick) {
    const opponentId = baton.recipientId ?? baton.quick.players.find(id => id !== selfId) ?? null
    const opponent = others.find(runner => runner.id === opponentId)
    // An opening pass may seat a new opponent once the first one's reservation lapsed.
    const seatOpen = baton.handoffCount === 0 && baton.recipientId === null
    const open = seatOpen ? openRoster(input, baton, others) : null
    if (opponent) return { kind: 'known', runner: option(opponent, 'Your match opponent'), status: baton.recipientId !== null && !accepted ? 'invited' : 'ready', others: open }
    return { kind: 'open', ...(open ?? closedRoster('match')) }
  }

  if (baton.recipientId !== null) {
    const reserved = others.find(runner => runner.id === baton.recipientId)
    const context = accepted ? 'Accepted your invite' : 'Invited for this leg'
    const runner = reserved ? option(reserved, context) : { id: baton.recipientId, name: 'Reserved runner', handle: '', wallet: null, country: null, context }
    return { kind: 'known', runner, status: accepted ? 'ready' : 'invited', others: null }
  }

  if (baton.crewId !== null) {
    const crew = snapshot.crews.find(entry => entry.id === baton.crewId)
    const members = (crew?.members ?? []).filter(member => member.id !== selfId)
    const only = members.length === 1 ? members[0] : undefined
    if (only) return { kind: 'known', runner: option(only, 'Crew member'), status: 'ready', others: null }
    return { kind: 'open', ...crewRoster(input, baton, crew, members) }
  }

  return { kind: 'open', ...openRoster(input, baton, others) }
}

function closedRoster(rule: OpenRoster['rule']): OpenRoster {
  return { sections: [], recommended: null, invite: false, directory: [], rule }
}

function openRoster(input: RosterInput, baton: NetworkBaton, allowed: readonly NetworkRunner[]): OpenRoster {
  const { snapshot, selfId } = input
  const byId = new Map(allowed.map(runner => [runner.id, runner]))
  const byHandle = new Map(allowed.map(runner => [runner.handle.toLowerCase(), runner]))
  const recommended = mostRecentlyActive(input, baton, byId)
  const listed = new Set(recommended ? [recommended.id] : [])
  const take = (runners: readonly (NetworkRunner | undefined)[], context: string): RunnerOption[] =>
    runners.flatMap(runner => {
      if (!runner || listed.has(runner.id)) return []
      listed.add(runner.id)
      return [option(runner, context)]
    })

  const partners = [...input.partners.map(partner => byHandle.get(partner.handle.toLowerCase())), ...partnersOnBaton(input.handoffs, selfId).map(id => byId.get(id))]
  const crewMates = snapshot.crews.filter(crew => crew.members.some(member => member.id === selfId)).flatMap(crew => crew.members.map(member => byId.get(member.id)))
  const opponents = snapshot.batons
    .filter(relay => relay.quick?.players.includes(selfId ?? '') === true)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(relay => byId.get(relay.quick?.players.find(id => id !== selfId) ?? ''))

  const sections: RosterSection[] = [
    { id: 'friends', title: 'Friends', runners: take(partners, 'Relayed with you') },
    { id: 'crew', title: 'Crew', runners: take(crewMates, 'Crew member') },
    { id: 'opponents', title: 'Recent opponents', runners: take(opponents, 'Quick match opponent') },
  ]
  return {
    sections: sections.filter(section => section.runners.length > 0),
    recommended,
    invite: true,
    directory: [...allowed].sort(byName).map(runner => option(runner, `@${runner.handle}`)),
    rule: null,
  }
}

function crewRoster(input: RosterInput, baton: NetworkBaton, crew: NetworkCrew | undefined, members: readonly NetworkRunner[]): OpenRoster {
  const recommended = mostRecentlyActive(input, baton, new Map(members.map(member => [member.id, member])))
  const rest = members.filter(member => member.id !== recommended?.id).map(member => option(member, 'Crew member'))
  return {
    sections: rest.length > 0 ? [{ id: 'crew', title: crew?.name ?? 'Crew', runners: rest }] : [],
    recommended,
    invite: false,
    directory: [...members].sort(byName).map(member => option(member, `@${member.handle}`)),
    rule: 'crew',
  }
}

/** Runners who passed this baton to the player or took it from them, newest first. */
function partnersOnBaton(handoffs: readonly BatonHandoff[], selfId: string | null): string[] {
  return [...handoffs].reverse().flatMap(handoff => (handoff.from.id === selfId ? [handoff.to.id] : handoff.to.id === selfId ? [handoff.from.id] : []))
}

function mostRecentlyActive(input: RosterInput, baton: NetworkBaton, allowed: ReadonlyMap<string, NetworkRunner>): RunnerOption | null {
  for (const activity of recentActivity(input.snapshot, input.handoffs, baton, input.now)) {
    const runner = allowed.get(activity.runnerId)
    if (runner) return option(runner, activity.context)
  }
  return null
}

/**
 * What the snapshot shows runners doing, newest first: racing a leg, starting a relay, accepting or passing one,
 * riding today's Daily. Receiving a baton is not counted, since the recipient did nothing.
 */
export function recentActivity(snapshot: NetworkSnapshot, handoffs: readonly BatonHandoff[], baton: NetworkBaton, now: number): Activity[] {
  const idByHandle = new Map(snapshot.runners.map(runner => [runner.handle.toLowerCase(), runner.id]))
  const activity: Activity[] = []
  for (const relay of snapshot.batons) {
    const racer = relay.live ? idByHandle.get(relay.live.runnerHandle.toLowerCase()) : undefined
    if (relay.live && racer) activity.push({ runnerId: racer, at: relay.live.updatedAt, context: 'Racing a leg right now' })
    activity.push({ runnerId: relay.origin.id, at: relay.createdAt, context: `Started ${relay.displayName} ${formatSince(relay.createdAt, now)}` })
    if (relay.recipientId !== null && relay.recipientAcceptedAt !== null) {
      // After a match pass the reservation moves to the runner who just passed, stamped with the moment of the pass.
      const verb = relay.quick && relay.handoffCount > 0 ? 'Passed' : 'Accepted'
      activity.push({ runnerId: relay.recipientId, at: relay.recipientAcceptedAt, context: `${verb} ${relay.displayName} ${formatSince(relay.recipientAcceptedAt, now)}` })
    }
  }
  for (const handoff of handoffs) {
    activity.push({ runnerId: handoff.from.id, at: handoff.at, context: `Passed ${baton.displayName} ${formatSince(handoff.at, now)}` })
  }
  if (snapshot.daily.date === new Date(now).toISOString().slice(0, 10)) {
    const dayStart = Date.parse(`${snapshot.daily.date}T00:00:00Z`)
    for (const entry of snapshot.daily.leaderboard) activity.push({ runnerId: entry.player.id, at: dayStart, context: 'Rode today’s Daily' })
  }
  return activity.sort((a, b) => b.at - a.at)
}

/** Runners whose handle or name contains the query, up to `limit`. A leading @ is ignored. */
export function searchRunners(directory: readonly RunnerOption[], query: string, limit = 6): RunnerOption[] {
  const needle = query.trim().replace(/^@/, '').toLowerCase()
  if (!needle) return []
  return directory.filter(runner => runner.handle.toLowerCase().includes(needle) || runner.name.toLowerCase().includes(needle)).slice(0, limit)
}
