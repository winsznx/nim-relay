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
}
