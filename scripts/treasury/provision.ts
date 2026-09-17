/**
 * Creates a fresh Relay Grants treasury wallet and stores its key as the Worker secret TREASURY_PRIVATE_KEY.
 *
 *   pnpm exec tsx scripts/treasury/provision.ts --network testnet
 *   pnpm exec tsx scripts/treasury/provision.ts --network mainnet
 *   pnpm exec tsx scripts/treasury/provision.ts --network testnet --dry-run   # no secret written, key discarded
 *
 * The key goes from memory straight into `wrangler secret put` over stdin. It is never written to disk, printed,
 * logged or passed as an argument. Only the public address is printed: fund it with a small amount (docs/grants.md),
 * then set TREASURY_ENABLED to "true" for that Worker. Running it again replaces the key, so move any remaining NIM
 * out of the old treasury first.
 */
import { spawn } from 'node:child_process'
import { bytesToHex, nimiqAddressFromPrivateKey } from '@nim-relay/relay-protocol'

type Network = 'testnet' | 'mainnet'

function parseArgs(argv: readonly string[]): { network: Network; dryRun: boolean } {
  const index = argv.indexOf('--network')
  const network = index >= 0 ? argv[index + 1] : undefined
  if (network !== 'testnet' && network !== 'mainnet') throw new Error('Pass --network testnet or --network mainnet')
  return { network, dryRun: argv.includes('--dry-run') }
}

function putSecret(network: Network, privateKeyHex: string): Promise<void> {
  const args = ['--filter', '@nim-relay/worker', 'exec', 'wrangler', 'secret', 'put', 'TREASURY_PRIVATE_KEY', ...(network === 'testnet' ? ['--env', 'testnet'] : [])]
  return new Promise((resolve, reject) => {
    // wrangler's own output never contains the secret; stdin carries it.
    const child = spawn('pnpm', args, { stdio: ['pipe', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`wrangler secret put exited with ${code ?? 'a signal'}`))))
    child.stdin.end(privateKeyHex)
  })
}

async function main(): Promise<void> {
  const { network, dryRun } = parseArgs(process.argv.slice(2))
  const privateKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
  const address = await nimiqAddressFromPrivateKey(privateKeyHex)
  if (!dryRun) await putSecret(network, privateKeyHex)
  console.log(`${dryRun ? 'Dry run, no secret written. ' : ''}Treasury address (${network}): ${address}`)
}

main().catch((error: unknown) => {
  // Errors here come from argument parsing or wrangler, neither of which holds the key.
  console.error(error instanceof Error ? error.message : 'Provisioning failed')
  process.exitCode = 1
})
