import { SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { getAuthStore } from '../auth/store'
import { createSessionToken } from '../auth/session'
import { NimiqRpcClient } from '@nim-relay/relay-protocol'
import type { Env } from '../env'
import type { IssuedRace, StationSnapshot, SubmittedRace } from '@nim-relay/shared'
async function player() {
  const store = getAuthStore(undefined)
  const p = await store.createPlayer({ walletAddress: `NQ${crypto.randomUUID().replaceAll('-', '')}`, walletPublicKey: '00'.repeat(32) })
  const session = await store.createSession({ playerId: p.id, deviceHash: null, expiresAt: Date.now() + 60000 })
  const token = await createSessionToken({ SESSION_SECRET: 'test-session-secret' } as Env, { sessionId: session.id, playerId: p.id })
  return { p, cookie: `nr_session=${token}` }
}
function api(cookie: string, path = '', body?: unknown) { return SELF.fetch(`https://example.com/api/station${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
describe('persisted station', () => {
  it('requires authentication but exposes only aggregate public station data', async () => {
    expect((await api('')).status).toBe(401)
    const response = await api('', '/public'); expect(response.status).toBe(200)
    expect(JSON.stringify(await response.json())).not.toContain('wallet')
  })
  it('binds issuance to identity and signed config; credits a replay exactly once', async () => {
    const a = await player(); const b = await player()
    const issued = await (await api(a.cookie, '/issue', { mode: 'quick', world: 'alpine' })).json() as IssuedRace
    expect((await api(b.cookie, '/submit', { issued, inputTrace: [[0, 0, 0, 0]] })).status).toBe(404)
    expect((await api(a.cookie, '/submit', { issued: { ...issued, config: { ...issued.config, world: 'coast' } }, inputTrace: [[0, 0, 0, 0]] })).status).toBe(401)
    expect((await api(a.cookie, '/submit', { issued: { ...issued, relayLeg: 999 }, inputTrace: [[0, 0, 0, 0]] })).status).toBe(401)
    expect((await api(a.cookie, '/submit', { issued: { ...issued, mac: 'forged' }, inputTrace: [[0, 0, 0, 0]] })).status).toBe(401)
    expect((await api(a.cookie, '/submit', { issued, inputTrace: [[0, 99, 0, 0]] })).status).toBe(400)
    const firstResponse = await api(a.cookie, '/submit', { issued, inputTrace: [[0, 0, 0, 0]] })
    expect(firstResponse.status).toBe(200)
    const first = await firstResponse.json() as SubmittedRace
    expect(first.result.completed).toBe(true); expect(first.created).toBe(true)
    const second = await (await api(a.cookie, '/submit', { issued, inputTrace: [[0, 0, 0, 0]] })).json() as SubmittedRace
    expect(second.created).toBe(false); expect(second.xpEarned).toBe(0); expect(second.profile.xp).toBe(first.profile.xp)
    const next = await (await api(b.cookie, '/issue', { mode: 'quick', world: 'alpine' })).json() as IssuedRace
    expect(next.ghost?.runId).toBe(issued.runId)
    expect(JSON.stringify(next.ghost)).not.toContain(a.p.walletAddress)
    expect(JSON.stringify(next.ghost)).not.toContain('mac')
  })
  it('persists crew membership and cross-player verified ghost invitations', async () => {
    const a = await player(); const b = await player()
    await api(b.cookie)
    const created = await (await api(a.cookie, '/crew/create', { name: 'Test Couriers' })).json() as StationSnapshot
    const joined = await (await api(b.cookie, '/crew/join', { code: created.crews[0]!.code })).json() as StationSnapshot
    expect(joined.crews[0]?.members).toContain(a.p.id)
    const issued = await (await api(a.cookie, '/issue', { mode: 'crew', world: 'metro' })).json() as IssuedRace
    await api(a.cookie, '/submit', { issued, inputTrace: [[0, 0, 0, 0]] })
    expect((await api(a.cookie, '/challenge', { recipient: b.p.id, runId: issued.runId })).status).toBe(200)
    const inbox = await (await api(b.cookie)).json() as StationSnapshot
    expect(inbox.inbox[0]?.runId).toBe(issued.runId)
    const reply = await (await api(b.cookie, '/issue', { mode: 'rival', world: 'coast', target: inbox.inbox[0]!.id })).json() as IssuedRace
    expect(reply.config).toEqual(issued.config); expect(reply.ghost?.verified).toBe(true)
    expect((await api(b.cookie, '/profile', { category: 'suit', cosmetic: 'midnight' })).status).toBe(403)
  })
  it('requires custody and a finished global run before preparing a real transfer', async () => {
    const a = await player(); const b = await player(); await api(b.cookie)
    const quick = await (await api(a.cookie, '/issue', { mode: 'quick', world: 'coast' })).json() as IssuedRace
    await api(a.cookie, '/submit', { issued: quick, inputTrace: [[0, 0, 0, 0]] })
    expect((await api(a.cookie, '/handoff/prepare', { runId: quick.runId, recipient: b.p.id })).status).toBe(409)
    const global = await (await api(a.cookie, '/issue', { mode: 'global', world: 'coast' })).json() as IssuedRace
    await api(a.cookie, '/submit', { issued: global, inputTrace: [[0, 0, 0, 0]] })
    expect((await api(b.cookie, '/handoff/prepare', { runId: global.runId, recipient: a.p.id })).status).toBe(409)
    const prepared = await api(a.cookie, '/handoff/prepare', { runId: global.runId, recipient: b.p.id }); expect(prepared.status).toBe(200)
    const intent = await prepared.json() as { id: string; data: string; value: number; status: string; sender: string; recipient: string }
    expect(intent.data).toMatch(/^NR1\.GLOBAL\.1\./); expect(intent.value).toBe(100000); expect(intent.status).toBe('pending')
    expect((await api(b.cookie, '/handoff/confirm', { id: intent.id, txHash: 'a'.repeat(64) })).status).toBe(404)
    expect((await api(a.cookie, '/handoff/confirm', { id: intent.id, txHash: 'fake' })).status).toBe(400)
    const lookup = vi.spyOn(NimiqRpcClient.prototype, 'getTransactionByHash')
    try {
      lookup.mockResolvedValue({ hash: 'a'.repeat(64), sender: intent.sender, recipient: intent.recipient, value: '100000', data: intent.data, network: 'TestAlbatross', blockNumber: null, confirmations: 0, executionResult: true })
      const pending = await (await api(a.cookie, '/handoff/confirm', { id: intent.id, txHash: 'a'.repeat(64) })).json() as { status: string }
      expect(pending.status).toBe('pending')
      const before = await (await api(a.cookie)).json() as StationSnapshot
      expect(before.global.holderId).toBe(a.p.id)
      expect(before.pendingHandoff?.id).toBe(intent.id)
      expect(before.pendingHandoff?.txHash).toBe('a'.repeat(64))
      lookup.mockResolvedValue({ hash: 'a'.repeat(64), sender: intent.sender, recipient: intent.recipient, value: '100000', data: intent.data, network: 'TestAlbatross', blockNumber: 100, confirmations: 2, executionResult: true })
      const confirmed = await (await api(a.cookie, '/handoff/confirm', { id: intent.id, txHash: 'a'.repeat(64) })).json() as { status: string }
      expect(confirmed.status).toBe('verified')
      const after = await (await api(b.cookie)).json() as StationSnapshot
      expect(after.global.holderId).toBe(b.p.id); expect(after.global.leg).toBe(1)
      await api(a.cookie, '/handoff/confirm', { id: intent.id, txHash: 'a'.repeat(64) })
      const repeated = await (await api(b.cookie)).json() as StationSnapshot
      expect(repeated.global.leg).toBe(1)
      expect((await api(a.cookie, '/handoff/confirm', { id: intent.id, txHash: 'b'.repeat(64) })).status).toBe(409)
    } finally { lookup.mockRestore() }

  })
})
