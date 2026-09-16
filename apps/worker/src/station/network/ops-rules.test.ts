import { describe, expect, it } from 'vitest'
import type { BatonHandoff, IssuedRace, NetworkHandoffIntent, NetworkRunner, OpsAlertId } from '@nim-relay/shared'
import { utcDate } from './calendar'
import { MAX_FLAGGED_RUNS } from './constants'
import { isOperator } from './ops'
import { alertFacts, opsAlerts, type AlertFacts } from './ops-alerts'
import { countHashSubmission, countRejection, countRun, flagRun, freshOpsLedger, noteArchived, noteUnarchivedChange, verificationsInLastDay } from './ops-ledger'
import { freshNetworkState } from './state'
import { countShare } from './traffic'
import type { Member, TrafficState } from './types'

const NOW = Date.UTC(2026, 8, 16, 12)
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

function facts(overrides: Partial<AlertFacts> = {}): AlertFacts {
  return {
    now: NOW,
    verifications: { submitted: 0, rejected: 0 },
    lastRpcUnavailableAt: null,
    stuckHandoffs: { attempting: 0, submitted: 0, oldestAttemptedAt: null },
    strandedBatons: 0,
    archive: { configured: true, dirty: false, version: 1, waitingSince: null },
    recent: { qualifiedHandoffs: 0, activeWallets: 0 },
    ...overrides,
  }
}

function raised(input: AlertFacts, id: OpsAlertId): boolean {
  return opsAlerts(input).some(alert => alert.id === id)
}

function intent(state: NetworkHandoffIntent['state'], attemptedAt: number | null): NetworkHandoffIntent {
  return {
    id: crypto.randomUUID(), batonId: 'baton-1', runId: 'run-1', recipientId: 'b', recipientName: 'B', sender: 'NQ00A', recipient: 'NQ00B', value: 100_000,
    data: 'NR1.CODE000001.1.AAAAAAAAAAAAAAAAAAAAAA', network: 'TestAlbatross', leg: 1, status: state === 'verified' ? 'verified' : 'pending', state,
    txHash: null, createdAt: NOW - DAY, expiresAt: NOW - DAY + 5 * MINUTE, attemptedAt, failure: null,
  }
}

function member(lastSeen: number): Member {
  return { consent: false, country: null, firstSeen: lastSeen, lastSeen, days: [], foreground: 0, lastHeartbeat: lastSeen, completedRuns: 0, legs: 0, legMarks: {} }
}

function issuedRace(runId: string): IssuedRace {
  return { networkRace: true, practice: false, relayLeg: 0, runId, playerId: 'runner', mode: 'global', config: { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed: 'seed', world: 'coast', tier: 1, openingFlow: 0 }, expiresAt: NOW, target: null, mac: '', ghost: null }
}

function courier(id: string): NetworkRunner {
  return { id, handle: `runner-${id}`, name: id, wallet: `NQ00${id}`, country: null, countrySource: null }
}

function handoff(at: number): BatonHandoff {
  return { id: `handoff-${at}`, batonId: 'baton-1', leg: 1, from: courier('a'), to: courier('b'), value: 100_000, txHash: 'a'.repeat(64), network: 'TestAlbatross', at, runId: 'run-1', resultHash: 'hash', qualified: true, confirmations: 2, blockNumber: 1, sector: 0, race: null, rescue: false }
}

describe('operator access', () => {
  const player = { id: 'player-1', handle: 'runner-abc123' }

  it('lists nobody when OPS_PLAYERS is unset or empty', () => {
    // #then no value without an entry lets anyone in
    expect([isOperator(undefined, player), isOperator('', player), isOperator(' , ', player)]).toEqual([false, false, false])
  })

  it('matches ids exactly and handles with or without @ in any case', () => {
    // #then only whole entries match
    expect([isOperator('player-1', player), isOperator('someone, @Runner-ABC123 ', player), isOperator('runner-abc12', player), isOperator('PLAYER-1', player)]).toEqual([true, true, false, false])
  })
})

