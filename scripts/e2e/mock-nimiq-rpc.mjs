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
 *
 * Test control:
 *   POST /__register {hash, sender, recipient, value, data, confirmations?, executionResult?, networkId?, latencyMs?}
 *   POST /__confirm  {hash, confirmations}
 *   GET  /__transactions         everything registered, for debugging
 *   GET  /__health
 *
 * `latencyMs` delays every lookup of that transaction, the way a public RPC answers
 * slower than a local one. Unknown hashes answer with the error the testnet node
 * returns (DECISIONS.md D-006).
 */
import { createServer } from 'node:http'

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
    if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' })
    const body = await readJson(request)
    if (path === '/__register') return send(response, 200, register(body))
    if (path === '/__confirm') return send(response, 200, confirm(body))
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
