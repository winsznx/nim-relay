import { describe, expect, it } from 'vitest'
import { createSessionToken, readSessionCookie, sessionCookieHeader, verifySessionToken } from './session'

const fakeEnv = { SESSION_SECRET: 'test-secret-do-not-use-in-prod' } as never

describe('session token', () => {
  it('round-trips a valid token', async () => {
    const token = await createSessionToken(fakeEnv, { sessionId: 'sess-1', playerId: 'player-1' })
    const payload = await verifySessionToken(fakeEnv, token)
    expect(payload).toEqual({ sessionId: 'sess-1', playerId: 'player-1' })
  })

  it('rejects a tampered token', async () => {
    const token = await createSessionToken(fakeEnv, { sessionId: 'sess-1', playerId: 'player-1' })
    const tampered = token.replace('player-1', 'player-2')
    expect(await verifySessionToken(fakeEnv, tampered)).toBeNull()
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken(fakeEnv, { sessionId: 'sess-1', playerId: 'player-1' })
    const otherEnv = { SESSION_SECRET: 'a-different-secret' } as never
    expect(await verifySessionToken(otherEnv, token)).toBeNull()
  })

  it('rejects malformed tokens without throwing', async () => {
    expect(await verifySessionToken(fakeEnv, '')).toBeNull()
    expect(await verifySessionToken(fakeEnv, 'not.enough')).toBeNull()
    expect(await verifySessionToken(fakeEnv, 'a.b.c.d')).toBeNull()
  })

  it('reads the session cookie out of a Cookie header among others', () => {
    const token = 'abc.def.ghi'
    const header = sessionCookieHeader(token)
    const cookieValue = header.split(';')[0]
    const req = new Request('https://example.com', {
      headers: { Cookie: `other=1; ${cookieValue}; another=2` },
    })
    expect(readSessionCookie(req)).toBe(token)
  })

  it('returns null when no session cookie is present', () => {
    const req = new Request('https://example.com', { headers: { Cookie: 'other=1' } })
    expect(readSessionCookie(req)).toBeNull()
    expect(readSessionCookie(new Request('https://example.com'))).toBeNull()
  })
})
