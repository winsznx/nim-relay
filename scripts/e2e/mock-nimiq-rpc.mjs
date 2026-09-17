/**
 * Local stand-in for the Nimiq Albatross JSON-RPC node, for browser end-to-end
 * runs of the relay lifecycle. The Worker verifies handoffs against it exactly
 * as it would against rpc.testnet.nimiqwatch.com, so no real NIM moves.
 *
 *   node scripts/e2e/mock-nimiq-rpc.mjs [--port 8792] [--host 127.0.0.1]
 *
 * JSON-RPC (POST /):
 *   getTransactionByHash [hash]  executed-transaction shape the Worker's normalizeTransaction reads
 *   getBlockNumber []            current head
 *   getAccountByAddress [addr]   balance set through /__balance, zero otherwise
 *   getTransactionsByAddress     newest-first history of registered and sent transactions touching the address
 *   sendRawTransaction [hex]     parses a signed basic transfer, answers its hash and holds it unconfirmed
 *
 * Test control:
 *   POST /__register {hash, sender, recipient, value, data, confirmations?, executionResult?, networkId?, latencyMs?}
 *   POST /__confirm  {hash, confirmations}
 *   POST /__balance  {address, luna}
 *   POST /__fail     {hash}                 includes a sent transfer as failed
 *   GET  /__sent                            transfers received through sendRawTransaction
 *   GET  /__transactions         everything registered, for debugging
 *   GET  /__health
 *
 * `latencyMs` delays every lookup of that transaction, the way a public RPC answers
 * slower than a local one. Unknown hashes answer with the error the testnet node
 * returns (DECISIONS.md D-006).
 */
import { createServer } from 'node:http'
// The relay-protocol package's own copy: this script runs outside the pnpm workspace graph.
import { blake2b } from '../../packages/relay-protocol/node_modules/@noble/hashes/blake2.js'

const TEST_ALBATROSS = 5
const MAX_DATA_BYTES = 64
const HASH = /^[0-9a-f]{64}$/

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const port = Number(option('port', '8792'))
const host = option('host', '127.0.0.1')

/** Registered transactions by lowercase hash. */
const transactions = new Map()
/** Balances by compact user-friendly address. */
const balances = new Map()
/** Hashes received through sendRawTransaction, in order. */
const sent = []
let head = 4_200_000

class BadRequest extends Error {}

function requireString(body, field) {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) throw new BadRequest(`${field} must be a non-empty string`)
  return value
}

function requireCount(value, field, fallback) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) throw new BadRequest(`${field} must be a non-negative integer`)
  return value
}

function requireHash(body) {
  const hash = requireString(body, 'hash').toLowerCase()
  if (!HASH.test(hash)) throw new BadRequest('hash must be 64 hex characters')
  return hash
}

function register(body) {
  const hash = requireHash(body)
  const data = typeof body.data === 'string' ? body.data : ''
  if (Buffer.byteLength(data, 'utf8') > MAX_DATA_BYTES) throw new BadRequest(`data exceeds ${MAX_DATA_BYTES} bytes`)
  const confirmations = requireCount(body.confirmations, 'confirmations', 2)
  if (body.executionResult !== undefined && typeof body.executionResult !== 'boolean') throw new BadRequest('executionResult must be a boolean')
  head += 1
  const transaction = {
    hash,
    sender: requireString(body, 'sender'),
    recipient: requireString(body, 'recipient'),
    value: requireCount(body.value, 'value', undefined),
    data,
    confirmations,
    blockNumber: confirmations > 0 ? head - confirmations + 1 : null,
    executionResult: body.executionResult ?? true,
    networkId: requireCount(body.networkId, 'networkId', TEST_ALBATROSS),
    latencyMs: requireCount(body.latencyMs, 'latencyMs', 0),
    timestamp: Date.now(),
  }
  if (transaction.value === undefined) throw new BadRequest('value is required')
  transactions.set(hash, transaction)
  return transaction
}

function confirm(body) {
  const hash = requireHash(body)
  const transaction = transactions.get(hash)
  if (!transaction) throw new BadRequest(`unknown transaction ${hash}`)
  const confirmations = requireCount(body.confirmations, 'confirmations', undefined)
  if (confirmations === undefined || confirmations < 1) throw new BadRequest('confirmations must be at least 1')
  transaction.blockNumber ??= head
  transaction.confirmations = confirmations
  head = Math.max(head, transaction.blockNumber + confirmations - 1)
  return transaction
}

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

function friendlyAddress(bytes) {
  let bits = 0
  let accumulator = 0
  let encoded = ''
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      encoded += ALPHABET[(accumulator >>> bits) & 31]
    }
  }
  let remainder = 0
  for (const character of `${encoded}NQ00`) {
    const digits = /[0-9]/.test(character) ? character : String(character.charCodeAt(0) - 55)
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return `NQ${String(98 - remainder).padStart(2, '0')}${encoded}`
}

const compact = address => String(address).replace(/\s/g, '').toUpperCase()

