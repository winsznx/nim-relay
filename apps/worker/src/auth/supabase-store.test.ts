import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseAuthStore } from './supabase-store'

/**
 * Faithful-enough fake of the PostgREST query builder: records the operation
 * and filters, executes trivial in-memory logic, and returns the
 * `{ data, error }` shape supabase-js resolves to. Enough to prove
 * SupabaseAuthStore targets the right tables with the right payloads and maps
 * rows back correctly. Behavioural contract coverage lives in the
 * InMemoryAuthStore-backed route tests.
 */
interface Row {
  [k: string]: unknown
}

class FakeTable {
  rows: Row[] = []
  calls: Array<{ op: string; payload?: unknown; filters: Array<[string, unknown]> }> = []
}

class FakeQuery {
  private op = 'select'
  private payload: unknown
  private filters: Array<[string, unknown]> = []

  constructor(private readonly table: FakeTable) {}

  private record() {
    this.table.calls.push({ op: this.op, payload: this.payload, filters: this.filters })
  }

  insert(payload: Row) {
    this.op = 'insert'
    this.payload = payload
    return this
  }
  upsert(payload: Row, _opts?: { onConflict?: string }) {
    this.op = 'upsert'
    this.payload = payload
    return this
  }
  update(payload: Row) {
    this.op = 'update'
    this.payload = payload
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  select(_cols?: string) {
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }
  is(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }

  private match(r: Row) {
    return this.filters.every(([c, v]) => r[c] === v)
  }

  private run(): { data: Row | Row[] | null; error: null } {
    this.record()
    if (this.op === 'insert' || this.op === 'upsert') {
      const row = { id: `id-${this.table.rows.length + 1}`, revoked_at: null, ...(this.payload as Row) }
      this.table.rows.push(row)
      return { data: row, error: null }
    }
    if (this.op === 'delete') {
      const hit = this.table.rows.filter((r) => this.match(r))
      this.table.rows = this.table.rows.filter((r) => !this.match(r))
      return { data: hit[0] ?? null, error: null }
    }
    if (this.op === 'update') {
      const hit = this.table.rows.filter((r) => this.match(r))
      hit.forEach((r) => Object.assign(r, this.payload))
      return { data: hit[0] ?? null, error: null }
    }
    const found = this.table.rows.filter((r) => this.match(r))
    return { data: found[0] ?? null, error: null }
  }

  maybeSingle() {
    return Promise.resolve(this.run())
  }
  single() {
    return Promise.resolve(this.run())
  }
  then(resolve: (v: { data: unknown; error: null }) => unknown) {
    return Promise.resolve(this.run()).then(resolve)
  }
}

function fakeClient() {
  const tables = new Map<string, FakeTable>()
  const client = {
    from(name: string) {
      let t = tables.get(name)
      if (!t) {
        t = new FakeTable()
        tables.set(name, t)
      }
      return new FakeQuery(t)
    },
  } as unknown as SupabaseClient
  const tbl = (name: string): FakeTable => {
    const t = tables.get(name)
    if (!t) throw new Error(`table ${name} never touched`)
    return t
  }
  return { client, tbl, has: (name: string) => tables.has(name) }
}

describe('SupabaseAuthStore', () => {
  it('inserts a nonce with ISO timestamps and consumes it exactly once', async () => {
    const { client, tbl } = fakeClient()
    const store = new SupabaseAuthStore(client)
    await store.putNonce({ nonce: 'n1', issuedAt: 1_000, expiresAt: 300_000 })

    expect(tbl('login_nonces').calls[0]).toMatchObject({
      op: 'insert',
      payload: { nonce: 'n1', issued_at: new Date(1_000).toISOString() },
    })

    const consumed = await store.consumeNonce('n1')
    expect(consumed).toEqual({ nonce: 'n1', issuedAt: 1_000, expiresAt: 300_000 })
    expect(await store.consumeNonce('n1')).toBeNull()
  })

  it('normalizes the wallet address on lookup and creation', async () => {
    const { client, tbl } = fakeClient()
    const store = new SupabaseAuthStore(client)

    await store.createPlayer({ walletAddress: 'nq07 abcd ef01', walletPublicKey: 'pub' })
    const inserted = tbl('players').calls.at(-1)?.payload as Row
    expect(inserted.wallet_address).toBe('NQ07ABCDEF01')
    expect(inserted.handle).toMatch(/^runner-/)

    await store.findPlayerByWallet('nq07 ABCD ef01')
    expect(tbl('players').calls.at(-1)?.filters).toContainEqual(['wallet_address', 'NQ07ABCDEF01'])
  })

  it('maps a stored player row back to a PlayerRecord', async () => {
    const { client } = fakeClient()
    const store = new SupabaseAuthStore(client)
    const created = await store.createPlayer({ walletAddress: 'NQ07 0001', walletPublicKey: 'pk' })
    const fetched = await store.getPlayerById(created.id)
    expect(fetched).toEqual(created)
    expect(fetched?.walletPublicKey).toBe('pk')
  })

  it('creates a device then a session linked to it', async () => {
    const { client, tbl } = fakeClient()
    const store = new SupabaseAuthStore(client)
    const session = await store.createSession({ playerId: 'p1', deviceHash: 'dh', expiresAt: 999_000 })

    expect(tbl('devices').calls[0]).toMatchObject({ op: 'upsert', payload: { device_hash: 'dh', player_id: 'p1' } })
    const sessionInsert = tbl('sessions').calls[0]?.payload as Row
    expect(sessionInsert.device_id).toBe('id-1')
    expect(sessionInsert.expires_at).toBe(new Date(999_000).toISOString())
    expect(session).toMatchObject({ playerId: 'p1', expiresAt: 999_000, revokedAt: null })
  })

  it('skips the device row when no device hash is given', async () => {
    const { client, has } = fakeClient()
    const store = new SupabaseAuthStore(client)
    await store.createSession({ playerId: 'p1', deviceHash: null, expiresAt: 1 })
    expect(has('devices')).toBe(false)
  })

  it('revokes only an unrevoked session', async () => {
    const { client, tbl } = fakeClient()
    const store = new SupabaseAuthStore(client)
    const session = await store.createSession({ playerId: 'p1', deviceHash: null, expiresAt: 5_000 })
    await store.revokeSession(session.id)
    const revokeCall = tbl('sessions').calls.at(-1)
    expect(revokeCall?.op).toBe('update')
    expect(revokeCall?.filters).toContainEqual(['revoked_at', null])
    const after = await store.getSession(session.id)
    expect(after?.revokedAt).not.toBeNull()
  })
})
