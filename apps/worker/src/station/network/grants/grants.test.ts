import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NimiqRpcClient, nimiqAddressFromPrivateKey, parseSignedTransfer, paymentAddress, TransactionNotFoundError, type AddressHistoryEntry, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { BatonDetail, GrantClaimResult, GrantMilestoneId, GrantsOpsReport, GrantsSummary, GrantsView, NetworkSnapshot } from '@nim-relay/shared'
import { createSessionToken } from '../../../auth/session'
import { getAuthStore, type PlayerRecord } from '../../../auth/store'
import type { Env } from '../../../env'
import type { State } from '../../model'
import { TRANSACTION_VALIDITY_WINDOW_BLOCKS } from '../constants'
import { LiveLegs, liveKeyPrefix } from '../live'
import { RelayNetworkService } from '../service'
import { api, call, joinNetwork, passBaton, stationRoom, type TestRunner } from '../testing'
import { VALIDITY_MARGIN_BLOCKS } from './chain'
import { GrantDesk } from './desk'
import { deviceChargeKey, grantRecordKey, walletChargeKey, type GrantLedger, type GrantRecord } from './ledger'

/** TREASURY_PRIVATE_KEY in vitest.config.ts: a throwaway key that never held funds. */
const TREASURY_KEY = '5a'.repeat(32)
const NETWORK_KEY = 'network:TestAlbatross'
const GRANTS = `${NETWORK_KEY}:grants`
const ONE_NIM = 100_000
const START_HEIGHT = 11_700_000

let treasuryAddress = ''

/** The node the grant flow talks to: balances, a head, broadcasts it records, and transactions it has included. */
interface Chain {
  treasuryLuna: number
  wallets: Map<string, number>
  head: number
  /** Serialized transfers the node received, in order. */
  sent: string[]
  refuseBroadcast: boolean
  included: Map<string, NimiqTransaction>
  history: AddressHistoryEntry[]
  failReads: boolean
}

function newChain(overrides: Partial<Chain> = {}): Chain {
  return { treasuryLuna: 100 * ONE_NIM, wallets: new Map(), head: START_HEIGHT, sent: [], refuseBroadcast: false, included: new Map(), history: [], failReads: false, ...overrides }
}

function stubChain(chain: Chain): void {
  vi.spyOn(NimiqRpcClient.prototype, 'getAccountBalance').mockImplementation(async address => {
    if (chain.failReads) throw new Error('fetch failed')
    const luna = paymentAddress(address) === treasuryAddress ? chain.treasuryLuna : (chain.wallets.get(paymentAddress(address)) ?? 0)
    return { luna: BigInt(luna), blockNumber: chain.head }
  })
  vi.spyOn(NimiqRpcClient.prototype, 'getBlockNumber').mockImplementation(async () => chain.head)
  vi.spyOn(NimiqRpcClient.prototype, 'sendRawTransaction').mockImplementation(async serialized => {
    if (chain.refuseBroadcast) throw new Error('RPC HTTP 502')
    chain.sent.push(serialized)
    return parseSignedTransfer(serialized).hash
  })
  vi.spyOn(NimiqRpcClient.prototype, 'getTransactionByHash').mockImplementation(async hash => {
    const transaction = chain.included.get(hash)
    if (!transaction) throw new TransactionNotFoundError(hash)
    return transaction
  })
  vi.spyOn(NimiqRpcClient.prototype, 'getTransactionsByAddress').mockImplementation(async () => chain.history)
}

/** Includes a transfer the node received, as the chain would report it. */
function include(chain: Chain, serialized: string, overrides: Partial<NimiqTransaction> = {}): NimiqTransaction {
  const parsed = parseSignedTransfer(serialized)
  const transaction: NimiqTransaction = { hash: parsed.hash, sender: parsed.sender, recipient: parsed.recipient, value: String(parsed.valueLuna), data: new TextDecoder().decode(parsed.data), network: 'TestAlbatross', blockNumber: chain.head, confirmations: 2, executionResult: true, ...overrides }
  chain.included.set(parsed.hash, transaction)
  return transaction
}

