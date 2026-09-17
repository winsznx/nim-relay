import { runDurableObjectAlarm } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NimiqRpcClient, TransactionNotFoundError, type AddressHistoryEntry, type ChainHead, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { BatonDetail, NetworkHandoffIntent, NetworkSnapshot, OpsReport } from '@nim-relay/shared'
import { DAY_MS, HANDOFF_CHECK_COOLDOWN_MS, MINUTE_MS, SENDER_HISTORY_PAGE_SIZE, UNSENT_PASS_EXPIRY_MS, UNSENT_PASS_LOOKUP_AFTER_MS, UNSENT_PASS_RECHECK_MS } from './constants'
import { AttemptLookupPacer, type AttemptedPass } from './handoff-recovery'
import { api, call, chainTransfer, confirmWith, createBaton, joinNetwork, operator, prepareAndAttempt, raceLeg, randomTxHash, runner, stationRoom, type TestRunner } from './testing'

interface AttemptedHandoff {
  holder: TestRunner
  recipient: TestRunner
  batonId: string
  intent: NetworkHandoffIntent & { attemptedAt: number }
}

/** What the stubbed node answers. Addresses without a history have none. */
interface Chain {
  histories?: Record<string, AddressHistoryEntry[]>
  transactions?: NimiqTransaction[]
  head?: 'current' | 'behind' | 'other-network'
  failing?: 'history' | 'head'
}

/** Moves the Worker clock; Durable Objects share this isolate, so reconciliation sees the same time. */
function travelTo(time: number): void {
  vi.setSystemTime(time)
}

async function attemptedHandoff(title: string): Promise<AttemptedHandoff> {
  const [holder, recipient] = [await runner(), await runner()]
  await joinNetwork(holder, recipient)
  const journey = await createBaton(holder, { mode: 'global', title })
  const leg = await raceLeg(holder, journey.baton.id)
  const intent = await prepareAndAttempt(holder, recipient, leg.issued.runId)
  if (intent.attemptedAt === null) throw new Error('The pass was not attempted')
  return { holder, recipient, batonId: journey.baton.id, intent: { ...intent, attemptedAt: intent.attemptedAt } }
}

/** A chain-history entry for `transaction`, included at `timestamp`. */
function included(transaction: NimiqTransaction, timestamp: number): AddressHistoryEntry {
  return { hash: transaction.hash, timestamp, transaction }
}

/** NIM the holder received at `timestamp`: in every history, never a match. */
function incoming(intent: NetworkHandoffIntent, timestamp: number): AddressHistoryEntry {
  return included({ ...chainTransfer(intent, randomTxHash()), sender: 'NQ00 FAUCET', recipient: intent.sender, data: null }, timestamp)
}

/** The NIM that funded the holder a day before the pass. */
function funding(intent: NetworkHandoffIntent): AddressHistoryEntry {
  return incoming(intent, intent.createdAt - DAY_MS)
}

/** A full history page received since the pass was prepared, whatever page is asked for. */
function busyPage(intent: NetworkHandoffIntent): AddressHistoryEntry[] {
  return Array.from({ length: SENDER_HISTORY_PAGE_SIZE }, () => incoming(intent, intent.createdAt + MINUTE_MS))
}

/** Stubs the node recovery reads: sender histories, the head block and lookups by hash. */
function stubChain(chain: Chain) {
  const histories = vi.spyOn(NimiqRpcClient.prototype, 'getTransactionsByAddress').mockImplementation(async address => {
    if (chain.failing === 'history') throw new Error('fetch failed')
    return chain.histories?.[address] ?? []
  })
  const head = vi.spyOn(NimiqRpcClient.prototype, 'getLatestBlock').mockImplementation(async (): Promise<ChainHead> => {
    if (chain.failing === 'head') throw new Error('fetch failed')
    const timestamp = chain.head === 'behind' ? Date.now() - 2 * UNSENT_PASS_EXPIRY_MS : Date.now()
    return { blockNumber: 12_000_000, timestamp, network: chain.head === 'other-network' ? 'MainAlbatross' : 'TestAlbatross' }
  })
  const byHash = vi.spyOn(NimiqRpcClient.prototype, 'getTransactionByHash').mockImplementation(async hash => {
    const transaction = chain.transactions?.find(candidate => candidate.hash === hash)
    if (!transaction) throw new TransactionNotFoundError(hash)
    return transaction
  })
  return { histories, head, byHash }
}

