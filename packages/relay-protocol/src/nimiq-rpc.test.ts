import { describe, expect, it, vi } from 'vitest'
import { NimiqRpcClient, NIMIQ_RPC_ENDPOINTS, TransactionNotFoundError } from './nimiq-rpc'

function fakeFetch(responses: Array<{ status?: number; body: unknown }>): typeof fetch {
  let i = 0
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]!
    i++
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
}

describe('NimiqRpcClient', () => {
  it('knows the confirmed mainnet/testnet endpoints (DECISIONS.md D-006)', () => {
    expect(NIMIQ_RPC_ENDPOINTS.MainAlbatross).toBe('https://rpc.nimiqwatch.com')
    expect(NIMIQ_RPC_ENDPOINTS.TestAlbatross).toBe('https://rpc.testnet.nimiqwatch.com/')
  })

  it('parses a successful getBlockNumber response', async () => {
    const client = new NimiqRpcClient({
      rpcUrl: 'https://example.invalid',
      fetchImpl: fakeFetch([{ body: { jsonrpc: '2.0', result: { data: 60_000_000, metadata: null }, id: 1 } }]),
    })
    expect(await client.getBlockNumber()).toBe(60_000_000)
  })

  it('parses a successful getTransactionByHash response', async () => {
    const tx = {
      hash: 'abc123',
      sender: 'NQ1SENDER',
      recipient: 'NQ1RECIPIENT',
      value: '100000',
      data: 'TlIxLkdMT0JBTDAxLmEueA',
      network: 'test-albatross',
      blockNumber: 12345,
      confirmations: 10,
      executionResult: true,
    }
    const client = new NimiqRpcClient({
      rpcUrl: 'https://example.invalid',
      fetchImpl: fakeFetch([{ body: { jsonrpc: '2.0', result: { data: tx, metadata: null }, id: 1 } }]),
    })
    expect(await client.getTransactionByHash('abc123')).toEqual(tx)
  })

  it('throws TransactionNotFoundError on a real "not found" RPC error shape', async () => {
    const client = new NimiqRpcClient({
      rpcUrl: 'https://example.invalid',
      fetchImpl: fakeFetch([
        {
          body: {
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal error', data: 'Transaction not found: deadbeef' },
            id: 1,
          },
        },
      ]),
    })
    await expect(client.getTransactionByHash('deadbeef')).rejects.toThrow(TransactionNotFoundError)
  })

  it('throws a generic error for a non-"not found" RPC error', async () => {
    const client = new NimiqRpcClient({
      rpcUrl: 'https://example.invalid',
      fetchImpl: fakeFetch([
        { body: { jsonrpc: '2.0', error: { code: -32000, message: 'Method not found' }, id: 1 } },
      ]),
    })
    await expect(client.getBlockNumber()).rejects.toThrow('Method not found')
  })

  it('calls fetch unbound, as the Workers runtime requires', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { data: 1, metadata: null }, id: 1 })))
    await new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fetchImpl as unknown as typeof fetch }).getBlockNumber()
    expect(fetchImpl.mock.contexts).toEqual([undefined])
  })

  it('throws on a non-2xx HTTP response', async () => {
    const client = new NimiqRpcClient({
      rpcUrl: 'https://example.invalid',
      fetchImpl: fakeFetch([{ status: 503, body: {} }]),
    })
    await expect(client.getBlockNumber()).rejects.toThrow('RPC HTTP 503')
  })
})

describe('current Albatross RPC transaction shape', () => {
  const raw = { hash: 'a'.repeat(64), from: 'NQ07 0000', to: 'NQ08 1111', value: 100000, recipientData: '4e52312e', networkId: 5, blockNumber: 9, confirmations: 2, executionResult: true }
  it('normalizes addresses, hex data and numeric network/value', async () => {
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body: { result: { data: raw } } }]) })
    expect(await client.getTransactionByHash(raw.hash)).toEqual({ hash: raw.hash, sender: raw.from, recipient: raw.to, value: '100000', data: 'NR1.', network: 'TestAlbatross', blockNumber: 9, confirmations: 2, executionResult: true })
  })
  it('rejects a different transaction returned for the requested hash', async () => {
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body: { result: { data: raw } } }]) })
    await expect(client.getTransactionByHash('b'.repeat(64))).rejects.toThrow('hash mismatch')
  })
  it('rejects malformed response and unsafe money', async () => {
    for (const data of [null, { ...raw, value: Number.MAX_SAFE_INTEGER + 1 }, { ...raw, recipientData: 'not-hex' }]) {
      const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body: { result: { data } } }]) })
      await expect(client.getTransactionByHash(raw.hash)).rejects.toThrow()
    }
  })
})

