import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { BrowserContext } from '@playwright/test'
import { bytesToHex, deriveNimiqAddress, hexToBytes, nimiqPublicKeyFromPrivate, paymentAddress, signNimiqSignedMessage } from '@nim-relay/relay-protocol'
import { mockChain } from './rpc'

/**
 * A Nimiq Pay host for the browser E2E. The page gets the real SDK provider class
 * (`@nimiq/mini-app-sdk/provider`) with its adapter wired to a Playwright binding,
 * so the app talks to the same transport it uses inside Nimiq Pay. The Node side
 * signs with a test ed25519 key and "broadcasts" transfers to the mock RPC node.
 */

export interface RunnerKey {
  name: string
  /** Test-only ed25519 seed. It never holds funds on any network. */
  seedHex: string
}

export const TIM: RunnerKey = { name: 'Tim', seedHex: '45b9c6d7c241ce9c7ab653681d9485b5fd4420a4720893f5e8c1c8ee7c9b0128' }
export const MARIANA: RunnerKey = { name: 'Mariana', seedHex: 'ed5800c325124529612de78b167f2f4a351ad4d7e2042232921c9ea9dec4a100' }
/** A runner who first signs in during the Relay Grants scenario, so no earlier scenario has given them a baton. */
export const NOOR: RunnerKey = { name: 'Noor', seedHex: '8a1f3c5e7b9d2f4a6c8e0b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f21' }
/** A wallet no runner in the test signs in with, for transfers that reach the wrong recipient. */
const STRANGER_SEED = '49d62ef6db86d3fe880ffa75b67c1cd90ac04b7beaefca5bc894f07b808d51a9'

export interface WalletIdentity {
  publicKeyHex: string
  /** User-friendly address without spaces, as the Worker writes it into intents. */
  address: string
}

async function walletIdentity(seedHex: string): Promise<WalletIdentity> {
  const publicKeyHex = await nimiqPublicKeyFromPrivate(seedHex)
  return { publicKeyHex, address: paymentAddress(bytesToHex(deriveNimiqAddress(hexToBytes(publicKeyHex)))) }
}

const strangerAddress = async (): Promise<string> => (await walletIdentity(STRANGER_SEED)).address

/** "NQ07 0000 …", the grouping Nimiq Pay shows and returns. */
function spacedAddress(address: string): string {
  return address.match(/.{1,4}/g)?.join(' ') ?? address
}

/** How Nimiq Pay answers one transfer request. */
export type WalletOutcome =
  /** The runner approves after `approvalMs`; the transfer lands with `confirmations` and answers lookups after `rpcLatencyMs`. */
  | { kind: 'approve'; confirmations?: number; approvalMs?: number; rpcLatencyMs?: number }
  | { kind: 'decline' }
  | { kind: 'insufficient-balance' }
  /** The transfer is broadcast, but Nimiq Pay reports a timeout instead of its hash. */
  | { kind: 'timeout' }
  /** A transfer with the requested value and data is broadcast to another wallet. */
  | { kind: 'wrong-recipient' }

export interface TransferRequest {
  recipient: string
  value: number
  data: string
}

export interface WalletTransfer extends TransferRequest {
  outcome: WalletOutcome['kind']
  /** Hash of the broadcast transaction; null when nothing was broadcast. */
  hash: string | null
}

const HOST_BINDING = '__nimiqPayHost'
const DEFAULT_CONFIRMATIONS = 2
const PROVIDER_SOURCE = readFileSync(createRequire(import.meta.url).resolve('@nimiq/mini-app-sdk/provider'), 'utf8')

/** Runs before the app: the SDK's provider (CommonJS build) with a promise adapter bound to the Node host. */
const hostScript = `(() => {
  const module = { exports: {} };
  (function (module, exports) {
${PROVIDER_SOURCE}
  })(module, module.exports);
  const ask = (method, params) => window.${HOST_BINDING}({ method, params: params ?? null });
  const provider = new module.exports.NimiqProvider();
  provider.setAdapter({ getStrategy: () => 'PROMISES', request: args => ask(args.method, args.params) });
  window.nimiq = provider;
  window.nimiqPay = { language: 'en', requestDeviceIdentifier: options => ask('requestDeviceIdentifier', options) };
})();`

