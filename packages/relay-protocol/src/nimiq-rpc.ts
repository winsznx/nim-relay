/**
 * Minimal first-party Nimiq JSON-RPC client, scoped to exactly the methods
 * NIM Relay's backend transaction verifier needs. Deliberately not a
 * general-purpose RPC wrapper and deliberately not the official
 * `@nimiq/core` Web Client - see DECISIONS.md D-001 for why: `@nimiq/core`
 * is a WASM P2P light client that fails to instantiate inside Cloudflare's
 * `workerd` runtime (confirmed empirically). This client is plain
 * `fetch()`-based JSON-RPC over HTTPS, which needs nothing special to run
 * in a Worker.
 *
 * Endpoints confirmed by network via live block-height cross-referencing
 * against nimiq.watch's explorer API - see DECISIONS.md D-006.
 */

export const NIMIQ_RPC_ENDPOINTS = {
  MainAlbatross: 'https://rpc.nimiqwatch.com',
  TestAlbatross: 'https://rpc.testnet.nimiqwatch.com/',
} as const

export type NimiqNetwork = keyof typeof NIMIQ_RPC_ENDPOINTS

export interface NimiqTransaction {
  hash: string
  sender: string
  recipient: string
  /** Luna, as returned by the node - kept as a string to avoid float/number precision loss, parsed to bigint by the caller. */
  value: string
  data: string | null
  network: string | null
  blockNumber: number | null
  confirmations: number | null
  executionResult: boolean | null
}

class NimiqRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly data: unknown,
  ) {
    super(message)
    this.name = 'NimiqRpcError'
  }
}

export class TransactionNotFoundError extends Error {
  constructor(readonly hash: string) {
    super(`Transaction not found: ${hash}`)
    this.name = 'TransactionNotFoundError'
  }
}

interface RpcClientOptions {
  rpcUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class NimiqRpcClient {
  private readonly rpcUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: RpcClientOptions) {
    this.rpcUrl = options.rpcUrl
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 8000
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new NimiqRpcError(`RPC HTTP ${res.status}`, null, null)
      }
      const json = (await res.json()) as {
        result?: { data: T; metadata: unknown }
        error?: { code: number; message: string; data?: unknown }
      }
      if (json.error) {
        if (typeof json.error.data === 'string' && json.error.data.startsWith('Transaction not found')) {
          throw json.error
        }
        throw new NimiqRpcError(json.error.message, json.error.code, json.error.data)
      }
      if (!json.result) {
        throw new NimiqRpcError('RPC response missing result', null, json)
      }
      return json.result.data
    } finally {
      clearTimeout(timer)
    }
  }

  async getBlockNumber(): Promise<number> {
    return this.call<number>('getBlockNumber', [])
  }

  /** Throws TransactionNotFoundError if the hash doesn't exist on this chain - callers must not treat "not found" as a network error. */
  async getTransactionByHash(hash: string): Promise<NimiqTransaction> {
    try {
      const raw = await this.call<unknown>('getTransactionByHash', [hash])
      return normalizeTransaction(raw, hash)
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'data' in err &&
        typeof (err as { data?: unknown }).data === 'string' &&
        (err as { data: string }).data.startsWith('Transaction not found')
      ) {
        throw new TransactionNotFoundError(hash)
      }
      throw err
    }
  }
}

export function createNimiqRpcClient(network: NimiqNetwork, options?: Partial<RpcClientOptions>): NimiqRpcClient {
  return new NimiqRpcClient({ rpcUrl: NIMIQ_RPC_ENDPOINTS[network], ...options })
}

/** Normalize documented Albatross RPC fields without guessing missing chain evidence. */
export function normalizeTransaction(raw: unknown, expectedHash: string): NimiqTransaction {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid transaction response')
  const value = raw as Record<string, unknown>
  if (typeof value.hash !== 'string' || value.hash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('RPC transaction hash mismatch')
  const sender = value.sender ?? value.from, recipient = value.recipient ?? value.to
  if (typeof sender !== 'string' || typeof recipient !== 'string') throw new Error('RPC transaction addresses missing')
  let amount: string
  if (typeof value.value === 'string' && /^\d+$/.test(value.value)) amount = value.value
  else if (typeof value.value === 'number' && Number.isSafeInteger(value.value) && value.value >= 0) amount = String(value.value)
  else throw new Error('RPC transaction amount invalid')
  let data: string | null = typeof value.data === 'string' ? value.data : null
  if (typeof value.recipientData === 'string') {
    const encoded = value.recipientData
    if (!/^(?:[a-f0-9]{2})*$/i.test(encoded) || encoded.length > 128) throw new Error('RPC transaction data invalid')
    data = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(encoded.match(/../g) ?? [], byte => Number.parseInt(byte, 16)))
  }
  const network = value.networkId === 5 ? 'TestAlbatross' : value.networkId === 24 ? 'MainAlbatross' : typeof value.network === 'string' ? value.network : null
  const blockNumber = typeof value.blockNumber === 'number' && Number.isSafeInteger(value.blockNumber) && value.blockNumber >= 0 ? value.blockNumber : null
  const confirmations = typeof value.confirmations === 'number' && Number.isSafeInteger(value.confirmations) && value.confirmations >= 0 ? value.confirmations : null
  return { hash: value.hash.toLowerCase(), sender, recipient, value: amount, data, network, blockNumber, confirmations, executionResult: typeof value.executionResult === 'boolean' ? value.executionResult : null }
}