function randomWallet(): string {
  return paymentAddress(Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join(''))
}

/** A runner signed in with a device signal (the HMAC the auth route would store), or without one. */
async function deviceRunner(device: string | null, existing?: PlayerRecord): Promise<TestRunner> {
  const store = getAuthStore(undefined)
  const p = existing ?? (await store.createPlayer({ walletAddress: randomWallet(), walletPublicKey: '00'.repeat(32) }))
  const deviceHash = device ? `hmac-${device}` : null
  const session = await store.createSession({ playerId: p.id, deviceHash, expiresAt: Date.now() + 86_400_000 })
  const token = await createSessionToken({ SESSION_SECRET: 'test-session-secret' } as Env, { sessionId: session.id, playerId: p.id })
  const courier = { p, cookie: `nr_session=${token}` }
  await joinNetwork(courier)
  return courier
}

const claim = (courier: TestRunner, grantId: GrantMilestoneId) => api(courier.cookie, '/network/grants/claim', { grantId })
const grantsOf = (courier: TestRunner) => call<GrantsView>(courier.cookie, '/network/grants')

async function claimed(courier: TestRunner, grantId: GrantMilestoneId): Promise<GrantClaimResult> {
  const response = await claim(courier, grantId)
  if (!response.ok) throw new Error(`claim ${grantId} answered ${response.status}: ${await response.text()}`)
  return response.json() as Promise<GrantClaimResult>
}

async function refusal(response: Response): Promise<[number, string]> {
  const body: { error?: string } = await response.json()
  return [response.status, body.error ?? '']
}

function stored<T>(key: string): Promise<T | undefined> {
  return runInDurableObject(stationRoom(), (_instance, state) => state.storage.get<T>(key))
}

const ledger = () => stored<GrantLedger>(GRANTS)
const recordOf = (courier: TestRunner, milestone: GrantMilestoneId) => stored<GrantRecord>(grantRecordKey(GRANTS, `grant:${milestone}:${courier.p.id}`))

async function reconcile(): Promise<void> {
  await runDurableObjectAlarm(stationRoom())
}

/** A GrantDesk on the room's storage with `overrides` on the Worker variables, as a fresh object instance would build it. */
function withDesk<T>(overrides: Record<string, string | undefined>, work: (desk: GrantDesk, loadNetwork: () => Promise<RelayNetworkService>) => Promise<T>): Promise<T> {
  return runInDurableObject(stationRoom(), async (_instance, state) => {
    const deskEnv = { ...env, ...overrides } as Env
    const live = new LiveLegs(state.storage, liveKeyPrefix(NETWORK_KEY))
    const loadNetwork = async () => {
      const product = await state.storage.get<State>('state')
      if (!product) throw new Error('Station state missing')
      return RelayNetworkService.load(state.storage, deskEnv, product, live)
    }
    return work(new GrantDesk({ storage: state.storage, env: deskEnv, exclusively: task => task(), loadNetwork }), loadNetwork)
  })
}

async function operatorWithDevice(): Promise<TestRunner> {
  const store = getAuthStore(undefined)
  const p = await store.createPlayer({ walletAddress: 'NQ00TESTOPERATOR0PS0PS', walletPublicKey: '00'.repeat(32) })
  return deviceRunner('operator-phone', p)
}

beforeAll(async () => {
  treasuryAddress = await nimiqAddressFromPrivateKey(TREASURY_KEY)
})