describe('operator alert thresholds', () => {
  it('raise verification rejections only above 20% of submitted hashes', () => {
    // #given 2 and 3 rejections against 10 submissions, none at all, and a rejection with nothing submitted
    const rejections = (rejected: number, submitted: number) => raised(facts({ verifications: { submitted, rejected } }), 'verification_rejections')
    // #then 20% itself stays quiet
    expect([rejections(2, 10), rejections(3, 10), rejections(0, 0), rejections(1, 0)]).toEqual([false, true, false, true])
  })

  it('raise RPC_UNAVAILABLE for one hour after it occurred', () => {
    // #given RPC_UNAVAILABLE just now, exactly an hour ago and just over
    const rpc = (ago: number) => raised(facts({ lastRpcUnavailableAt: NOW - ago }), 'rpc_unavailable')
    // #then only the first two alert
    expect([rpc(0), rpc(HOUR), rpc(HOUR + 1)]).toEqual([true, true, false])
  })

  it('count handoffs still open more than 30 minutes after reaching Nimiq Pay', () => {
    // #given intents attempted 30 and 31 minutes ago, one submitted two hours ago, one verified and one never attempted
    const state = freshNetworkState()
    state.intents = { fresh: intent('attempting', NOW - 30 * MINUTE), stuck: intent('attempting', NOW - 31 * MINUTE), sent: intent('submitted', NOW - 2 * HOUR), done: intent('verified', NOW - 3 * HOUR), waiting: intent('prepared', null) }
    // #when the alert facts are measured
    const measured = alertFacts({ state, ops: freshOpsLedger(NOW), players: {}, archiveConfigured: true }, NOW)
    // #then two are stuck and the alert says which
    expect([measured.stuckHandoffs, opsAlerts(measured).find(alert => alert.id === 'stuck_handoffs')?.condition]).toEqual([
      { attempting: 1, submitted: 1, oldestAttemptedAt: NOW - 2 * HOUR },
      '2 handoffs still open more than 30 min after reaching Nimiq Pay: 1 attempting, 1 submitted. The oldest reached Nimiq Pay 2 h ago.',
    ])
  })

  it('call the archive lagging after 10 minutes, from the later of its first unarchived change and last archive', () => {
    // #given a dirty network and different archive histories
    const state = freshNetworkState()
    state.dirty = true
    const lagging = (unarchivedSince: number, lastArchivedAt: number | null) =>
      raised(alertFacts({ state, ops: { ...freshOpsLedger(NOW - DAY), unarchivedSince, lastArchivedAt }, players: {}, archiveConfigured: true }, NOW), 'archive_lagging')
    // #then an archive that still succeeds restarts the clock
    expect([lagging(NOW - 10 * MINUTE, null), lagging(NOW - 11 * MINUTE, null), lagging(NOW - HOUR, NOW - 5 * MINUTE), lagging(NOW - HOUR, NOW - 11 * MINUTE)]).toEqual([false, true, false, true])
  })

  it('report an archive without Supabase credentials as off, never as lagging', () => {
    // #given an unconfigured archive with changes waiting for an hour
    const input = facts({ archive: { configured: false, dirty: true, version: 9, waitingSince: NOW - HOUR } })
    // #then only the configuration warning shows
    expect(opsAlerts(input).map(alert => [alert.id, alert.severity])).toEqual([['archive_not_configured', 'warning']])
  })

  it('raise stranded batons, and a day without qualified handoffs only while linked wallets were active', () => {
    // #given two stranded batons, and quiet days with and without activity
    const quiet = (qualifiedHandoffs: number, activeWallets: number) => raised(facts({ recent: { qualifiedHandoffs, activeWallets } }), 'no_handoffs')
    // #then each alert follows its condition
    expect({ stranded: opsAlerts(facts({ strandedBatons: 2 }))[0]?.condition, quiet: [quiet(0, 3), quiet(1, 3), quiet(0, 0)] }).toEqual({
      stranded: '2 batons stranded: the holder let the 24 h hold pass with no transfer underway.',
      quiet: [true, false, false],
    })
  })

  it('measure the last 24 hours of qualified handoffs and distinct active wallets', () => {
    // #given two runners on one wallet seen today, one runner last seen two days ago, and handoffs 23 and 25 hours ago
    const state = freshNetworkState()
    state.members = { a: member(NOW - HOUR), twin: member(NOW - 2 * HOUR), gone: member(NOW - 2 * DAY) }
    state.handoffs = [handoff(NOW - 23 * HOUR), handoff(NOW - 25 * HOUR)]
    const players = { a: { wallet: 'NQ00SHARED' }, twin: { wallet: 'NQ00SHARED' }, gone: { wallet: 'NQ00GONE' } }
    // #when the facts are measured
    // #then one wallet and one handoff count
    expect(alertFacts({ state, ops: freshOpsLedger(NOW), players, archiveConfigured: true }, NOW).recent).toEqual({ qualifiedHandoffs: 1, activeWallets: 1 })
  })

  it('list critical alerts before warnings', () => {
    // #given two warnings and two critical conditions at once
    const input = facts({ strandedBatons: 1, lastRpcUnavailableAt: NOW, archive: { configured: false, dirty: true, version: 3, waitingSince: null }, verifications: { submitted: 1, rejected: 1 } })
    // #then critical alerts lead
    expect(opsAlerts(input).map(alert => [alert.severity, alert.id])).toEqual([
      ['critical', 'verification_rejections'],
      ['critical', 'rpc_unavailable'],
      ['warning', 'archive_not_configured'],
      ['warning', 'stranded_batons'],
    ])
  })
})

