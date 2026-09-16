import type { NetworkBaton, NetworkRunner, NetworkSnapshot } from '@nim-relay/shared'
import type { RunnerGroup, RunnerOption } from '../handoff/RunnerPicker'

function option(runner: NetworkRunner, context?: string): RunnerOption {
  return { id: runner.id, name: runner.name, handle: runner.handle, ...(context ? { context } : {}) }
}

/**
 * Who can take this baton next, in the order a player thinks about it: the
 * runner it is reserved for, their match opponent or crew, runners they have
 * relayed with, then everyone else on the network.
 */
export function runnerGroups(snapshot: NetworkSnapshot | undefined, baton: NetworkBaton | null, selfId: string | null): RunnerGroup[] {
  if (!snapshot || !baton) return []
  const others = snapshot.runners.filter(runner => runner.id !== selfId)
  const byId = new Map(others.map(runner => [runner.id, runner]))

  if (baton.quick) {
    const opponent = baton.quick.players.map(id => byId.get(id)).find(runner => runner !== undefined)
    return opponent ? [{ title: 'Your match', runners: [option(opponent, `Round ${baton.quick.rounds + 1} of ${baton.quick.bestOf}`)] }] : []
  }

  if (baton.crewId) {
    const crew = snapshot.crews.find(entry => entry.id === baton.crewId)
    const members = (crew?.members ?? []).filter(member => member.id !== selfId)
    return members.length > 0 ? [{ title: crew ? crew.name : 'Your crew', runners: members.map(member => option(member, 'Crew')) }] : []
  }

  const groups: RunnerGroup[] = []
  const used = new Set<string>()
  const reserved = baton.recipientId ? byId.get(baton.recipientId) : undefined
  if (reserved) {
    groups.push({ title: 'Waiting for this baton', runners: [option(reserved, 'Accepted your invite')] })
    used.add(reserved.id)
    return groups
  }

  const relayedWith = new Set<string>()
  for (const relay of snapshot.batons) {
    for (const runner of [relay.origin, relay.holder]) if (runner.id !== selfId) relayedWith.add(runner.id)
  }
  const crewMates = snapshot.crews
    .filter(crew => crew.members.some(member => member.id === selfId))
    .flatMap(crew => crew.members.filter(member => member.id !== selfId).map(member => ({ member, crew: crew.name })))

  const crewOptions = crewMates.filter(({ member }) => !used.has(member.id)).map(({ member, crew }) => {
    used.add(member.id)
    return option(member, `Crew · ${crew}`)
  })
  if (crewOptions.length > 0) groups.push({ title: 'Your crew', runners: crewOptions })

  const recent = others.filter(runner => relayedWith.has(runner.id) && !used.has(runner.id))
  for (const runner of recent) used.add(runner.id)
  if (recent.length > 0) groups.push({ title: 'Relayed with you', runners: recent.map(runner => option(runner, 'On a relay with you')) })

  const everyone = others.filter(runner => !used.has(runner.id))
  if (everyone.length > 0) groups.push({ title: 'Couriers on the network', runners: everyone.map(runner => option(runner)) })
  return groups
}
