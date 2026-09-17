import { describe, expect, it } from 'vitest'
import type { BatonHandoff, NetworkBaton, NetworkRunner } from '@nim-relay/shared'
import { baton, crew, daily, HOUR, runner, snapshot } from '../social/model/testing'
import { handoffRoster, recentActivity, searchRunners, type RosterInput } from './runner-groups'

const NOW = Date.parse('2026-09-17T12:00:00Z')

const me = runner('me', 'Tim')
const yasmine = runner('yasmine', 'Yasmine')
const ada = runner('ada', 'Ada')
const lena = runner('lena', 'Lena')
const kofi = runner('kofi', 'Kofi')
const sam = runner('sam', 'Sam')
const everyone = [me, yasmine, ada, lena, kofi, sam]

function handoff(leg: number, from: NetworkRunner, to: NetworkRunner, at: number): BatonHandoff {
  return {
    id: `h-${leg}`,
    batonId: 'aurora',
    leg,
    from,
    to,
    value: 100_000,
    txHash: String(leg).repeat(64).slice(0, 64),
    network: 'TestAlbatross',
    at,
    runId: `run-${leg}`,
    resultHash: 'hash',
    qualified: true,
    confirmations: 2,
    blockNumber: leg,
    sector: 0,
    race: null,
    rescue: false,
    note: null,
    atlas: { routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris', backfilled: false, onCourse: true },
  }
}

function input(overrides: Partial<RosterInput> & { baton: NetworkBaton }): RosterInput {
  return { snapshot: snapshot({ runners: everyone, batons: [overrides.baton] }), selfId: me.id, handoffs: [], partners: [], now: NOW, ...overrides }
}

const aurora = baton({ id: 'aurora', displayName: 'Aurora', holder: me, origin: ada, handoffCount: 1, createdAt: NOW - 30 * HOUR, updatedAt: NOW - 2 * HOUR })

describe('handoff roster: one runner is waiting', () => {
  it('hands the baton to the runner who accepted the invite, with no one else to choose', () => {
    const reserved = { ...aurora, recipientId: yasmine.id, recipientReservedAt: NOW - HOUR, recipientAcceptedAt: NOW - HOUR }
    expect(handoffRoster(input({ baton: reserved }))).toEqual({
      kind: 'known',
      runner: { id: yasmine.id, name: 'Yasmine', handle: 'yasmine', wallet: yasmine.wallet, country: null, context: 'Accepted your invite' },
      status: 'ready',
      others: null,
    })
  })

  it('says when the reserved runner has not accepted yet', () => {
    const reserved = { ...aurora, recipientId: yasmine.id, recipientReservedAt: NOW - HOUR, recipientAcceptedAt: null }
    expect(handoffRoster(input({ baton: reserved }))).toMatchObject({ kind: 'known', runner: { name: 'Yasmine', context: 'Invited for this leg' }, status: 'invited' })
  })

  it('reads the reservation from the live snapshot, so an invite claimed mid-leg shows up', () => {
    const claimed = { ...aurora, recipientId: kofi.id, recipientReservedAt: NOW, recipientAcceptedAt: NOW }
    const roster = handoffRoster(input({ baton: aurora, snapshot: snapshot({ runners: everyone, batons: [claimed] }) }))
    expect(roster).toMatchObject({ kind: 'known', runner: { id: kofi.id, context: 'Accepted your invite' } })
  })

  it('returns a match baton to the opponent, and offers others only while the opening seat is free', () => {
    const quick = (overrides: Partial<NetworkBaton>) => baton({ id: 'match', holder: me, mode: 'quick', quick: { players: [me.id, lena.id], bestOf: 3, scores: {}, rounds: 0, winnerId: null, rematchOf: null }, ...overrides })
    const midMatch = handoffRoster(input({ baton: quick({ handoffCount: 1, recipientId: lena.id, recipientAcceptedAt: NOW - HOUR }) }))
    expect(midMatch).toMatchObject({ kind: 'known', runner: { id: lena.id, context: 'Your match opponent' }, status: 'ready', others: null })

    const lapsed = handoffRoster(input({ baton: quick({ handoffCount: 0, recipientId: null }) }))
    expect(lapsed).toMatchObject({ kind: 'known', runner: { id: lena.id }, status: 'ready', others: { invite: true, rule: null } })
  })

  it('passes a crew baton to the only other member', () => {
    const crewBaton = { ...aurora, crewId: 'rift' }
    const roster = handoffRoster(input({ baton: crewBaton, snapshot: snapshot({ runners: everyone, batons: [crewBaton], crews: [crew({ id: 'rift', members: [me, ada] })] }) }))
    expect(roster).toMatchObject({ kind: 'known', runner: { id: ada.id, context: 'Crew member' }, status: 'ready', others: null })
  })
})

describe('handoff roster: the player chooses', () => {
  it('lists friends, crew and recent opponents once each, recommends the most recently active runner and never the player', () => {
    // #given Ada passed this baton to Tim, Lena relayed with Tim before, Kofi shares his crew,
    // Sam played him in a Quick match, and Yasmine started a relay ten minutes ago
    const match = baton({ id: 'match', holder: sam, origin: me, mode: 'quick', updatedAt: NOW - 20 * HOUR, createdAt: NOW - 21 * HOUR, quick: { players: [me.id, sam.id], bestOf: 3, scores: {}, rounds: 1, winnerId: null, rematchOf: null } })
    const fresh = baton({ id: 'fresh', displayName: 'Coast to coast', holder: yasmine, createdAt: NOW - 10 * 60_000, updatedAt: NOW - 10 * 60_000 })
    const world = snapshot({ runners: everyone, batons: [aurora, match, fresh], crews: [crew({ id: 'rift', name: 'Rift', members: [me, kofi, lena] })] })

    // #when the roster is built
    const roster = handoffRoster(input({ baton: aurora, snapshot: world, handoffs: [handoff(1, ada, me, NOW - 2 * HOUR)], partners: [{ handle: 'lena' }, { handle: 'ada' }] }))

    // #then
    expect(roster.kind).toBe('open')
    if (roster.kind !== 'open') return
    expect(roster.recommended).toMatchObject({ id: yasmine.id, context: 'Started Coast to coast 10m ago' })
    expect(roster.sections.map(section => [section.id, section.title, section.runners.map(item => item.name)])).toEqual([
      ['friends', 'Friends', ['Lena', 'Ada']],
      ['crew', 'Crew', ['Kofi']],
      ['opponents', 'Recent opponents', ['Sam']],
    ])
    expect(roster.sections.flatMap(section => section.runners.map(item => item.context))).toEqual(['Relayed with you', 'Relayed with you', 'Crew member', 'Quick match opponent'])
    expect(roster.invite).toBe(true)
    expect(roster.directory.map(item => item.name)).toEqual(['Ada', 'Kofi', 'Lena', 'Sam', 'Yasmine'])
  })

  it('moves the recommended runner out of their section instead of listing them twice', () => {
    const lenaRacing = baton({ id: 'lena-relay', holder: lena, live: { runnerName: 'Lena', runnerHandle: 'lena', progress: 0.4, ghostDeltaMs: null, world: 'coast', sector: 0, updatedAt: NOW - 2_000, ageMs: 2_000 } })
    const roster = handoffRoster(input({ baton: aurora, snapshot: snapshot({ runners: everyone, batons: [aurora, lenaRacing] }), partners: [{ handle: 'lena' }, { handle: 'kofi' }] }))
    expect(roster).toMatchObject({ kind: 'open', recommended: { id: lena.id, context: 'Racing a leg right now' }, sections: [{ id: 'friends', runners: [{ id: kofi.id }] }] })
  })

  it('keeps a crew baton inside the crew: no invite, members only, most recently active member first', () => {
    const crewBaton = { ...aurora, crewId: 'rift' }
    const kofiRelay = baton({ id: 'kofi-relay', displayName: 'Kofi run', holder: kofi, createdAt: NOW - HOUR })
    const world = snapshot({ runners: everyone, batons: [crewBaton, kofiRelay, baton({ id: 'yasmine-relay', holder: yasmine, createdAt: NOW - 60_000 })], crews: [crew({ id: 'rift', name: 'Rift Runners', members: [me, kofi, lena] })] })
    const roster = handoffRoster(input({ baton: crewBaton, snapshot: world }))
    expect(roster).toMatchObject({
      kind: 'open',
      rule: 'crew',
      invite: false,
      recommended: { id: kofi.id, context: 'Started Kofi run 1h ago' },
      sections: [{ id: 'crew', title: 'Rift Runners', runners: [{ id: lena.id, context: 'Crew member' }] }],
    })
    if (roster.kind === 'open') expect(roster.directory.map(item => item.id)).toEqual([kofi.id, lena.id])
  })

  it('recommends nobody when the snapshot shows no one doing anything', () => {
    const roster = handoffRoster(input({ baton: { ...aurora, origin: me } }))
    expect(roster).toMatchObject({ kind: 'open', recommended: null, sections: [] })
  })
})

describe('recent activity', () => {
  it('counts actions, not receipts, newest first', () => {
    // #given Kofi received a baton an hour ago without doing anything, Lena accepted a reservation, Ada passed this baton
    const received = baton({ id: 'received', displayName: 'Received', holder: kofi, origin: me, handoffCount: 3, createdAt: NOW - 50 * HOUR, updatedAt: NOW - HOUR })
    const accepted = baton({ id: 'accepted', displayName: 'Night run', holder: me, origin: me, createdAt: NOW - 40 * HOUR, recipientId: lena.id, recipientReservedAt: NOW - 5 * HOUR, recipientAcceptedAt: NOW - 3 * HOUR })
    const world = snapshot({ runners: everyone, batons: [received, accepted], daily: { ...daily([]), date: '2026-09-17', leaderboard: [{ player: sam, runId: 'd-1', score: 1, timeMs: 60_000 }] } })

    // #when activity is read
    const activity = recentActivity(world, [handoff(1, ada, me, NOW - 2 * HOUR)], aurora, NOW)

    // #then Kofi only shows up for nothing, and each line says what was done
    expect(activity.map(item => [item.runnerId, item.context])).toEqual([
      [ada.id, 'Passed Aurora 2h ago'],
      [lena.id, 'Accepted Night run 3h ago'],
      [sam.id, 'Rode today’s Daily'],
      [me.id, 'Started Night run 1d ago'],
      [me.id, 'Started Received 2d ago'],
    ])
  })

  it('credits a match pass to the runner who passed', () => {
    const match = baton({ id: 'match', displayName: 'Friday rematch', holder: me, origin: lena, mode: 'quick', handoffCount: 1, createdAt: NOW - 30 * HOUR, updatedAt: NOW - 30 * 60_000, recipientId: lena.id, recipientAcceptedAt: NOW - 30 * 60_000, quick: { players: [lena.id, me.id], bestOf: 3, scores: {}, rounds: 0, winnerId: null, rematchOf: null } })
    expect(recentActivity(snapshot({ runners: everyone, batons: [match] }), [], aurora, NOW)[0]).toEqual({ runnerId: lena.id, at: NOW - 30 * 60_000, context: 'Passed Friday rematch 30m ago' })
  })

  it('ignores yesterday’s Daily board', () => {
    const world = snapshot({ runners: everyone, daily: { ...daily([{ player: sam, runId: 'd-1', score: 1, timeMs: 60_000 }]), date: '2026-09-16' } })
    expect(recentActivity(world, [], aurora, NOW)).toEqual([])
  })
})

describe('runner search', () => {
  it('finds runners by handle or name, with or without @', () => {
    const roster = handoffRoster(input({ baton: aurora }))
    if (roster.kind !== 'open') throw new Error('expected an open roster')
    expect(searchRunners(roster.directory, '@YAS').map(item => item.id)).toEqual([yasmine.id])
    expect(searchRunners(roster.directory, 'a').map(item => item.id)).toEqual([ada.id, lena.id, sam.id, yasmine.id])
    expect(searchRunners(roster.directory, '   ')).toEqual([])
  })
})