function checkPass(courier: TestRunner, intent: NetworkHandoffIntent): Promise<NetworkHandoffIntent> {
  return call<NetworkHandoffIntent>(courier.cookie, '/network/handoff/check', { id: intent.id })
}

function snapshotOf(courier: TestRunner): Promise<NetworkSnapshot> {
  return call<NetworkSnapshot>(courier.cookie, '/network')
}

function batonDetail(batonId: string): Promise<BatonDetail> {
  return call<BatonDetail>('', `/network/batons/${batonId}`)
}

async function reconcile(): Promise<void> {
  await runDurableObjectAlarm(stationRoom())
}

describe('attempted passes whose transaction hash never arrived', () => {
  let start: number

  beforeEach(() => {
    start = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    travelTo(start)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('confirm on their own when the sender history holds the exact transfer', async () => {
    // #given a holder whose approval went through while the app closed before reporting the hash
    const { holder, recipient, batonId, intent } = await attemptedHandoff('Approved, then closed')
    const hash = randomTxHash()
    const transfer = chainTransfer(intent, hash)
    const chain = stubChain({ histories: { [intent.sender]: [included(transfer, Date.now()), funding(intent)] }, transactions: [transfer] })
    // #when reconciliation runs after the hash is overdue
    travelTo(intent.attemptedAt + UNSENT_PASS_LOOKUP_AFTER_MS)
    await reconcile()
    // #then the transfer verifies like a reported one and the baton moves
    const detail = await batonDetail(batonId)
    expect({
      holder: detail.baton.holder.id,
      handoff: detail.handoffs.map(handoff => [handoff.leg, handoff.txHash, handoff.to.id]),
      pending: (await snapshotOf(holder)).pendingHandoff,
      headRead: chain.head.mock.calls.length,
    }).toEqual({ holder: recipient.p.id, handoff: [[1, hash, recipient.p.id]], pending: null, headRead: 0 })
  })

  it('wait for the app to report the hash first', async () => {
    // #given a pass attempted just now
    const { holder, intent } = await attemptedHandoff('Still approving')
    const chain = stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    // #when reconciliation runs before the hash is overdue
    travelTo(intent.attemptedAt + UNSENT_PASS_LOOKUP_AFTER_MS - 1_000)
    await reconcile()
    const lookedUpEarly = chain.histories.mock.calls.length
    // #then the chain is not read, and it is once the hash is overdue
    travelTo(intent.attemptedAt + UNSENT_PASS_LOOKUP_AFTER_MS)
    await reconcile()
    expect([lookedUpEarly, chain.histories.mock.calls.length, (await snapshotOf(holder)).pendingHandoff?.state]).toEqual([0, 1, 'attempting'])
    await expireForCleanup(intent)
  })

  it('expire once no block can include a transfer, free the baton and tell the holder', async () => {
    // #given a holder who declined in Nimiq Pay and closed the app
    const { holder, batonId, intent } = await attemptedHandoff('Declined in the wallet')
    stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    // #when reconciliation runs just inside the validity window, then past it
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS - MINUTE_MS)
    await reconcile()
    const inside = (await snapshotOf(holder)).pendingHandoff?.state
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + UNSENT_PASS_RECHECK_MS)
    await reconcile()
    // #then the pass stays open inside the window and expires after it, with the baton still with its holder
    const after = await snapshotOf(holder)
    const expired = await checkPass(holder, intent)
    expect({
      inside,
      pending: after.pendingHandoff,
      pass: [expired.state, expired.failure],
      holder: (await batonDetail(batonId)).baton.holder.id,
      notice: after.inbox.filter(notice => notice.type === 'pass_not_sent').map(notice => [notice.title, notice.body, notice.batonId]),
    }).toEqual({
      inside: 'attempting',
      pending: null,
      pass: ['expired', 'NOT_SENT'],
      holder: holder.p.id,
      notice: [[`Your pass to ${intent.recipientName} was not sent`, 'The baton is still with you.', batonId]],
    })
  })

  it.each([
    ['the history lookup fails', (): Chain => ({ failing: 'history' })],
    ['the head lookup fails', (): Chain => ({ failing: 'head' })],
    ['the node is behind the deadline', (): Chain => ({ head: 'behind' })],
    ['the node serves the other network', (): Chain => ({ head: 'other-network' })],
    ['the history runs past the pages read', (intent: NetworkHandoffIntent): Chain => ({ histories: { [intent.sender]: busyPage(intent) } })],
  ])('stay open while %s, and expire once the chain answers', async (_case, trouble) => {
    // #given a pass attempted and never sent
    const { holder, intent } = await attemptedHandoff('Chain trouble')
    const histories = { [intent.sender]: [funding(intent)] }
    // #when reconciliation runs past the window while the chain cannot prove nothing was sent
    stubChain({ histories, ...trouble(intent) })
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    const during = (await snapshotOf(holder)).pendingHandoff?.state
    // #then the pass stays open, and expires once the node answers
    vi.restoreAllMocks()
    stubChain({ histories })
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS + UNSENT_PASS_RECHECK_MS)
    await reconcile()
    expect([during, (await snapshotOf(holder)).pendingHandoff]).toEqual(['attempting', null])
  })

  it('read a busy sender history only back to when the pass was prepared', async () => {
    // #given a full page of transactions whose oldest came before the pass was prepared
    const { holder, intent } = await attemptedHandoff('Busy sender')
    const chain = stubChain({ histories: { [intent.sender]: [...busyPage(intent).slice(1), funding(intent)] } })
    // #when reconciliation runs past the window
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    // #then one page settles that nothing was sent
    expect([chain.histories.mock.calls.length, (await snapshotOf(holder)).pendingHandoff]).toEqual([1, null])
  })

  it('count the window from the latest attempt, since each one opens Nimiq Pay again', async () => {
    // #given a holder who approves again shortly before the first attempt's window ends
    const { holder, intent } = await attemptedHandoff('Approved again later')
    stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    const retriedAt = intent.attemptedAt + UNSENT_PASS_EXPIRY_MS - 10 * MINUTE_MS
    travelTo(retriedAt)
    await call(holder.cookie, '/network/handoff/attempt', { id: intent.id })
    // #when reconciliation runs past the first attempt's window, then past the second's
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    const afterFirstWindow = (await snapshotOf(holder)).pendingHandoff?.state
    travelTo(retriedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    // #then only the latest attempt's window ends the pass
    expect([afterFirstWindow, (await snapshotOf(holder)).pendingHandoff]).toEqual(['attempting', null])
  })

  it.each([
    ['another recipient', (intent: NetworkHandoffIntent) => ({ recipient: `${intent.recipient}0` })],
    ['another amount', (intent: NetworkHandoffIntent) => ({ value: String(intent.value + 1) })],
    ['other relay data', () => ({ data: 'NR1.OTHERRELAY1.1.AAAAAAAAAAAAAAAAAAAAAA' })],
    ['the other network', () => ({ network: 'MainAlbatross' })],
    ['a failed execution', () => ({ executionResult: false })],
  ])('never bind a transfer with %s', async (_case, mismatch) => {
    // #given a sender history whose only relay transfer differs from the pass
    const { holder, intent } = await attemptedHandoff('Near miss')
    const hash = randomTxHash()
    const nearMiss = chainTransfer(intent, hash, mismatch(intent))
    stubChain({ histories: { [intent.sender]: [included(nearMiss, Date.now()), funding(intent)] }, transactions: [nearMiss] })
    // #when reconciliation runs past the window
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    // #then nothing was bound and the pass expired as never sent
    const pass = await checkPass(holder, intent)
    expect([pass.state, pass.failure, pass.txHash]).toEqual(['expired', 'NOT_SENT', null])
  })

  it('never expire a pass with a transaction hash bound', async () => {
    // #given a reported hash the chain has not included
    const { holder, batonId, intent } = await attemptedHandoff('Hash reported')
    const hash = randomTxHash()
    await confirmWith(holder, intent, hash, new TransactionNotFoundError(hash))
    stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    // #when reconciliation runs long past the window
    travelTo(intent.attemptedAt + 2 * UNSENT_PASS_EXPIRY_MS)
    await reconcile()
    // #then the pass keeps waiting on its transaction, which still verifies
    const waiting = (await snapshotOf(holder)).pendingHandoff
    const verified = await confirmWith(holder, intent, hash, chainTransfer(intent, hash))
    expect([waiting?.state, waiting?.txHash, verified.status, (await batonDetail(batonId)).baton.handoffCount]).toEqual(['submitted', hash, 'verified', 1])
  })

  it('free the baton for an invitation the open pass blocked', async () => {
    // #given an invitation opened while the holder's pass is open
    const { holder, intent, batonId } = await attemptedHandoff('Invitation waiting')
    const invitee = await runner()
    await joinNetwork(invitee)
    const invite = await call<{ token: string }>(holder.cookie, '/network/invite', { batonId })
    const blocked = await api(invitee.cookie, '/network/invite/claim', { token: invite.token })
    // #when the pass expires unsent
    stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    const claimed = await api(invitee.cookie, '/network/invite/claim', { token: invite.token })
    // #then the invitee was told the holder has a pass in progress, and can claim the baton now
    expect({
      blocked: [blocked.status, await blocked.json()],
      claimed: claimed.status,
      reservedFor: (await batonDetail(batonId)).baton.recipientId,
    }).toEqual({ blocked: [409, { error: 'holder_pass_in_progress' }], claimed: 200, reservedFor: invitee.p.id })
  })

  it('count an unsent pass as expired for operators, never as submitted', async () => {
    // #given the operator report before a pass that is never sent
    const ops = await operator()
    const before = await call<OpsReport>(ops.cookie, '/network/ops')
    const { intent } = await attemptedHandoff('Never sent, counted')
    stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    // #when the pass expires unsent
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    await reconcile()
    const after = await call<OpsReport>(ops.cookie, '/network/ops')
    // #then it moved from prepared through attempted to expired, and no hash was counted
    const stages = ['prepared', 'attempted', 'submitted', 'expired', 'open'] as const
    expect(stages.map(stage => after.funnel[stage] - before.funnel[stage])).toEqual([1, 1, 0, 1, 0])
  })
})