beforeEach(async () => {
  await runInDurableObject(stationRoom(), async (_instance, state) => {
    const keys = [...(await state.storage.list({ prefix: GRANTS })).keys()]
    for (let offset = 0; offset < keys.length; offset += 128) await state.storage.delete(keys.slice(offset, offset + 128))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('starter grants', () => {
  it('pay an unfunded runner exactly the starter amount from the treasury, once', async () => {
    // #given a signed-in runner with a device signal and an empty wallet
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-a')
    expect((await grantsOf(courier)).milestones.find(item => item.id === 'starter')).toMatchObject({ state: 'available', luna: ONE_NIM })

    // #when they claim the Starter Baton
    const result = await claimed(courier, 'starter')

    // #then one transfer of 1 NIM to their wallet went to the node, and the grant waits for confirmations
    expect(chain.sent).toHaveLength(1)
    const transfer = parseSignedTransfer(chain.sent[0]!)
    expect([transfer.sender, transfer.recipient, transfer.valueLuna, transfer.networkId, transfer.validityStartHeight]).toEqual([treasuryAddress, paymentAddress(courier.p.walletAddress), BigInt(ONE_NIM), 5, START_HEIGHT])
    expect(result.milestone).toMatchObject({ state: 'pending', phase: 'confirming', txHash: transfer.hash })
    expect(result.grants.claimedLuna).toBe(ONE_NIM)
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'broadcast', luna: ONE_NIM, txHash: transfer.hash })
  })

  it('refuse a runner whose wallet already holds a baton', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-b')
    chain.wallets.set(paymentAddress(courier.p.walletAddress), 2 * ONE_NIM)

    expect(await refusal(await claim(courier, 'starter'))).toEqual([409, 'wallet_already_funded'])
    expect(chain.sent).toHaveLength(0)
    expect((await ledger())?.globalLuna).toBe(0)
  })

  it('never pay a wallet twice: another device on the same wallet gets the same grant back', async () => {
    const chain = newChain()
    stubChain(chain)
    const first = await deviceRunner('phone-c')
    const original = await claimed(first, 'starter')
    const sameWalletOtherDevice = await deviceRunner('tablet-c', first.p)

    const again = await claimed(sameWalletOtherDevice, 'starter')

    expect(chain.sent).toHaveLength(1)
    expect(again.milestone.txHash).toBe(original.milestone.txHash)
    expect(await stored(deviceChargeKey(GRANTS, 'hmac-tablet-c'))).toBeUndefined()
  })

  it('block a new wallet on a device that already claimed, and log it with hashed ids only', async () => {
    const chain = newChain()
    stubChain(chain)
    await claimed(await deviceRunner('shared-phone'), 'starter')
    const otherWallet = await deviceRunner('shared-phone')

    expect(await refusal(await claim(otherWallet, 'starter'))).toEqual([409, 'device_already_claimed'])
    expect(chain.sent).toHaveLength(1)
    const [entry] = (await ledger())?.abuse ?? []
    expect(entry).toMatchObject({ reason: 'device_already_claimed', milestone: 'starter' })
    expect(JSON.stringify(entry)).not.toContain('shared-phone')
    expect(JSON.stringify(entry)).not.toContain(paymentAddress(otherWallet.p.walletAddress))
  })

  it('require a device signal, and say so', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner(null)
    const view = await grantsOf(courier)
    expect(view.deviceSignal).toBe(false)
    expect(view.milestones.find(item => item.id === 'starter')).toMatchObject({ state: 'locked', blocked: 'no_device_signal' })
    expect(await refusal(await claim(courier, 'starter'))).toEqual([409, 'no_device_signal'])
    expect(chain.sent).toHaveLength(0)
  })

  it('answer a double click and concurrent claims with one transfer', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-d')

    const concurrent = await Promise.all([claim(courier, 'starter'), claim(courier, 'starter'), claim(courier, 'starter')])
    const again = await claimed(courier, 'starter')

    const bodies = await Promise.all(concurrent.map(response => response.json() as Promise<GrantClaimResult>))
    expect(concurrent.map(response => response.status)).toEqual([200, 200, 200])
    expect(chain.sent).toHaveLength(1)
    const hash = parseSignedTransfer(chain.sent[0]!).hash
    expect(new Set([...bodies.map(body => body.milestone.txHash), again.milestone.txHash])).toEqual(new Set([hash]))
    expect((await ledger())?.globalLuna).toBe(ONE_NIM)
  })

  it('ignore amounts and recipients sent by the client: the schema refuses unknown fields', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-e')
    for (const body of [{ grantId: 'starter', amount: 500_000 }, { grantId: 'starter', recipient: randomWallet() }, { grantId: 'jackpot' }, {}]) {
      expect(await refusal(await api(courier.cookie, '/network/grants/claim', body))).toEqual([400, 'bad_request'])
    }
    expect(chain.sent).toHaveLength(0)
  })

  it('refuse cleanly when the treasury cannot cover the grant, reserving nothing', async () => {
    const chain = newChain({ treasuryLuna: ONE_NIM / 2 })
    stubChain(chain)
    const courier = await deviceRunner('phone-f')
    expect(await refusal(await claim(courier, 'starter'))).toEqual([409, 'treasury_exhausted'])
    expect(chain.sent).toHaveLength(0)
    expect((await ledger())?.globalLuna).toBe(0)
    expect(await stored(walletChargeKey(GRANTS, paymentAddress(courier.p.walletAddress)))).toBeUndefined()
  })

  it('fail closed when the chain cannot be read', async () => {
    const chain = newChain({ failReads: true })
    stubChain(chain)
    const courier = await deviceRunner('phone-g')
    expect(await refusal(await claim(courier, 'starter'))).toEqual([503, 'treasury_unavailable'])
    expect(chain.sent).toHaveLength(0)
  })
})