/** Reads a signed basic transfer (both formats, as packages/relay-protocol/src/nimiq-transaction.ts writes them). */
function parseTransfer(hex) {
  if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new BadRequest('transaction must be hex')
  const bytes = Buffer.from(hex, 'hex')
  let offset = 0
  const take = length => {
    if (offset + length > bytes.length) throw new BadRequest('transaction ends early')
    const slice = bytes.subarray(offset, offset + length)
    offset += length
    return slice
  }
  let sender
  let recipient
  let data = Buffer.alloc(0)
  const format = take(1)[0]
  if (format === 0) {
    take(1)
    sender = Buffer.from(blake2b(take(32), { dkLen: 32 })).subarray(0, 20)
    recipient = take(20)
  } else if (format === 1) {
    sender = take(20)
    take(2)
    recipient = take(20)
    take(1)
    data = take(take(1)[0])
  } else {
    throw new BadRequest('unknown transaction format')
  }
  const amounts = take(21)
  const content = Buffer.concat([Buffer.from([data.length >> 8, data.length & 255]), data, sender, Buffer.from([0]), recipient, Buffer.from([0]), amounts, Buffer.from([0, 0])])
  return {
    hash: Buffer.from(blake2b(content, { dkLen: 32 })).toString('hex'),
    sender: friendlyAddress(sender),
    recipient: friendlyAddress(recipient),
    value: Number(amounts.readBigUInt64BE(0)),
    networkId: amounts[20],
    data: data.toString('utf8'),
  }
}

function receive(hex) {
  const transfer = parseTransfer(hex)
  const known = transactions.get(transfer.hash)
  if (known) return known.hash
  const balance = balances.get(transfer.sender) ?? 0
  if (balance < transfer.value) throw new BadRequest('insufficient balance')
  balances.set(transfer.sender, balance - transfer.value)
  balances.set(transfer.recipient, (balances.get(transfer.recipient) ?? 0) + transfer.value)
  transactions.set(transfer.hash, { ...transfer, confirmations: 0, blockNumber: null, executionResult: true, latencyMs: 0, timestamp: Date.now() })
  sent.push(transfer.hash)
  return transfer.hash
}

function failSent(body) {
  const transaction = transactions.get(requireHash(body))
  if (!transaction) throw new BadRequest('unknown transaction')
  head += 1
  Object.assign(transaction, { blockNumber: head, confirmations: 2, executionResult: false })
  return transaction
}

function setBalance(body) {
  const luna = requireCount(body.luna, 'luna', undefined)
  if (luna === undefined) throw new BadRequest('luna is required')
  balances.set(compact(requireString(body, 'address')), luna)
  return { address: compact(body.address), luna }
}

/** Albatross `getTransactionByHash` result data for an executed transaction. */
function executedTransaction(transaction) {
  return {
    hash: transaction.hash,
    ...(transaction.blockNumber === null ? {} : { blockNumber: transaction.blockNumber, confirmations: transaction.confirmations }),
    timestamp: transaction.timestamp,
    size: 170,
    relatedAddresses: [transaction.sender, transaction.recipient],
    from: transaction.sender,
    fromType: 0,
    to: transaction.recipient,
    toType: 0,
    value: transaction.value,
    fee: 0,
    senderData: '',
    recipientData: Buffer.from(transaction.data, 'utf8').toString('hex'),
    flags: 0,
    validityStartHeight: transaction.blockNumber ?? head,
    proof: '',
    networkId: transaction.networkId,
    executionResult: transaction.executionResult,
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function rpc(request) {
  const id = request?.id ?? null
  const params = Array.isArray(request?.params) ? request.params : []
  switch (request?.method) {
    case 'getBlockNumber':
      return { jsonrpc: '2.0', result: { data: head, metadata: null }, id }
    case 'getAccountByAddress': {
      const address = compact(params[0] ?? '')
      return { jsonrpc: '2.0', result: { data: { address, balance: balances.get(address) ?? 0, type: 'basic' }, metadata: { blockNumber: head, blockHash: '0'.repeat(64) } }, id }
    }
    case 'getTransactionsByAddress': {
      const address = compact(params[0] ?? '')
      const history = [...transactions.values()]
        .filter(transaction => compact(transaction.sender) === address || compact(transaction.recipient) === address)
        .sort((a, b) => b.timestamp - a.timestamp)
        .map(executedTransaction)
      return { jsonrpc: '2.0', result: { data: history, metadata: null }, id }
    }
    case 'sendRawTransaction':
      try {
        return { jsonrpc: '2.0', result: { data: receive(params[0]), metadata: null }, id }
      } catch (error) {
        if (!(error instanceof BadRequest)) throw error
        return { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error', data: error.message }, id }
      }
    case 'getTransactionByHash': {
      const hash = typeof params[0] === 'string' ? params[0].toLowerCase() : ''
      const transaction = transactions.get(hash)
      if (!transaction) return { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error', data: `Transaction not found: ${hash}` }, id }
      if (transaction.latencyMs > 0) await wait(transaction.latencyMs)
      return { jsonrpc: '2.0', result: { data: executedTransaction(transaction), metadata: null }, id }
    }
    default:
      return { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id }
  }
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new BadRequest('body is not JSON')
  }
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', `http://${host}`).pathname
  try {
    if (request.method === 'GET' && path === '/__health') return send(response, 200, { ok: true, head })
    if (request.method === 'GET' && path === '/__transactions') return send(response, 200, [...transactions.values()])
    if (request.method === 'GET' && path === '/__sent') return send(response, 200, sent.map(hash => transactions.get(hash)))
    if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' })
    const body = await readJson(request)
    if (path === '/__register') return send(response, 200, register(body))
    if (path === '/__confirm') return send(response, 200, confirm(body))
    if (path === '/__balance') return send(response, 200, setBalance(body))
    if (path === '/__fail') return send(response, 200, failSent(body))
    if (path === '/') return send(response, 200, await rpc(body))
    return send(response, 404, { error: 'not_found' })
  } catch (error) {
    if (error instanceof BadRequest) return send(response, 400, { error: error.message })
    console.error('mock-nimiq-rpc request failed', error)
    return send(response, 500, { error: 'internal' })
  }
})

server.listen(port, host, () => console.log(`mock Nimiq RPC listening on http://${host}:${port}/`))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    server.closeAllConnections()
  })
}
