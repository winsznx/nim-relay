import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { vi } from 'vitest'
import { NimiqRpcClient, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { BatonDetail, IssuedRace, NetworkBaton, NetworkConfirmation, NetworkHandoffIntent, RelayLegV5Trace, RelayLegV6Trace, SubmittedRace } from '@nim-relay/shared'
import { createSessionToken } from '../../auth/session'
import { getAuthStore, type PlayerRecord } from '../../auth/store'
import type { Env } from '../../env'
import { mac, signedFields } from '../signing'
import { finishingTrace } from './test-courier'

export { failingTrace, finishingTrace, v6Config } from './test-courier'

/** Test helpers for the relay network. Chain lookups go through controlled RPC fixtures, never a real node. */

export interface TestRunner {
  p: PlayerRecord
  cookie: string
}

export function runner(sessionMs = 7 * 86_400_000): Promise<TestRunner> {
  return signedIn(`NQ${crypto.randomUUID().replaceAll('-', '')}`, sessionMs)
}

/** The handle OPS_PLAYERS lists in vitest.config.ts. No random hex wallet can end in these characters. */
export const TEST_OPERATOR_HANDLE = 'runner-0ps0ps'
/** RUN_CHALLENGE_SECRET in vitest.config.ts. */
export const TEST_RUN_CHALLENGE_SECRET = 'test-run-challenge-secret'

/** The operator: the in-memory store names a runner after the last six characters of their wallet. */
export function operator(): Promise<TestRunner> {
  return signedIn('NQ00TESTOPERATOR0PS0PS', 7 * 86_400_000)
}

async function signedIn(walletAddress: string, sessionMs: number): Promise<TestRunner> {
  const store = getAuthStore(undefined)
  const p = await store.createPlayer({ walletAddress, walletPublicKey: '00'.repeat(32) })
  const session = await store.createSession({ playerId: p.id, deviceHash: null, expiresAt: Date.now() + sessionMs })
  const token = await createSessionToken({ SESSION_SECRET: 'test-session-secret' } as Env, { sessionId: session.id, playerId: p.id })
  return { p, cookie: `nr_session=${token}` }
}

/** `country` stands in for the network-observed country Cloudflare attaches to real requests. */
export function api(cookie: string, path = '', body?: unknown, country?: string): Promise<Response> {
  const init: RequestInit = { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  if (country) init.cf = { country }
  return SELF.fetch(`https://example.com/api/station${path}`, init)
}

export async function call<T>(cookie: string, path: string, body?: unknown, country?: string): Promise<T> {
  const response = await api(cookie, path, body, country)
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

export async function joinNetwork(...runners: TestRunner[]): Promise<void> {
  for (const courier of runners) await call(courier.cookie, '/network')
}

/** Hands-off v6 courier: a valid trace that proves nothing about finishing. */
export const IDLE_TRACE: RelayLegV6Trace = [[0, 0, 0, 0]]
/** Hands-off v5 courier. The frozen v5 engine guarantees it finishes every world and tier. */
export const V5_IDLE_TRACE: RelayLegV5Trace = [[0, 0, 0]]

/**
 * `trace` with one more idle sample 30 ticks after `endTick`, the tick its race ended on. The trace still validates on
 * its own, since every sample starts inside MAX_TICKS, but no replay reaches that sample.
 */
export function withLateSample(trace: readonly (readonly number[])[], endTick: number): number[][] {
  const lastSampleTick = trace.reduce((tick, [ticks = 0]) => tick + ticks, 0)
  const idle = new Array<number>(Math.max(0, (trace[0]?.length ?? 1) - 1)).fill(0)
  return [...trace.map(sample => [...sample]), [endTick + 30 - lastSampleTick, ...idle]]
}

export function randomTxHash(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** The chain's view of a transfer that satisfies `intent`, with `overrides` for the fields under test. */
export function chainTransfer(intent: NetworkHandoffIntent, hash: string, overrides: Partial<NimiqTransaction> = {}): NimiqTransaction {
  return { hash, sender: intent.sender, recipient: intent.recipient, value: String(intent.value), data: intent.data, network: 'TestAlbatross', blockNumber: 100, confirmations: 2, executionResult: true, ...overrides }
}

export async function confirmWith(courier: TestRunner, intent: NetworkHandoffIntent, hash: string, transaction: NimiqTransaction | Error): Promise<NetworkConfirmation> {
  const lookup = vi.spyOn(NimiqRpcClient.prototype, 'getTransactionByHash')
  try {
    if (transaction instanceof Error) lookup.mockRejectedValue(transaction)
    else lookup.mockResolvedValue(transaction)
    return await call<NetworkConfirmation>(courier.cookie, '/network/handoff/confirm', { id: intent.id, txHash: hash })
  } finally {
    lookup.mockRestore()
  }
}

export interface RacedLeg {
  issued: IssuedRace
  submitted: SubmittedRace
  trace: RelayLegV6Trace
}

/** Issues and submits the holder's leg, by default with the finishing bot. */
export async function raceLeg(courier: TestRunner, batonId: string, chooseTrace: (issued: IssuedRace) => RelayLegV6Trace = issued => finishingTrace(issued.config)): Promise<RacedLeg> {
  const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId })
  const trace = chooseTrace(issued)
  const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: trace })
  return { issued, submitted, trace }
}

