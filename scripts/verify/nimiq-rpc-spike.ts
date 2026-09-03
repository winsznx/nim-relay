/**
 * Phase 2 "backend transaction lookup spike" (PRD section 51, Phase 2).
 * Live network check against both confirmed Nimiq RPC endpoints
 * (DECISIONS.md D-006) - not part of the CI test suite (needs real network
 * access to a best-effort community RPC), run manually and archived as
 * evidence.
 *
 * Usage: pnpm tsx scripts/verify/nimiq-rpc-spike.ts
 */
import { createNimiqRpcClient, TransactionNotFoundError } from '@nim-relay/relay-protocol'

async function check(network: 'TestAlbatross' | 'MainAlbatross') {
  const client = createNimiqRpcClient(network)
  const blockNumber = await client.getBlockNumber()
  console.log(`[${network}] getBlockNumber -> ${blockNumber}`)

  const fakeHash = '0'.repeat(64)
  try {
    await client.getTransactionByHash(fakeHash)
    console.log(`[${network}] UNEXPECTED: fake hash resolved to a transaction`)
  } catch (err) {
    if (err instanceof TransactionNotFoundError) {
      console.log(`[${network}] getTransactionByHash(fakeHash) -> TransactionNotFoundError (expected)`)
    } else {
      throw err
    }
  }
}

await check('TestAlbatross')
await check('MainAlbatross')
console.log('NIMIQ_RPC_SPIKE_PASS')
