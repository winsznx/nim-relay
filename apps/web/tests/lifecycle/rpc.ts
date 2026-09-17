import { RPC_ORIGIN } from './env'

/** A transfer as the mock chain should report it (see scripts/e2e/mock-nimiq-rpc.mjs). */
export interface ChainTransaction {
  hash: string
  sender: string
  recipient: string
  /** Luna. */
  value: number
  data: string
  confirmations: number
  /** Delays every lookup of this transaction, like a slow public RPC. */
  latencyMs?: number
}

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${RPC_ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`mock Nimiq RPC ${path} answered ${response.status}: ${await response.text()}`)
}

/** Control channel of the mock Nimiq RPC node the isolated Worker verifies handoffs against. */
export const mockChain = {
  register: (transaction: ChainTransaction): Promise<void> => post('/__register', transaction),
  confirm: (hash: string, confirmations: number): Promise<void> => post('/__confirm', { hash, confirmations }),
  /** Sets an address's balance in Luna, e.g. to fund the grant treasury. */
  balance: (address: string, luna: number): Promise<void> => post('/__balance', { address, luna }),
  /** Hashes of transfers the Worker broadcast itself, oldest first. */
  async sent(): Promise<string[]> {
    const response = await fetch(`${RPC_ORIGIN}/__sent`)
    const body: unknown = await response.json()
    if (!Array.isArray(body)) throw new Error('mock Nimiq RPC /__sent answered without a list')
    return body.flatMap(entry => (typeof entry === 'object' && entry !== null && typeof Reflect.get(entry, 'hash') === 'string' ? [String(Reflect.get(entry, 'hash'))] : []))
  },
}