describe('a holder checking an attempted pass', () => {
  let start: number

  beforeEach(() => {
    start = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    travelTo(start)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('is refused to anyone but the sender', async () => {
    // #given an attempted pass and the runner it is for
    const { recipient, intent } = await attemptedHandoff('Private check')
    const stranger = await runner()
    const chain = stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    // #when the recipient, a stranger, a signed-out visitor and a malformed request check it
    const responses = [
      await api(recipient.cookie, '/network/handoff/check', { id: intent.id }),
      await api(stranger.cookie, '/network/handoff/check', { id: intent.id }),
      await api('', '/network/handoff/check', { id: intent.id }),
      await api(recipient.cookie, '/network/handoff/check', { id: 'not-an-intent' }),
    ]
    // #then none of them reaches the chain or learns the pass exists
    expect({ statuses: responses.map(response => response.status), lookups: chain.histories.mock.calls.length }).toEqual({ statuses: [404, 404, 401, 400], lookups: 0 })
    await expireForCleanup(intent)
  })

  it('confirms a transfer found on chain at once', async () => {
    // #given an approval that went through a moment ago without its hash reaching the relay
    const { holder, recipient, batonId, intent } = await attemptedHandoff('Checked at once')
    const hash = randomTxHash()
    const transfer = chainTransfer(intent, hash)
    stubChain({ histories: { [intent.sender]: [included(transfer, Date.now()), funding(intent)] }, transactions: [transfer] })
    // #when the holder checks the pass
    const checked = await checkPass(holder, intent)
    // #then it verified and the baton moved
    expect([checked.state, checked.txHash, (await batonDetail(batonId)).baton.holder.id]).toEqual(['verified', hash, recipient.p.id])
  })

  it('binds a found transfer that still needs confirmations, and it verifies like a reported one', async () => {
    // #given a transfer in a block with one confirmation
    const { holder, batonId, intent } = await attemptedHandoff('Found, confirming')
    const hash = randomTxHash()
    const fresh = chainTransfer(intent, hash, { confirmations: 1 })
    stubChain({ histories: { [intent.sender]: [included(fresh, Date.now()), funding(intent)] }, transactions: [fresh] })
    // #when the holder checks it, then confirms the bound hash once it is confirmed again
    const checked = await checkPass(holder, intent)
    vi.restoreAllMocks()
    const verified = await confirmWith(holder, intent, hash, chainTransfer(intent, hash))
    // #then the hash was bound while waiting and verifies once confirmed
    expect([checked.state, checked.txHash, verified.status, (await batonDetail(batonId)).baton.handoffCount]).toEqual(['submitted', hash, 'verified', 1])
  })

  it('leaves the pass open when nothing is on chain yet, and paces repeated checks', async () => {
    // #given a pass with no transfer on chain
    const { holder, intent } = await attemptedHandoff('Nothing yet')
    const chain = stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    // #when the holder checks twice in a row, then again after the cooldown
    const first = await checkPass(holder, intent)
    const second = await checkPass(holder, intent)
    const paced = chain.histories.mock.calls.length
    travelTo(start + HANDOFF_CHECK_COOLDOWN_MS)
    await checkPass(holder, intent)
    // #then the pass stays attempting and only the checks outside the cooldown read the chain
    expect([first.state, second.state, paced, chain.histories.mock.calls.length]).toEqual(['attempting', 'attempting', 1, 2])
    await expireForCleanup(intent)
  })

  it('keeps the pass open when the holder approves again while the chain is read', async () => {
    // #given a pass past its window, and a holder who opens Nimiq Pay again while the relay reads the sender history
    const { holder, intent } = await attemptedHandoff('Approved during the check')
    const chain = stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    chain.histories.mockImplementationOnce(async () => {
      await call(holder.cookie, '/network/handoff/attempt', { id: intent.id })
      return [funding(intent)]
    })
    // #when the holder checks the pass
    const checked = await checkPass(holder, intent)
    // #then what the chain showed for the earlier attempt leaves the new attempt open
    expect([checked.state, checked.attemptedAt]).toEqual(['attempting', Date.now()])
    await expireForCleanup({ ...intent, attemptedAt: Date.now() })
  })

  it('expires the pass when the holder checks after the window', async () => {
    // #given a pass attempted and never sent, past its window
    const { holder, intent } = await attemptedHandoff('Checked too late')
    stubChain({ histories: { [intent.sender]: [funding(intent)] } })
    travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + MINUTE_MS)
    // #when the holder checks it
    const checked = await checkPass(holder, intent)
    // #then it expired as never sent and the holder can pass again
    expect([checked.state, checked.failure, (await snapshotOf(holder)).pendingHandoff]).toEqual(['expired', 'NOT_SENT', null])
  })
})

describe('attempt lookup pacing', () => {
  const pass = (id: string, attemptedAt: number): AttemptedPass => ({ id, attemptedAt, createdAt: attemptedAt, sender: 'NQ00A', recipient: 'NQ00B', value: 100_000, data: 'NR1.CODE000001.1.AAAAAAAAAAAAAAAAAAAAAA', network: 'TestAlbatross' })

  it('takes passes not looked up within the interval, least recently looked up first, up to the limit', () => {
    // #given three passes, two of them looked up at different times
    const pacer = new AttemptLookupPacer()
    const [a, b, c] = [pass('a', 0), pass('b', 0), pass('c', 0)]
    pacer.take([b], 1_000, 0, 1)
    pacer.take([a], 2_000, 0, 1)
    // #when two are taken past the interval, and again right after
    const taken = pacer.take([a, b, c], 10_000, 5_000, 2).map(({ id }) => id)
    const again = pacer.take([a, b, c], 10_001, 5_000, 2).map(({ id }) => id)
    // #then the never looked up pass goes first, then the older lookup, and none is due right after
    expect([taken, again]).toEqual([['c', 'b'], ['a']])
  })

  it('forgets passes that stopped waiting', () => {
    // #given a pass looked up just now
    const pacer = new AttemptLookupPacer()
    const a = pass('a', 0)
    pacer.take([a], 1_000, 0, 1)
    // #when it leaves the open passes and comes back
    pacer.retain([])
    // #then it is due at once
    expect(pacer.take([a], 1_001, 5_000, 1)).toEqual([a])
  })
})

/** Ends a pass left attempting, so later tests in this file see no open pass of it. */
async function expireForCleanup(intent: NetworkHandoffIntent & { attemptedAt: number }): Promise<void> {
  vi.restoreAllMocks()
  stubChain({})
  travelTo(intent.attemptedAt + UNSENT_PASS_EXPIRY_MS + DAY_MS)
  await reconcile()
}
