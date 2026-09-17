/**
 * Prints the @nimiq/core transfer vectors pinned in packages/relay-protocol/src/nimiq-transaction.test.ts.
 * @nimiq/core is deliberately not a workspace dependency (its WASM never ships in the Worker), so run it from a scratch
 * directory:
 *
 *   mkdir /tmp/nimiq-vectors && cd /tmp/nimiq-vectors && npm init -y && npm i @nimiq/core@2.21.0
 *   cp <repo>/scripts/treasury/transaction-vectors.mjs . && node transaction-vectors.mjs
 */
import { Address, KeyPair, PrivateKey, TransactionBuilder } from '@nimiq/core'

const NETWORK_IDS = { TestAlbatross: 5, MainAlbatross: 24 }
const cases = [
  { privateKeyHex: '11'.repeat(32), recipient: '00'.repeat(20), value: 100000n, fee: 0n, height: 1234, network: 'TestAlbatross', data: null },
  { privateKeyHex: 'aabbccddeeff00112233445566778899'.repeat(2), recipient: '0123456789abcdef0123456789abcdef01234567', value: 150000n, fee: 138n, height: 4294967295, network: 'MainAlbatross', data: 'NIM Relay starter grant' },
  { privateKeyHex: '9f8e7d6c5b4a39281706f5e4d3c2b1a0'.repeat(2), recipient: '0123456789abcdef0123456789abcdef01234567', value: 1n, fee: 0n, height: 0, network: 'TestAlbatross', data: 'NRG1.starter' },
]

const hex = bytes => Buffer.from(bytes).toString('hex')
const vectors = cases.map(item => {
  const keyPair = KeyPair.derive(PrivateKey.fromHex(item.privateKeyHex))
  const sender = keyPair.toAddress()
  const recipient = new Address(Buffer.from(item.recipient, 'hex'))
  const networkId = NETWORK_IDS[item.network]
  const transaction = item.data
    ? TransactionBuilder.newBasicWithData(sender, recipient, new TextEncoder().encode(item.data), item.value, item.fee, item.height, networkId)
    : TransactionBuilder.newBasic(sender, recipient, item.value, item.fee, item.height, networkId)
  transaction.sign(keyPair)
  return {
    privateKeyHex: item.privateKeyHex,
    sender: sender.toUserFriendlyAddress(),
    recipient: recipient.toUserFriendlyAddress(),
    valueLuna: String(item.value),
    feeLuna: String(item.fee),
    validityStartHeight: item.height,
    network: item.network,
    data: item.data,
    serialized: hex(transaction.serialize()),
    hash: transaction.hash(),
  }
})
console.log(JSON.stringify(vectors, null, 2))
process.exit(0)