describe('safety switches', () => {
  it('keep grants off unless TREASURY_ENABLED is exactly "true"', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-h')
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      const view = await withDesk({ TREASURY_ENABLED: value }, desk => desk.view({ player: courier.p, deviceHash: 'hmac-phone-h' }))
      expect(view.enabled).toBe(false)
      expect(view.milestones.every(item => item.state === 'locked' && item.blocked === 'grants_disabled')).toBe(true)
      const refused = await withDesk({ TREASURY_ENABLED: value }, desk => desk.claim({ player: courier.p, deviceHash: 'hmac-phone-h' }, { grantId: 'starter' }).catch((error: unknown) => error))
      expect(refused).toMatchObject({ code: 'grants_disabled' })
    }
    expect(chain.sent).toHaveLength(0)
  })

  it('stop claims the moment an operator pauses, and only operators can', async () => {
    const chain = newChain()
    stubChain(chain)
    const [courier, ops] = [await deviceRunner('phone-i'), await operatorWithDevice()]

    expect((await api(courier.cookie, '/network/grants/pause', { paused: true })).status).toBe(403)
    const paused = await call<GrantsOpsReport>(ops.cookie, '/network/grants/pause', { paused: true })
    expect(paused).toMatchObject({ paused: true, pausedBy: ops.p.handle })
    expect(await refusal(await claim(courier, 'starter'))).toEqual([409, 'grants_paused'])
    expect((await call<GrantsSummary>('', '/network/grants/summary')).paused).toBe(true)

    await call<GrantsOpsReport>(ops.cookie, '/network/grants/pause', { paused: false })
    await claimed(courier, 'starter')
    expect(chain.sent).toHaveLength(1)
  })
})