/** Prepares and attempts a pass. Without `routeId` the server picks the next Atlas route. */
export async function prepareAndAttempt(from: TestRunner, to: TestRunner, runId: string, routeId?: string): Promise<NetworkHandoffIntent> {
  const intent = await call<NetworkHandoffIntent>(from.cookie, '/network/handoff/prepare', { runId, recipient: to.p.id, ...(routeId ? { routeId } : {}) })
  return call<NetworkHandoffIntent>(from.cookie, '/network/handoff/attempt', { id: intent.id })
}

export interface Pass extends RacedLeg {
  intent: NetworkHandoffIntent
  confirmation: NetworkConfirmation
  txHash: string
}

/**
 * Races the holder's leg and moves the baton to `to` through a verified controlled transfer. `route` 'same' sends the
 * next leg along the route just raced, so the next runner chases this leg's ghost; by default the server picks the route.
 */
export async function passBaton(from: TestRunner, to: TestRunner, batonId: string, chooseTrace?: (issued: IssuedRace) => RelayLegV6Trace, route?: 'same' | { routeId: string }): Promise<Pass> {
  const leg = await raceLeg(from, batonId, chooseTrace)
  const routeId = route === 'same' ? leg.issued.atlas?.routeId : route?.routeId
  const intent = await prepareAndAttempt(from, to, leg.issued.runId, routeId)
  const txHash = randomTxHash()
  const confirmation = await confirmWith(from, intent, txHash, chainTransfer(intent, txHash))
  if (confirmation.status !== 'verified') throw new Error(`Handoff did not verify: ${confirmation.reason ?? 'unknown'}`)
  return { ...leg, intent, confirmation, txHash }
}

export function createBaton(courier: TestRunner, body: Record<string, unknown>): Promise<BatonDetail> {
  return call<BatonDetail>(courier.cookie, '/network/create', body)
}

/**
 * The holder's leg ticket for `baton` as the network signed v5 legs before v6, stored where issuance keeps tickets.
 * The network only issues v6 now, so a historic ticket can only be planted.
 */
export async function plantV5Leg(courier: TestRunner, baton: Pick<NetworkBaton, 'id' | 'mode' | 'route' | 'handoffCount'>): Promise<IssuedRace> {
  const { seed, world, tier } = baton.route
  const issued: IssuedRace = {
    networkRace: true,
    practice: false,
    batonId: baton.id,
    relayLeg: baton.handoffCount,
    runId: crypto.randomUUID(),
    playerId: courier.p.id,
    mode: baton.mode,
    config: { engineVersion: '5', challenge: 'relay-leg', challengeVersion: '5', seed, world, tier, openingFlow: 0 },
    expiresAt: Date.now() + 10 * 60_000,
    target: null,
    mac: '',
    ghost: null,
  }
  issued.mac = await mac(TEST_RUN_CHALLENGE_SECRET, signedFields(issued))
  await runInDurableObject(stationRoom(), (_instance, state) => state.storage.put(`issue:${issued.runId}`, issued))
  return issued
}

export function stationRoom(): DurableObjectStub {
  if (!('STATION_ROOM' in env) || !isNamespace(env.STATION_ROOM)) throw new Error('STATION_ROOM binding missing')
  return env.STATION_ROOM.get(env.STATION_ROOM.idFromName('global-v4'))
}

function isNamespace(value: unknown): value is DurableObjectNamespace {
  return typeof value === 'object' && value !== null && 'idFromName' in value && 'get' in value
}
