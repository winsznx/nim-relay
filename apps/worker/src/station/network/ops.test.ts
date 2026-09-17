import { runInDurableObject, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import { paymentAddress } from '@nim-relay/relay-protocol'
import type { IssuedRace, NetworkHandoffIntent, OpsDay, OpsReport, RaceTrace, TrackEventResult } from '@nim-relay/shared'
import { readNetworkState } from './state'
import {
  api,
  call,
  chainTransfer,
  confirmWith,
  createBaton,
  failingTrace,
  finishingTrace,
  IDLE_TRACE,
  joinNetwork,
  operator,
  passBaton,
  prepareAndAttempt,
  raceLeg,
  randomTxHash,
  runner,
  stationRoom,
  TEST_OPERATOR_HANDLE,
  v6Config,
  withLateSample,
  type TestRunner,
} from './testing'

const NETWORK_KEY = 'network:TestAlbatross'
/** Three-field v5 samples: never a valid v6 relay leg trace. */
const V5_SHAPED_TRACE = [[0, 0, 0]]

async function opsReport(): Promise<OpsReport> {
  return call<OpsReport>((await operator()).cookie, '/network/ops')
}

function today(report: OpsReport): OpsDay {
  const day = report.days.at(-1)
  if (!day) throw new Error('Operator report has no days')
  return day
}

/** Change in a day counter; a counter that was not recorded makes the difference NaN. */
function change(after: number | null, before: number | null): number {
  return (after ?? Number.NaN) - (before ?? Number.NaN)
}

function lunaMoved(report: OpsReport): number {
  return report.nimFlow.find(flow => flow.network === 'TestAlbatross')?.luna ?? 0
}

function windowTotal(report: OpsReport, counter: 'runsVerified' | 'runsRefused'): number {
  return report.days.reduce((total, day) => total + (day[counter] ?? 0), 0)
}

async function issueLeg(courier: TestRunner, title: string): Promise<IssuedRace> {
  const journey = await createBaton(courier, { mode: 'global', title })
  return call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
}

async function submitStatus(courier: TestRunner, issued: IssuedRace, inputTrace: RaceTrace | unknown[]): Promise<number> {
  return (await api(courier.cookie, '/submit', { issued, inputTrace })).status
}

async function attemptedHandoff(title: string): Promise<{ a: TestRunner; b: TestRunner; runId: string }> {
  const [a, b] = [await runner(), await runner()]
  await joinNetwork(a, b)
  const journey = await createBaton(a, { mode: 'global', title })
  const leg = await raceLeg(a, journey.baton.id)
  return { a, b, runId: leg.issued.runId }
}

describe('operator report access', () => {
  it('asks for a session first', async () => {
    // #when the report is requested signed out
    const response = await api('', '/network/ops')
    // #then it is refused before any operator check
    expect(response.status).toBe(401)
  })

  it('refuses a signed-in runner OPS_PLAYERS does not list', async () => {
    // #given a runner who is not an operator
    const courier = await runner()
    // #when they request the report
    const response = await api(courier.cookie, '/network/ops')
    // #then it is forbidden
    expect([response.status, await response.json()]).toEqual([403, { error: 'operators_only' }])
  })

  it('serves the listed operator thirty UTC days of this Worker’s network', async () => {
    // #given the runner OPS_PLAYERS lists by handle
    const ops = await operator()
    // #when they request the report
    const response = await api(ops.cookie, '/network/ops')
    const report = (await response.json()) as OpsReport
    // #then it covers this network up to today and is never cached
    expect({ status: response.status, cache: response.headers.get('Cache-Control'), handle: ops.p.handle, network: report.network, days: report.days.length, today: today(report).date }).toEqual({
      status: 200,
      cache: 'no-store',
      handle: TEST_OPERATOR_HANDLE,
      network: 'TestAlbatross',
      days: 30,
      today: new Date().toISOString().slice(0, 10),
    })
  })
})

describe('operator handoff counters', () => {
  it('follow a pass from preparation through a rejected transfer to verification', async () => {
    // #given a raced leg
    const { a, b, runId } = await attemptedHandoff('Counted pass')
    const before = await opsReport()
    // #when the holder attempts the pass, sends it to the wrong recipient, then sends the right transfer
    const intent = await prepareAndAttempt(a, b, runId)
    const wrongHash = randomTxHash()
    await confirmWith(a, intent, wrongHash, chainTransfer(intent, wrongHash, { recipient: 'NQ00 ANOTHER RUNNER' }))
    const rightHash = randomTxHash()
    await confirmWith(a, intent, rightHash, chainTransfer(intent, rightHash))
    const after = await opsReport()
    // #then each stage counts once, the rejection keeps its reason, and the day gains a qualified handoff moving one NIM
    const stages = ['prepared', 'attempted', 'submitted', 'verified', 'open', 'cancelled', 'expired'] as const
    expect({
      stages: stages.map(stage => after.funnel[stage] - before.funnel[stage]),
      recipientMismatches: after.funnel.rejections.RECIPIENT_MISMATCH - before.funnel.rejections.RECIPIENT_MISMATCH,
      handoffs: change(today(after).qualifiedHandoffs, today(before).qualifiedHandoffs),
      luna: lunaMoved(after) - lunaMoved(before),
      median: typeof after.funnel.medianAttemptToVerifiedMs,
    }).toEqual({ stages: [1, 1, 1, 1, 0, 0, 0], recipientMismatches: 1, handoffs: 1, luna: intent.value, median: 'number' })
  })

  it('count a cancelled pass, and a transfer sent for it as INTENT_EXPIRED', async () => {
    // #given a raced leg
    const { a, b, runId } = await attemptedHandoff('Cancelled pass')
    const before = await opsReport()
    // #when the holder prepares and cancels the pass, then submits a transaction for it anyway
    const intent = await call<NetworkHandoffIntent>(a.cookie, '/network/handoff/prepare', { runId, recipient: b.p.id })
    await call(a.cookie, '/network/handoff/cancel', { id: intent.id })
    const hash = randomTxHash()
    const confirmation = await confirmWith(a, intent, hash, chainTransfer(intent, hash))
    const after = await opsReport()
    // #then the pass is cancelled without reaching Nimiq Pay and the transfer is rejected as expired
    expect({
      reason: confirmation.reason,
      stages: (['prepared', 'attempted', 'submitted', 'cancelled'] as const).map(stage => after.funnel[stage] - before.funnel[stage]),
      expired: after.funnel.rejections.INTENT_EXPIRED - before.funnel.rejections.INTENT_EXPIRED,
    }).toEqual({ reason: 'INTENT_EXPIRED', stages: [1, 0, 0, 1], expired: 1 })
  })
})

describe('operator run counters', () => {
  it('count an invalid trace as a rejected run and flag it once by handle', async () => {
    // #given an issued leg
    const courier = await runner()
    const issued = await issueLeg(courier, 'Bad trace')
    const before = await opsReport()
    // #when a trace in the v5 sample shape is submitted twice
    const statuses = [await submitStatus(courier, issued, V5_SHAPED_TRACE), await submitStatus(courier, issued, V5_SHAPED_TRACE)]
    const after = await opsReport()
    // #then both are refused as before, count as rejected, and fold into one flagged entry
    expect({
      statuses,
      rejected: change(today(after).runsRejected, today(before).runsRejected),
      submitted: change(today(after).runsSubmitted, today(before).runsSubmitted),
      flagged: after.flaggedRuns.filter(run => run.handle === courier.p.handle),
    }).toEqual({
      statuses: [400, 400],
      rejected: 2,
      submitted: 2,
      flagged: [{ handle: courier.p.handle, reason: 'INVALID_TRACE', mode: 'global', practice: false, at: expect.any(Number), attempts: 2 }],
    })
  })

  it('count samples after a failed or finished leg as an invalid trace, never as an outage', async () => {
    // #given an issued leg, and its failing and finishing traces, each sampled past the tick its leg ended on
    const courier = await runner()
    const issued = await issueLeg(courier, 'Past the line')
    const config = v6Config(issued.config)
    const raced = [failingTrace(config), finishingTrace(config)]
    const late = raced.map(trace => withLateSample(trace, relayLeg.replay({ ...config, inputTrace: trace }).ticks))
    const before = await opsReport()
    // #when both late traces are submitted, and then the finishing trace as it was raced
    const refused: unknown[] = []
    for (const inputTrace of late) {
      const response = await api(courier.cookie, '/submit', { issued, inputTrace })
      refused.push([response.status, await response.json()])
    }
    const recorded = await submitStatus(courier, issued, raced[1]!)
    const after = await opsReport()
    // #then both are refused as invalid traces, counted and flagged once by handle, and the raced trace still records
    expect({
      refused,
      recorded,
      rejected: change(today(after).runsRejected, today(before).runsRejected),
      flagged: after.flaggedRuns.filter(run => run.handle === courier.p.handle),
    }).toEqual({
      refused: [
        [400, { error: 'invalid_trace' }],
        [400, { error: 'invalid_trace' }],
      ],
      recorded: 200,
      rejected: 2,
      flagged: [{ handle: courier.p.handle, reason: 'INVALID_TRACE', mode: 'global', practice: false, at: expect.any(Number), attempts: 2 }],
    })
  })

  it('flag a submission whose signed ticket was changed as a MAC mismatch', async () => {
    // #given an issued leg
    const courier = await runner()
    const issued = await issueLeg(courier, 'Changed ticket')
    // #when it comes back marked as practice
    const status = await submitStatus(courier, { ...issued, practice: true }, IDLE_TRACE)
    const report = await opsReport()
    // #then the refusal is unchanged and the run is flagged
    expect({ status, flagged: report.flaggedRuns.find(run => run.handle === courier.p.handle)?.reason }).toEqual({ status: 401, flagged: 'MAC_MISMATCH' })
  })

  it('count a verified run, and a ticket submitted after it expired as refused', async () => {
    // #given one leg raced in time and a second ticket
    const courier = await runner()
    const journey = await createBaton(courier, { mode: 'global', title: 'In and out of time' })
    const before = await opsReport()
    await raceLeg(courier, journey.baton.id)
    const late = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId: journey.baton.id })
    // #when the second ticket is submitted after it expired
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(late.expiresAt + 1)
      const status = await submitStatus(courier, late, IDLE_TRACE)
      const after = await opsReport()
      // #then the expiry is refused as before and each outcome counts once
      expect({ status, verified: windowTotal(after, 'runsVerified') - windowTotal(before, 'runsVerified'), refused: windowTotal(after, 'runsRefused') - windowTotal(before, 'runsRefused') }).toEqual({ status: 410, verified: 1, refused: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('operator share tallies', () => {
  it('count a share on its surface and day', async () => {
    // #given a signed-in runner
    const courier = await runner()
    const before = await opsReport()
    // #when they share a Daily card
    const response = await SELF.fetch('https://example.com/api/station/network/track', { method: 'POST', headers: { Cookie: courier.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'share', surface: 'daily' }) })
    const after = await opsReport()
    // #then the total, the Daily surface and today each gain one
    expect({
      counted: ((await response.json()) as TrackEventResult).counted,
      total: after.totals.shares.total - before.totals.shares.total,
      daily: after.totals.shares.bySurface.daily - before.totals.shares.bySurface.daily,
      today: change(today(after).shares, today(before).shares),
    }).toEqual({ counted: true, total: 1, daily: 1, today: 1 })
  })
})

describe('operator alerts', () => {
  it('lead with a critical alert once a handoff check returns RPC_UNAVAILABLE', async () => {
    // #given an attempted pass
    const { a, b, runId } = await attemptedHandoff('RPC down')
    const intent = await prepareAndAttempt(a, b, runId)
    // #when the chain lookup fails
    await confirmWith(a, intent, randomTxHash(), new Error('fetch failed'))
    const report = await opsReport()
    // #then the alert says how recent it was
    expect(report.alerts.find(alert => alert.id === 'rpc_unavailable')).toMatchObject({ severity: 'critical', condition: expect.stringMatching(/^The latest RPC_UNAVAILABLE was under 1 min ago/) })
  })
})

describe('operator report privacy', () => {
  it('names runners by handle and carries no wallets, ids, sessions, invite tokens, run ids or secrets', async () => {
    // #given runners who invited, passed a baton and had a run flagged
    const [a, b] = [await runner(), await runner()]
    await joinNetwork(a, b)
    const journey = await createBaton(a, { mode: 'global', title: 'Private by default' })
    const invite = await call<{ token: string }>(a.cookie, '/network/invite', { batonId: journey.baton.id })
    const pass = await passBaton(a, b, journey.baton.id)
    const flagged = await call<IssuedRace>(b.cookie, '/network/issue', { batonId: journey.baton.id })
    await submitStatus(b, flagged, V5_SHAPED_TRACE)
    const ops = await operator()
    // #when the operator reads the report
    const text = await (await api(ops.cookie, '/network/ops')).text()
    // #then only the flagged runner's handle identifies anyone
    const identifying = [
      ...[a, b, ops].flatMap(courier => [courier.p.id, courier.p.walletAddress, paymentAddress(courier.p.walletAddress), courier.cookie.slice('nr_session='.length)]),
      invite.token,
      pass.txHash,
      pass.issued.runId,
      flagged.runId,
      'test-session-secret',
      'test-device-hash-secret',
      'test-run-challenge-secret',
    ]
    expect({ leaked: identifying.filter(value => text.includes(value)), handle: text.includes(b.p.handle) }).toEqual({ leaked: [], handle: true })
  })
})

describe('operator report reads', () => {
  it('leave network state, product state, traffic and the ledger exactly as they were', async () => {
    // #given stored network state and no alarm due while the report is read
    const ops = await operator()
    await call(ops.cookie, '/network')
    const room = stationRoom()
    const stored = () =>
      runInDurableObject(room, async (_instance, state) =>
        JSON.stringify({ network: await readNetworkState(state.storage, NETWORK_KEY), rest: Object.fromEntries(await state.storage.get(['state', `${NETWORK_KEY}:traffic`, `${NETWORK_KEY}:ops`])) }),
      )
    const alarm = await runInDurableObject(room, async (_instance, state) => {
      const scheduled = await state.storage.getAlarm()
      await state.storage.deleteAlarm()
      return scheduled
    })
    try {
      const before = await stored()
      // #when the operator reads the report twice
      await call(ops.cookie, '/network/ops')
      await call(ops.cookie, '/network/ops')
      // #then nothing in storage changed
      expect(await stored()).toBe(before)
    } finally {
      if (alarm !== null) await runInDurableObject(room, (_instance, state) => state.storage.setAlarm(alarm))
    }
  })
})