const walletError = (type: string, message: string) => ({ error: { type, message } })
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function param(params: unknown, key: string): unknown {
  return typeof params === 'object' && params !== null ? Reflect.get(params, key) : undefined
}

function stringParam(params: unknown, key: string): string {
  const value = param(params, key)
  if (typeof value !== 'string') throw new Error(`Nimiq Pay mock expected "${key}" to be a string, got ${JSON.stringify(value)}`)
  return value
}

function numberParam(params: unknown, key: string): number {
  const value = param(params, key)
  if (typeof value !== 'number') throw new Error(`Nimiq Pay mock expected "${key}" to be a number, got ${JSON.stringify(value)}`)
  return value
}

function randomHash(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export class MockNimiqPay {
  readonly transfers: WalletTransfer[] = []
  readonly signedMessages: string[] = []
  private readonly outcomes: WalletOutcome[] = []

  private constructor(
    readonly key: RunnerKey,
    readonly identity: WalletIdentity,
  ) {}

  static async create(key: RunnerKey): Promise<MockNimiqPay> {
    return new MockNimiqPay(key, await walletIdentity(key.seedHex))
  }

  /** Queues answers for the next transfer requests, in order. Requests beyond the queue are approved. */
  answerTransfers(...outcomes: WalletOutcome[]): void {
    this.outcomes.push(...outcomes)
  }

  lastTransfer(): WalletTransfer {
    const transfer = this.transfers.at(-1)
    if (!transfer) throw new Error(`${this.key.name}'s wallet has not been asked for a transfer`)
    return transfer
  }

  async install(context: BrowserContext): Promise<void> {
    await context.exposeBinding(HOST_BINDING, (_source, request: unknown) => this.answer(request))
    await context.addInitScript({ content: hostScript })
  }

  private async answer(request: unknown): Promise<unknown> {
    const method = param(request, 'method')
    const params = param(request, 'params')
    switch (method) {
      case 'listAccounts':
        return [spacedAddress(this.identity.address)]
      case 'sign': {
        const message = stringParam(params, 'message')
        this.signedMessages.push(message)
        return { publicKey: this.identity.publicKeyHex, signature: await signNimiqSignedMessage({ message, privateKeyHex: this.key.seedHex }) }
      }
      case 'requestDeviceIdentifier':
        return sha256Hex(`nim-relay-e2e-device:${this.key.name}`)
      case 'sendBasicTransactionWithData':
        return this.transfer({ recipient: stringParam(params, 'recipient'), value: numberParam(params, 'value'), data: stringParam(params, 'data') })
      default:
        return walletError('UnsupportedMethodError', `${String(method)} is not available in the test wallet`)
    }
  }

  private async transfer(request: TransferRequest): Promise<unknown> {
    const outcome = this.outcomes.shift() ?? { kind: 'approve' }
    const record: WalletTransfer = { ...request, outcome: outcome.kind, hash: null }
    this.transfers.push(record)
    switch (outcome.kind) {
      case 'decline':
        return walletError('PermissionDeniedError', 'User rejected')
      case 'insufficient-balance':
        return walletError('InsufficientBalanceError', 'Insufficient balance for this transaction')
      case 'approve':
        await wait(outcome.approvalMs ?? 0)
        record.hash = await this.broadcast(request, request.recipient, outcome.confirmations ?? DEFAULT_CONFIRMATIONS, outcome.rpcLatencyMs ?? 0)
        return record.hash
      case 'timeout':
        record.hash = await this.broadcast(request, request.recipient, DEFAULT_CONFIRMATIONS, 0)
        return walletError('TimeoutError', 'Request timed out')
      case 'wrong-recipient':
        record.hash = await this.broadcast(request, await strangerAddress(), DEFAULT_CONFIRMATIONS, 0)
        return record.hash
    }
  }

  private async broadcast(request: TransferRequest, recipient: string, confirmations: number, latencyMs: number): Promise<string> {
    const hash = randomHash()
    await mockChain.register({ hash, sender: spacedAddress(this.identity.address), recipient, value: request.value, data: request.data, confirmations, latencyMs })
    return hash
  }
}
