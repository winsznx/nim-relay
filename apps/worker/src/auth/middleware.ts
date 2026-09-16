import type { MiddlewareHandler } from 'hono'
import type { Env } from '../env'
import { clearSessionCookieHeader, readSessionCookie, verifySessionToken } from './session'
import { getAuthStore, type AuthStore, type SessionRecord } from './store'

export interface AuthedVars {
  session: SessionRecord
  playerId: string
}

export type SessionLookup = { ok: true; session: SessionRecord } | { ok: false; error: 'no_session' | 'bad_session' | 'session_expired' }

/**
 * Resolves the session cookie without rejecting the request. The HMAC signature check
 * (`verifySessionToken`) is the cheap gate; the store lookup is the authority for
 * revocation and expiry (PRD 11.6).
 */
export async function lookupSession(env: Env, store: AuthStore, request: Request): Promise<SessionLookup> {
  const token = readSessionCookie(request)
  if (!token) return { ok: false, error: 'no_session' }

  const payload = await verifySessionToken(env, token)
  if (!payload) return { ok: false, error: 'bad_session' }

  const session = await store.getSession(payload.sessionId)
  if (!session || session.revokedAt !== null || session.expiresAt <= Date.now()) return { ok: false, error: 'session_expired' }
  return { ok: true, session }
}

/**
 * Rejects the request with 401 unless it carries a valid, unexpired,
 * unrevoked session cookie. On success `c.get('session')` / `c.get('playerId')`
 * are populated for the handler.
 */
export const requireSession: MiddlewareHandler<{ Bindings: Env; Variables: AuthedVars }> = async (c, next) => {
  const store = getAuthStore(c.env)
  const lookup = await lookupSession(c.env, store, c.req.raw)
  if (!lookup.ok) {
    if (lookup.error === 'session_expired') c.header('Set-Cookie', clearSessionCookieHeader())
    return c.json({ error: lookup.error }, 401)
  }

  await store.touchSession(lookup.session.id)
  c.set('session', lookup.session)
  c.set('playerId', lookup.session.playerId)
  await next()
}
