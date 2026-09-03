import type { Env } from '../env'

/**
 * PRD section 11.6 - HttpOnly/Secure same-origin session cookie, signed
 * opaque session ID, rolling expiry, 30-day max without re-auth.
 *
 * The session token is HMAC-signed with SESSION_SECRET so the Worker can
 * verify it without a database round-trip on every request; the database
 * row (sessions table) remains the source of truth for revocation.
 */

const SESSION_COOKIE_NAME = 'nr_session'
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

export interface SessionTokenPayload {
  sessionId: string
  playerId: string
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toBase64Url(new Uint8Array(sig))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function createSessionToken(env: Env, payload: SessionTokenPayload): Promise<string> {
  const body = `${payload.sessionId}.${payload.playerId}`
  const sig = await hmacSign(env.SESSION_SECRET, body)
  return `${body}.${sig}`
}

export async function verifySessionToken(env: Env, token: string): Promise<SessionTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [sessionId, playerId, sig] = parts as [string, string, string]
  const expected = await hmacSign(env.SESSION_SECRET, `${sessionId}.${playerId}`)
  if (!timingSafeEqual(sig, expected)) return null
  return { sessionId, playerId }
}

export function sessionCookieHeader(token: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join('; ')
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE_NAME) return rest.join('=')
  }
  return null
}