describe('operator ledger', () => {
  it('folds resubmissions of one flagged run and keeps only the latest 50', () => {
    // #given 55 flagged runs, then the newest and an older kept one submitted again
    const ledger = freshOpsLedger(NOW)
    const submit = (runId: string, at: number) => flagRun(ledger, { issued: issuedRace(runId), handle: 'runner-flagged', reason: 'INVALID_TRACE' }, at)
    for (let index = 0; index < MAX_FLAGGED_RUNS + 5; index++) submit(`run-${index}`, NOW + index)
    submit('run-54', NOW + 100)
    submit('run-5', NOW + 101)
    // #then resubmissions move to the top with their attempts, and the oldest fall off
    expect({ size: ledger.flaggedRuns.length, newest: ledger.flaggedRuns.slice(0, 2).map(run => [run.runId, run.attempts, run.at]), oldest: ledger.flaggedRuns.at(-1)?.runId }).toEqual({
      size: MAX_FLAGGED_RUNS,
      newest: [['run-5', 2, NOW + 101], ['run-54', 2, NOW + 100]],
      oldest: 'run-6',
    })
  })

  it('counts hash submissions and rejections in the current hour and the 23 before it', () => {
    // #given verifications 24 hours ago, 23 hours ago and now
    const ledger = freshOpsLedger(NOW - DAY)
    countHashSubmission(ledger, NOW - 24 * HOUR)
    countHashSubmission(ledger, NOW - 23 * HOUR)
    countRejection(ledger, 'VALUE_MISMATCH', NOW - 23 * HOUR)
    countHashSubmission(ledger, NOW)
    // #then the oldest hour is outside the window
    expect(verificationsInLastDay(ledger, NOW)).toEqual({ submitted: 2, rejected: 1 })
  })

  it('keeps day counters for the 30 UTC days ending today', () => {
    // #given runs counted 30 days ago, 29 days ago and today
    const ledger = freshOpsLedger(NOW - 40 * DAY)
    countRun(ledger, 'verified', NOW - 30 * DAY)
    countRun(ledger, 'rejected', NOW - 29 * DAY)
    countRun(ledger, 'refused', NOW)
    // #then the day before the window was dropped
    expect(Object.keys(ledger.days)).toEqual([utcDate(NOW - 29 * DAY), utcDate(NOW)])
  })

  it('clears the unarchived mark only once the archive has caught up', () => {
    // #given two changes, an archive of an older snapshot, then one of the latest
    const ledger = freshOpsLedger(NOW)
    noteUnarchivedChange(ledger, NOW)
    noteUnarchivedChange(ledger, NOW + MINUTE)
    noteArchived(ledger, NOW + 2 * MINUTE, false)
    const behind = [ledger.unarchivedSince, ledger.lastArchivedAt]
    noteArchived(ledger, NOW + 3 * MINUTE, true)
    // #then the first change stays marked until the archive catches up
    expect([behind, [ledger.unarchivedSince, ledger.lastArchivedAt]]).toEqual([[NOW, NOW + 2 * MINUTE], [null, NOW + 3 * MINUTE]])
  })
})

describe('share tallies', () => {
  it('count shares by surface, and by UTC day inside the report window', () => {
    // #given shares 30 days ago and today
    const traffic: TrafficState = { day: '', chronicleViews: 0, inviteOpens: 0, shares: 0, openedInvites: [], sharesToday: {}, shareTalliesSince: NOW - 40 * DAY, sharesBySurface: {}, sharesByDay: {} }
    countShare(traffic, { actorKey: 'runner:a', anonymous: false, surface: 'crew' }, NOW - 30 * DAY)
    countShare(traffic, { actorKey: 'runner:a', anonymous: false, surface: 'crew' }, NOW)
    countShare(traffic, { actorKey: 'visitor:b', anonymous: true, surface: 'chronicle' }, NOW)
    // #then surfaces keep every share and days keep the window
    expect({ total: traffic.shares, bySurface: traffic.sharesBySurface, byDay: traffic.sharesByDay }).toEqual({ total: 3, bySurface: { crew: 2, chronicle: 1 }, byDay: { [utcDate(NOW)]: 2 } })
  })
})