describe('transaction recovery', () => {
  it('re-broadcasts the same signed bytes after a restart until the grant confirms, then hands over the starter baton', async () => {
    // #given a claim whose broadcast never reached the node
    const chain = newChain({ refuseBroadcast: true })
    stubChain(chain)
    const courier = await deviceRunner('phone-j')
    const pending = await claimed(courier, 'starter')
    expect(pending.milestone).toMatchObject({ state: 'pending', phase: 'signed' })
    const signed = await recordOf(courier, 'starter')
    if (!signed) throw new Error('Grant record missing')

    // #when the node is back and a fresh object instance runs the verification loop
    chain.refuseBroadcast = false
    await withDesk({}, async (desk, loadNetwork) => desk.applyEvidence(await loadNetwork(), await desk.gatherEvidence()))

    // #then the exact same bytes went out, and the hash never changed
    expect(chain.sent).toEqual([signed.serializedHex])
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'broadcast', txHash: signed.txHash })

    // #when the chain includes it with enough confirmations
    include(chain, signed.serializedHex)
    await reconcile()

    // #then the grant confirms and the runner holds a Starter Baton that is not a handoff
    const confirmed = await recordOf(courier, 'starter')
    expect(confirmed).toMatchObject({ state: 'confirmed', confirmations: 2 })
    const snapshot = await call<NetworkSnapshot>(courier.cookie, '/network')
    const baton = snapshot.batons.find(item => item.id === confirmed?.batonId)
    expect(baton).toMatchObject({ handoffCount: 0, starterGrant: { kind: 'treasury_starter_grant', txHash: signed.txHash, station: 'genesis' }, route: { origin: 'genesis' } })
    expect(baton?.holder.id).toBe(courier.p.id)
    expect(snapshot.metrics.qualifiedHandoffs).toBe(0)
    expect(baton?.transactingWallets).toBe(0)
    const view = await grantsOf(courier)
    expect(view.milestones.find(item => item.id === 'starter')).toMatchObject({ state: 'confirmed', batonCode: baton?.code })
    expect(view.confirmedLuna).toBe(ONE_NIM)
  })

  it('confirm for the runner watching their grant without waiting for the alarm', async () => {
    // #given a broadcast grant the chain has confirmed, and an alarm that open apps keep pushing back
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-watch')
    await claimed(courier, 'starter')
    include(chain, chain.sent[0]!)
    // #when the runner's app polls their grants
    const view = await grantsOf(courier)
    // #then the grant confirms on that read and the starter baton exists
    expect(view.milestones.find(item => item.id === 'starter')).toMatchObject({ state: 'confirmed', batonCode: expect.any(String) })
  })

  it('keep a grant pending through low confirmations', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-k')
    await claimed(courier, 'starter')
    include(chain, chain.sent[0]!, { confirmations: 1 })
    await reconcile()
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'broadcast', confirmations: 1 })
    include(chain, chain.sent[0]!, { confirmations: 3 })
    await reconcile()
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'confirmed', confirmations: 3 })
  })

  it('fails a transfer the chain executed as failed, releases its reservation and allows a retry', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-l')
    await claimed(courier, 'starter')
    include(chain, chain.sent[0]!, { executionResult: false })
    await reconcile()

    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'failed', failure: 'EXECUTION_FAILED', released: true })
    expect((await ledger())?.globalLuna).toBe(0)
    expect((await grantsOf(courier)).milestones.find(item => item.id === 'starter')).toMatchObject({ state: 'failed', blocked: null })

    chain.head += 10
    const retry = await claimed(courier, 'starter')
    expect(chain.sent).toHaveLength(2)
    expect(retry.milestone.txHash).not.toBe(parseSignedTransfer(chain.sent[0]!).hash)
    expect(await recordOf(courier, 'starter')).toMatchObject({ attempt: 2, failedHashes: [parseSignedTransfer(chain.sent[0]!).hash] })
  })

  it('fails a transfer only once its validity window has passed without it on chain', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-m')
    await claimed(courier, 'starter')

    chain.head = START_HEIGHT + TRANSACTION_VALIDITY_WINDOW_BLOCKS
    await reconcile()
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'broadcast' })

    chain.head = START_HEIGHT + TRANSACTION_VALIDITY_WINDOW_BLOCKS + VALIDITY_MARGIN_BLOCKS + 1
    await reconcile()
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'failed', failure: 'NOT_INCLUDED', released: true })
    expect((await ledger())?.open).toEqual([])
  })

  it('never releases a grant whose hash shows a different transfer', async () => {
    const chain = newChain()
    stubChain(chain)
    const courier = await deviceRunner('phone-n')
    await claimed(courier, 'starter')
    include(chain, chain.sent[0]!, { recipient: randomWallet() })
    await reconcile()
    expect(await recordOf(courier, 'starter')).toMatchObject({ state: 'failed', failure: 'CHAIN_MISMATCH', released: false })
    expect((await ledger())?.globalLuna).toBe(ONE_NIM)
    expect((await ledger())?.abuse[0]?.reason).toBe('chain_mismatch')
  })
})

