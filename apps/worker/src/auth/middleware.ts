import type { MiddlewareHandler } from 'hono'
import type { Env } from '../env'
import { clearSessionCookieHeader, readSessionCookie, verifySessionToken } from './session'
import { getAuthStore, type SessionRecord } from './store'

export interface AuthedVars {
  session: SessionRecord
  playerId: string
}

/**
 * Rejects the request with 401 unless it carries a valid, unexpired,
 * unrevoked session cookie. On success `c.get('session')` / `c.get('playerId')`
 * are populated for the handler.
 *
 * The HMAC signature check (`verifySessionToken`) is the cheap gate; the
 * store lookup is the authority for revocation and expiry (PRD 11.6).
 */
export const requireSession: MiddlewareHandler<{ Bindings: Env; Variables: AuthedVars }> = async (c, next) => {
  const token = readSessionCookie(c.req.raw)
  if (!token) return c.json({ error: 'no_session' }, 401)

  const payload = await verifySessionToken(c.env, token)
  if (!payload) return c.json({ error: 'bad_session' }, 401)

  const store = getAuthStore(c.env)
  const session = await store.getSession(payload.sessionId)
  const now = Date.now()
  if (!session || session.revokedAt !== null || session.expiresAt <= now) {
    c.header('Set-Cookie', clearSessionCookieHeader())
    return c.json({ error: 'session_expired' }, 401)
  }

  await store.touchSession(session.id)
  c.set('session', session)
  c.set('playerId', session.playerId)
  await next()
}
