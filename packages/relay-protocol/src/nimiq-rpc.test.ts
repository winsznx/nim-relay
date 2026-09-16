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