describe('milestones after the starter baton', () => {
  it('count the real handoff that follows, never the grant, and unlock first_handoff', async () => {
    // #given a runner holding a confirmed Starter Baton
    const chain = newChain()
    stubChain(chain)
    const [courier, friend] = [await deviceRunner('phone-o'), await deviceRunner('phone-p')]
    expect((await grantsOf(courier)).milestones.find(item => item.id === 'first_handoff')).toMatchObject({ state: 'locked', blocked: 'requirement_not_met' })
    await claimed(courier, 'starter')
    include(chain, chain.sent[0]!)
    await reconcile()
    const batonId = (await recordOf(courier, 'starter'))?.batonId
    if (!batonId) throw new Error('No starter baton')
    vi.restoreAllMocks()

    // #when they race it and pass it to a friend through a verified transfer
    await passBaton(courier, friend, batonId)

    // #then exactly that handoff counts, and the next milestone opens
    stubChain(chain)
    const snapshot = await call<NetworkSnapshot>(courier.cookie, '/network')
    const detail = await call<BatonDetail>(courier.cookie, `/network/batons/${batonId}`)
    expect(detail.handoffs).toHaveLength(1)
    expect(detail.baton.starterGrant?.kind).toBe('treasury_starter_grant')
    expect(detail.atlas.journey[0]).toMatchObject({ kind: 'treasury_starter_grant', station: 'genesis', toRunner: { handle: courier.p.handle } })
    expect(detail.atlas.journey.filter(entry => entry.kind === 'treasury_starter_grant')).toHaveLength(1)
    expect(detail.baton.transactingWallets).toBe(2)
    expect(snapshot.metrics.qualifiedHandoffs).toBeGreaterThanOrEqual(1)
    expect((await grantsOf(courier)).milestones.find(item => item.id === 'first_handoff')).toMatchObject({ state: 'available' })
    const report = await call<GrantsOpsReport>((await operatorWithDevice()).cookie, '/network/grants/ops')
    expect(report.separation.treasuryGrantTransactions).toBe(1)
  })
})

describe('caps', () => {
  /** Small, deterministic pseudo-random sequence. */
  function sequence(seed: number): () => number {
    let state = seed
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
      return state / 2_147_483_648
    }
  }

  it('are never exceeded under randomized claims, failures and confirmations', async () => {
    const chain = newChain()
    stubChain(chain)
    const caps = { TREASURY_DAILY_CAP_NIM: '6', TREASURY_GLOBAL_CAP_NIM: '8', TREASURY_PARTICIPANT_CAP_NIM: '2', GRANT_AMOUNTS_NIM: 'starter:1,first_handoff:0.25,atlas_explorer:0.25,return_handoff:0.25,social:0.25' }
    const random = sequence(20260917)
    const devices = ['d1', 'd2', 'd3', 'd4']
    const runners: TestRunner[] = []
    for (let index = 0; index < 8; index++) runners.push(await deviceRunner(null))
    const outcomes = new Map<string, number>()

    for (let step = 0; step < 40; step++) {
      const courier = runners[Math.floor(random() * runners.length)]!
      const device = devices[Math.floor(random() * devices.length)]!
      const roll = random()
      if (roll < 0.15 && chain.sent.length > 0) {
        include(chain, chain.sent[Math.floor(random() * chain.sent.length)]!, { executionResult: random() < 0.5 })
        await withDesk(caps, async (desk, loadNetwork) => desk.applyEvidence(await loadNetwork(), await desk.gatherEvidence()))
      } else {
        chain.wallets.set(paymentAddress(courier.p.walletAddress), random() < 0.2 ? 5 * ONE_NIM : 0)
        chain.head += 1
        const outcome = await withDesk(caps, desk => desk.claim({ player: courier.p, deviceHash: `hmac-${device}` }, { grantId: 'starter' }).then(() => 'ok', (error: unknown) => (error instanceof Error ? error.message : 'error')))
        outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1)
      }

      const totals = await runInDurableObject(stationRoom(), async (_instance, state) => {
        const records = [...(await state.storage.list<GrantRecord>({ prefix: `${GRANTS}:record:` })).values()]
        const charges = [...(await state.storage.list<{ chargedLuna: number }>({ prefix: `${GRANTS}:wallet:` })).values(), ...(await state.storage.list<{ chargedLuna: number }>({ prefix: `${GRANTS}:device:` })).values()]
        return { records, charges, ledger: await state.storage.get<GrantLedger>(GRANTS) }
      })
      const holding = totals.records.filter(record => record.state !== 'failed' || !record.released)
      const held = holding.reduce((sum, record) => sum + record.luna, 0)
      expect(held).toBeLessThanOrEqual(8 * ONE_NIM)
      expect(held).toBeLessThanOrEqual(6 * ONE_NIM)
      expect(totals.ledger?.globalLuna ?? 0).toBe(held)
      for (const item of totals.charges) expect(item.chargedLuna).toBeLessThanOrEqual(2 * ONE_NIM)
      const perDevice = new Map<string, number>()
      for (const record of holding) perDevice.set(record.deviceHash, (perDevice.get(record.deviceHash) ?? 0) + 1)
      for (const starters of perDevice.values()) expect(starters).toBeLessThanOrEqual(1)
    }
    expect(outcomes.get('ok')).toBeGreaterThan(0)
    expect(outcomes.get('device_already_claimed')).toBeGreaterThan(0)
  })
})