describe('address history', () => {
  const SENDER = 'NQ16 2SSN 82TL SMQS KXT3 Q01V CMAL NU6F 1LJG'
  const RELAY_DATA = 'NR1.AUR0RA0001.3.AAAAAAAAAAAAAAAAAAAAAA'
  const hex = (text: string) => Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, '0')).join('')
  // Entries shaped like a MainAlbatross getTransactionsByAddress response, September 2026.
  const transfer = {
    hash: 'B'.repeat(64),
    blockNumber: 61835272,
    timestamp: 1789640190390,
    confirmations: 5,
    size: 195,
    relatedAddresses: [SENDER, 'NQ87 BLXR 6NUY 1TAJ TDTA SP4Y 53DJ X96M CLCK'],
    from: SENDER,
    fromType: 0,
    to: 'NQ87 BLXR 6NUY 1TAJ TDTA SP4Y 53DJ X96M CLCK',
    toType: 0,
    value: 100000,
    fee: 0,
    senderData: '',
    recipientData: hex(RELAY_DATA),
    flags: 0,
    validityStartHeight: 61835264,
    proof: '00',
    networkId: 24,
    executionResult: true,
  }
  const staking = { ...transfer, hash: 'c'.repeat(64), blockNumber: 61835262, timestamp: 1789640180391, confirmations: 15, to: 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001', toType: 3, recipientData: 'ab'.repeat(97) }
  const history = (data: unknown) => fakeFetch([{ body: { jsonrpc: '2.0', result: { data, metadata: null }, id: 1 } }])

  it('reads entries newest first and keeps an entry the verifier cannot read in its place', async () => {
    // #given a page with a relay transfer and a staking transaction whose data outgrows a basic transfer
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: history([transfer, staking]) })
    // #when the sender's history is read
    const entries = await client.getTransactionsByAddress(SENDER, 50)
    // #then both entries keep their hash and block time, and only the transfer is read as one
    expect(entries).toEqual([
      {
        hash: 'b'.repeat(64),
        timestamp: transfer.timestamp,
        transaction: { hash: 'b'.repeat(64), sender: SENDER, recipient: transfer.to, value: '100000', data: RELAY_DATA, network: 'MainAlbatross', blockNumber: 61835272, confirmations: 5, executionResult: true },
      },
      { hash: staking.hash, timestamp: staking.timestamp, transaction: null },
    ])
  })

  it('always sends address, page size and start hash as positional params', async () => {
    // #given a node that answers with an empty history
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { data: [], metadata: null }, id: 1 })))
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl })
    // #when the first page and the page before a known hash are read
    await client.getTransactionsByAddress(SENDER, 50)
    await client.getTransactionsByAddress(SENDER, 50, staking.hash)
    // #then each request names the method with all three params
    const requests = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { method: string; params: unknown[] })
    expect(requests.map(request => [request.method, request.params])).toEqual([
      ['getTransactionsByAddress', [SENDER, 50, null]],
      ['getTransactionsByAddress', [SENDER, 50, staking.hash]],
    ])
  })

  it('rejects a history that is not a list, or an entry without a hash or block time', async () => {
    for (const data of [null, transfer, [{ ...transfer, timestamp: undefined }], [{ ...transfer, hash: 'abc123' }]]) {
      const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: history(data) })
      await expect(client.getTransactionsByAddress(SENDER, 50)).rejects.toThrow()
    }
  })
})

describe('chain head', () => {
  // Shaped like a TestAlbatross getLatestBlock response, September 2026.
  const head = { hash: 'd'.repeat(64), size: 338, batch: 144099, epoch: 201, network: 'TestAlbatross', version: 2, number: 11677919, timestamp: 1789640392508, parentHash: 'e'.repeat(64) }

  it('reads the head block number, time and network without its body', async () => {
    // #given a node at block 11677919
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { data: head, metadata: null }, id: 1 })))
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl })
    // #when its head is read
    const latest = await client.getLatestBlock()
    // #then the block comes back without asking for its body
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { method: string; params: unknown[] }
    expect([latest, request.method, request.params]).toEqual([{ blockNumber: 11677919, timestamp: 1789640392508, network: 'TestAlbatross' }, 'getLatestBlock', [false]])
  })

  it('rejects a head without a block number or time', async () => {
    for (const data of [null, { ...head, number: undefined }, { ...head, timestamp: -1 }]) {
      const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body: { result: { data } } }]) })
      await expect(client.getLatestBlock()).rejects.toThrow()
    }
  })
})

describe('treasury calls', () => {
  it('reads an account balance in Luna with the block it was read at', async () => {
    // Shaped like a TestAlbatross getAccountByAddress response, September 2026.
    const body = { jsonrpc: '2.0', result: { data: { address: 'NQ21 SEXP BY6P CVJG 8RQX UVFR BQFD FBD6 S5LD', balance: 11000000000, type: 'basic' }, metadata: { blockNumber: 11699282, blockHash: 'd'.repeat(64) } }, id: 1 }
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body }]) })
    expect(await client.getAccountBalance('NQ21SEXPBY6PCVJG8RQXUVFRBQFDFBD6S5LD')).toEqual({ luna: 11000000000n, blockNumber: 11699282 })
  })

  it('rejects a balance it cannot read', async () => {
    for (const result of [{ data: null, metadata: null }, { data: { balance: -1 }, metadata: { blockNumber: 1 } }, { data: { balance: 5 }, metadata: null }]) {
      const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body: { result } }]) })
      await expect(client.getAccountBalance('NQ00')).rejects.toThrow()
    }
  })

  it('broadcasts serialized bytes and returns the node hash in lowercase', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { data: 'AB'.repeat(32), metadata: null }, id: 1 })))
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl })
    expect(await client.sendRawTransaction('0001')).toBe('ab'.repeat(32))
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { method: string; params: unknown[] }
    expect([request.method, request.params]).toEqual(['sendRawTransaction', ['0001']])
  })

  it('surfaces a node refusal as an error', async () => {
    const client = new NimiqRpcClient({ rpcUrl: 'https://example.invalid', fetchImpl: fakeFetch([{ body: { error: { code: -32603, message: 'Internal error', data: 'Serialization error' } } }]) })
    await expect(client.sendRawTransaction('00')).rejects.toThrow('Internal error')
  })
})
