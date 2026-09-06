import { challengeMacMessage, type ChallengeFields, type IssuedChallenge } from '@nim-relay/relay-protocol'
import type { Env } from '../env'

/**
 * HMAC-SHA256 over the canonical challenge message (PRD 7.8). Keyed with
 * `RUN_CHALLENGE_SECRET`; hex output so it round-trips through JSON and the
 * `isWellFormedChallenge` shape check. Mirrors the session-token HMAC.
 */

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function signChallenge(env: Env, fields: ChallengeFields): Promise<IssuedChallenge> {
  const mac = await hmacHex(env.RUN_CHALLENGE_SECRET, challengeMacMessage(fields))
  return { ...fields, mac }
}

/** Returns the covered fields when the MAC is valid, `null` otherwise. */
export async function verifyChallenge(env: Env, issued: IssuedChallenge): Promise<ChallengeFields | null> {
  const { mac, ...fields } = issued
  const expected = await hmacHex(env.RUN_CHALLENGE_SECRET, challengeMacMessage(fields))
  return timingSafeEqual(mac, expected) ? fields : null
}
