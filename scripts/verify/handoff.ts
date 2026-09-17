/**
 * Independent check of one real baton handoff, for evidence and support.
 *
 * Reads the transaction from the public Nimiq RPC, decodes the NR1 relay
 * commitment, compares it with the relay's canonical journey on the deployed
 * Worker, and (when service credentials are in .env) reads the archived
 * handoff row back from Supabase.
 *
 * Usage:
 *   pnpm verify:handoff --network testnet --tx <hash> [--baton <code>]
 *   pnpm verify:handoff --network mainnet --tx <hash> [--baton <code>]
 */
import { readFileSync } from 'node:fs'
import { decodeTxData, NimiqRpcClient, NIMIQ_RPC_ENDPOINTS, paymentAddress, TransactionNotFoundError, type NimiqNetwork } from '@nim-relay/relay-protocol'

interface Options {
  network: NimiqNetwork
  txHash: string
  batonCode: string | null
}

interface Handoff {
  leg: number
  txHash: string
  from: { name: string; wallet: string }
  to: { name: string; wallet: string }
  value: number
  confirmations: number
  blockNumber: number
}

interface BatonDetail {
  baton: { code: string; title: string; handoffCount: number; holder: { name: string; wallet: string }; status: string; network: string }
  handoffs: Handoff[]
}

const WORKERS: Record<NimiqNetwork, string> = {
  TestAlbatross: 'https://testnet.nimrelay.xyz',
  MainAlbatross: 'https://nimrelay.xyz',
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    return index >= 0 ? (argv[index + 1] ?? null) : null
  }
  const network = value('--network') === 'mainnet' ? 'MainAlbatross' : 'TestAlbatross'
  const txHash = (value('--tx') ?? '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(txHash)) throw new Error('Pass --tx with a 64-character transaction hash')
  return { network, txHash, batonCode: value('--baton') }
}

function readEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .filter(line => line.includes('=') && !line.trimStart().startsWith('#'))
        .map(line => {
          const index = line.indexOf('=')
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')]
        }),
    )
  } catch {
    return {}
  }
}

function line(label: string, value: string | number | boolean | null): void {
  console.log(`${label.padEnd(26)} ${value}`)
}

async function checkChain(options: Options) {
  const client = new NimiqRpcClient({ rpcUrl: NIMIQ_RPC_ENDPOINTS[options.network] })
  try {
    const tx = await client.getTransactionByHash(options.txHash)
    const commitment = tx.data ? decodeTxData(tx.data) : null
    console.log('\nChain')
    line('network (reported)', tx.network)
    line('sender', paymentAddress(tx.sender))
    line('recipient', paymentAddress(tx.recipient))
    line('value (Luna)', tx.value)
    line('block', tx.blockNumber)
    line('confirmations', tx.confirmations)
    line('executed', tx.executionResult)
    line('relay code', commitment?.relayCode ?? 'not an NR1 relay transfer')
    line('leg', commitment?.legNumber ?? null)
    return { tx, commitment }
  } catch (error) {
    if (error instanceof TransactionNotFoundError) {
      console.log('\nChain: transaction not found on', options.network)
      return null
    }
    throw error
  }
}

async function checkJourney(options: Options, relayCode: string | null): Promise<BatonDetail | null> {
  const code = options.batonCode ?? relayCode
  if (!code) return null
  const response = await fetch(`${WORKERS[options.network]}/api/station/network/batons/${encodeURIComponent(code)}`)
  console.log('\nRelay journey')
  if (!response.ok) {
    line('lookup', `${response.status} ${await response.text()}`)
    return null
  }
  const detail = (await response.json()) as BatonDetail
  const handoff = detail.handoffs.find(entry => entry.txHash === options.txHash)
  line('baton', `${detail.baton.title} (${detail.baton.code})`)
  line('status', detail.baton.status)
  line('handoffs', detail.baton.handoffCount)
  line('current holder', `${detail.baton.holder.name} ${detail.baton.holder.wallet}`)
  line('tx in canonical lineage', Boolean(handoff))
  if (handoff) {
    line('lineage leg', handoff.leg)
    line('from → to', `${handoff.from.name} → ${handoff.to.name}`)
  }
  return detail
}

async function checkArchive(options: Options): Promise<void> {
  const env = readEnv()
  console.log('\nSupabase archive')
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    line('readback', 'skipped (no service credentials in .env)')
    return
  }
  const url = `${env.SUPABASE_URL}/rest/v1/relay_network_handoffs?network=eq.${options.network}&tx_hash=eq.${options.txHash}&select=id,leg,baton_id`
  const response = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } })
  if (!response.ok) {
    line('readback', `${response.status} ${await response.text()}`)
    return
  }
  const rows = (await response.json()) as { id: string; leg: number; baton_id: string }[]
  line('archived rows', rows.length)
  for (const row of rows) line('archived leg', `${row.leg} baton ${row.baton_id}`)
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  line('checking', `${options.txHash} on ${options.network}`)
  const chain = await checkChain(options)
  await checkJourney(options, chain?.commitment?.relayCode ?? null)
  await checkArchive(options)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
