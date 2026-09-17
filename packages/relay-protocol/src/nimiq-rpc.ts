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

/** One entry of an address's transaction history. */
export interface AddressHistoryEntry {
  hash: string
  /** Unix milliseconds of the block that included the transaction. */
  timestamp: number
  /**
   * The transaction as the verifier reads it, or null when it cannot: a history also holds staking and contract
   * transactions whose data runs past the 64 bytes of a basic transfer.
   */
  transaction: NimiqTransaction | null
}

/** The head block a node serves. */
export interface ChainHead {
  blockNumber: number
  /** Unix milliseconds. */
  timestamp: number
  network: string | null
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
    // Called unbound: the Workers runtime throws "Illegal invocation" when fetch runs as a method of this client.
    const fetchImpl = this.fetchImpl
    try {
      const res = await fetchImpl(this.rpcUrl, {
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

  /**
   * The latest transactions `address` sent or received, newest first, continuing before the `startAt` hash when given
   * (`get_transactions_by_address` in core-rs-albatross rpc-interface/src/blockchain.rs). The node reads positional
   * params strictly, so all three are always sent.
   */
  async getTransactionsByAddress(address: string, max: number, startAt: string | null = null): Promise<AddressHistoryEntry[]> {
    const raw = await this.call<unknown>('getTransactionsByAddress', [address, max, startAt])
    if (!Array.isArray(raw)) throw new Error('RPC transaction history invalid')
    return raw.map(historyEntry)
  }

  async getLatestBlock(): Promise<ChainHead> {
    const raw = await this.call<unknown>('getLatestBlock', [false])
    if (!raw || typeof raw !== 'object') throw new Error('RPC block invalid')
    const { number, timestamp, network } = raw as Record<string, unknown>
    if (!isWholeNumber(number) || !isWholeNumber(timestamp)) throw new Error('RPC block head invalid')
    return { blockNumber: number, timestamp, network: typeof network === 'string' ? network : null }
  }
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function historyEntry(raw: unknown): AddressHistoryEntry {
  if (!raw || typeof raw !== 'object') throw new Error('RPC history entry invalid')
  const { hash, timestamp } = raw as Record<string, unknown>
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('RPC history entry hash invalid')
  if (!isWholeNumber(timestamp)) throw new Error('RPC history entry timestamp invalid')
  return { hash: hash.toLowerCase(), timestamp, transaction: readableTransaction(raw, hash) }
}

function readableTransaction(raw: unknown, hash: string): NimiqTransaction | null {
  try {
    return normalizeTransaction(raw, hash)
  } catch {
    return null
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