describe('secrets', () => {
  it('never put the treasury key into a response or a log line', async () => {
    const chain = newChain({ refuseBroadcast: true })
    stubChain(chain)
    const lines: string[] = []
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(arg => (arg instanceof Error ? `${arg.name} ${arg.message} ${arg.stack ?? ''}` : String(arg))).join(' '))
      })
    }
    const [courier, ops] = [await deviceRunner('phone-q'), await operatorWithDevice()]
    const bodies = [
      await (await claim(courier, 'starter')).text(),
      await (await api(courier.cookie, '/network/grants')).text(),
      await (await api(ops.cookie, '/network/grants/ops')).text(),
      await (await SELF.fetch('https://example.com/api/station/network/grants/summary')).text(),
    ]
    chain.failReads = true
    bodies.push(await (await claim(await deviceRunner('phone-r'), 'starter')).text())
    const broken = await withDesk({ TREASURY_PRIVATE_KEY: `${TREASURY_KEY.slice(0, 62)}zz` }, desk => desk.opsReport(ops.p))
    bodies.push(JSON.stringify(broken))
    await reconcile()

    for (const text of [...bodies, ...lines, JSON.stringify(await runInDurableObject(stationRoom(), async (_instance, state) => [...(await state.storage.list({ prefix: GRANTS })).entries()]))]) {
      expect(text).not.toContain(TREASURY_KEY)
      expect(text.toLowerCase()).not.toContain(TREASURY_KEY.slice(0, 40))
    }
    expect(broken.configProblem).toMatch(/TREASURY_PRIVATE_KEY/)
    const summary: GrantsSummary = JSON.parse(bodies[3]!)
    expect(JSON.stringify(summary)).not.toContain(paymentAddress(courier.p.walletAddress))
    expect(JSON.stringify(summary)).not.toContain('hmac-')
  })
})

describe('device signal', () => {
  it('links an HMAC of the Nimiq Pay device identifier to a session that has none', async () => {
    const courier = await deviceRunner(null)
    const linked = await SELF.fetch('https://example.com/api/auth/device', { method: 'POST', headers: { Cookie: courier.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'raw-device-identifier' }) })
    expect(await linked.json()).toEqual({ deviceSignal: true })
    stubChain(newChain())
    expect((await grantsOf(courier)).deviceSignal).toBe(true)
    const extra = await SELF.fetch('https://example.com/api/auth/device', { method: 'POST', headers: { Cookie: courier.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'x', amount: 1 }) })
    expect(extra.status).toBe(400)
  })
})
