import { env, SELF } from 'cloudflare:test'
import { vi } from 'vitest'
import { relayLeg } from '@nim-relay/game-engine'
import { NimiqRpcClient, type NimiqTransaction } from '@nim-relay/relay-protocol'
import type { BatonDetail, IssuedRace, NetworkConfirmation, NetworkHandoffIntent, RaceConfig, RelayLegConfig, RelayLegSample, RelayLegTrace, SubmittedRace } from '@nim-relay/shared'
import { createSessionToken } from '../../auth/session'
import { getAuthStore, type PlayerRecord } from '../../auth/store'
import type { Env } from '../../env'

/** Test helpers for the relay network. Chain lookups go through controlled RPC fixtures, never a real node. */

export interface TestRunner {
  p: PlayerRecord
  cookie: string
}

export async function runner(sessionMs = 7 * 86_400_000): Promise<TestRunner> {
  const store = getAuthStore(undefined)
  const p = await store.createPlayer({ walletAddress: `NQ${crypto.randomUUID().replaceAll('-', '')}`, walletPublicKey: '00'.repeat(32) })
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

export function relayLegConfig(config: RaceConfig): RelayLegConfig {
  if (config.engineVersion !== '5') throw new Error(`Expected a v5 relay leg, got engine ${config.engineVersion}`)
  return config
}

/** Hands-off courier. The engine guarantees it finishes every world and tier. */
export const IDLE_TRACE: RelayLegTrace = [[0, 0, 0]]

const METRE = 65_536
const HAZARD_LOOKAHEAD = 40 * METRE
const FORK_APPROACH = 60 * METRE

/**
 * Small deterministic courier that reads the track like a player: picks a fork side, takes the open side of doors
 * and trains, jumps low hazards and gaps, slides under beams and drones. Its results are always taken from replay.
 */
export function botTrace(raceConfig: RaceConfig, plan: 'safe' | 'risk'): RelayLegTrace {
  const config = relayLegConfig(raceConfig)
  let state = relayLeg.createState(config)
  const trace: RelayLegSample[] = []
  let sampleTick = 0
  while (!state.finished) {
    const input = botInput(state, plan)
    const previous = trace.at(-1)
    if (!previous || previous[1] !== input.steer || input.action !== 0) {
      trace.push([state.tick - sampleTick, input.steer, input.action])
      sampleTick = state.tick
    }
    state = relayLeg.step(state, input)
  }
  return trace
}

/** The bot's trace when it finishes the leg, otherwise the hands-off trace the engine guarantees to finish. */
export function finishingTrace(config: RaceConfig, plan: 'safe' | 'risk'): RelayLegTrace {
  const trace = botTrace(config, plan)
  return relayLeg.replay({ ...relayLegConfig(config), inputTrace: trace }).completed ? trace : IDLE_TRACE
}

function botInput(state: relayLeg.State, plan: 'safe' | 'risk'): relayLeg.Input {
  const { track } = state
  const halfWidth = relayLeg.halfWidthAt(track, state.dist, state.path)
  const speed = Math.max(state.speed, 1)
  let target = 0
  let action: 0 | 1 | 2 = 0
  const { fork } = track
  if (state.path === 'main' && state.dist < fork.from && fork.from - state.dist < FORK_APPROACH) {
    target = (plan === 'risk' ? fork.riskSide : -fork.riskSide) * Math.trunc(halfWidth / 2)
  }
  for (let index = state.hazardIdx; index < track.hazards.length; index++) {
    const hazard = track.hazards[index]!
    if (hazard.dist - state.dist > HAZARD_LOOKAHEAD) break
    const plannedPath = state.path === 'main' ? plan : state.path
    if (hazard.kind === 'gust' || hazard.path !== relayLeg.activePathAt(track, hazard.dist, plannedPath)) continue
    const ticks = Math.trunc((hazard.dist - state.dist) / speed)
    const arrival = state.tick + ticks
    if (hazard.kind === 'door') target = hazard.x + relayLeg.doorOpenSide(hazard, arrival) * Math.trunc(halfWidth / 2)
    else if (hazard.kind === 'train') target = hazard.x - relayLeg.trainBlockedSide(hazard, arrival) * Math.trunc(halfWidth / 2)
    else if ((hazard.kind === 'beam' || hazard.kind === 'drone') && ticks <= 20) action = 2
    else if ((hazard.kind === 'barrier' || hazard.kind === 'sweeper') && ticks <= 18 && ticks >= 8) action = 1
    break
  }
  const nextGap = track.gaps.find(gap => gap.from > state.dist)
  if (nextGap && Math.trunc((nextGap.from - state.dist) / speed) <= 3) action = 1
  const grounded = state.y === 0 && state.vy === 0
  return { steer: Math.max(-64, Math.min(64, Math.trunc(target * 64 / halfWidth))), action: grounded ? action : 0 }
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
  trace: RelayLegTrace
}

export async function raceLeg(courier: TestRunner, batonId: string, chooseTrace: (issued: IssuedRace) => RelayLegTrace = () => IDLE_TRACE): Promise<RacedLeg> {
  const issued = await call<IssuedRace>(courier.cookie, '/network/issue', { batonId })
  const trace = chooseTrace(issued)
  const submitted = await call<SubmittedRace>(courier.cookie, '/submit', { issued, inputTrace: trace })
  return { issued, submitted, trace }
}

export async function prepareAndAttempt(from: TestRunner, to: TestRunner, runId: string): Promise<NetworkHandoffIntent> {
  const intent = await call<NetworkHandoffIntent>(from.cookie, '/network/handoff/prepare', { runId, recipient: to.p.id })
  return call<NetworkHandoffIntent>(from.cookie, '/network/handoff/attempt', { id: intent.id })
}

export interface Pass extends RacedLeg {
  intent: NetworkHandoffIntent
  confirmation: NetworkConfirmation
  txHash: string
}

/** Races the holder's leg and moves the baton to `to` through a verified controlled transfer. */
export async function passBaton(from: TestRunner, to: TestRunner, batonId: string, chooseTrace?: (issued: IssuedRace) => RelayLegTrace): Promise<Pass> {
  const leg = await raceLeg(from, batonId, chooseTrace)
  const intent = await prepareAndAttempt(from, to, leg.issued.runId)
  const txHash = randomTxHash()
  const confirmation = await confirmWith(from, intent, txHash, chainTransfer(intent, txHash))
  if (confirmation.status !== 'verified') throw new Error(`Handoff did not verify: ${confirmation.reason ?? 'unknown'}`)
  return { ...leg, intent, confirmation, txHash }
}

export function createBaton(courier: TestRunner, body: Record<string, unknown>): Promise<BatonDetail> {
  return call<BatonDetail>(courier.cookie, '/network/create', body)
}

export function stationRoom(): DurableObjectStub {
  if (!('STATION_ROOM' in env) || !isNamespace(env.STATION_ROOM)) throw new Error('STATION_ROOM binding missing')
  return env.STATION_ROOM.get(env.STATION_ROOM.idFromName('global-v4'))
}

function isNamespace(value: unknown): value is DurableObjectNamespace {
  return typeof value === 'object' && value !== null && 'idFromName' in value && 'get' in value
}
