import { Hono } from 'hono'
import { z } from 'zod'
import { bytesToHex, deriveNimiqAddress, hexToBytes, verifyNimiqSignedMessage } from '@nim-relay/relay-protocol'
import type { Env } from '../env'
import { hashDeviceId } from './device-hash'
import { buildLoginMessage, isNonceExpired, issueLoginNonce } from './nonce'
import {
  clearSessionCookieHeader,
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieHeader,
} from './session'
import { getAuthStore, type PlayerRecord } from './store'
import { requireSession, type AuthedVars } from './middleware'

/**
 * PRD sections 11.4-11.6 / 32.3 - Nimiq-account login.
 *
 *   POST /api/auth/nonce   -> { nonce }              issue a single-use challenge
 *   POST /api/auth/verify  -> { player } + cookie    verify the signed challenge, open a session
 *   POST /api/auth/logout  -> {}                     revoke the session, clear the cookie
 *   GET  /api/auth/me      -> { player }             current session's player
 *
 * The client signs `buildLoginMessage(APP_ORIGIN, nonce)` with its Nimiq
 * account key via the Mini App SDK's `sign()`. Origin-bound so a signature
 * for one deployment can't be replayed against another; nonce-bound and
 * single-use so it can't be replayed across attempts on the same origin.
 */

const verifyBody = z.object({
  nonce: z.string().min(1),
  publicKeyHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
  signatureHex: z.string().regex(/^[0-9a-fA-F]{128}$/),
  deviceId: z.string().min(1).max(512).optional(),
})

function publicPlayer(player: PlayerRecord) {
  return {
    id: player.id,
    handle: player.handle,
    displayName: player.displayName,
    walletAddress: player.walletAddress,
  }
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>()

authRoutes.post('/nonce', async (c) => {
  const nonce = issueLoginNonce()
  await getAuthStore(c.env).putNonce(nonce)
  return c.json({
    nonce: nonce.nonce,
    message: buildLoginMessage(c.env.APP_ORIGIN, nonce.nonce),
    expiresAt: nonce.expiresAt,
  })
})

authRoutes.post('/verify', async (c) => {
  const parsed = verifyBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400)
  const { nonce, publicKeyHex, signatureHex, deviceId } = parsed.data

  const store = getAuthStore(c.env)
  const issued = await store.consumeNonce(nonce)
  if (!issued) return c.json({ error: 'unknown_nonce' }, 400)
  if (isNonceExpired(issued)) return c.json({ error: 'nonce_expired' }, 400)

  const message = buildLoginMessage(c.env.APP_ORIGIN, nonce)
  const signatureValid = await verifyNimiqSignedMessage({ message, signatureHex, publicKeyHex })
  if (!signatureValid) return c.json({ error: 'bad_signature' }, 401)

  const walletAddress = bytesToHex(deriveNimiqAddress(hexToBytes(publicKeyHex)))

  const player =
    (await store.findPlayerByWallet(walletAddress)) ??
    (await store.createPlayer({ walletAddress, walletPublicKey: publicKeyHex }))

  const deviceHash = deviceId ? await hashDeviceId(c.env, deviceId) : null
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  const session = await store.createSession({ playerId: player.id, deviceHash, expiresAt })

  const token = await createSessionToken(c.env, { sessionId: session.id, playerId: player.id })
  c.header('Set-Cookie', sessionCookieHeader(token))
  return c.json({ player: publicPlayer(player) })
})

const deviceBody = z.object({ deviceId: z.string().min(1).max(512) }).strict()

/**
 * Links a Nimiq Pay device signal to the current session, for runners who signed in without one and now need it (a
 * Relay Grant claim). Only the HMAC is stored; a session keeps the first device it was linked to.
 */
authRoutes.post('/device', requireSession, async (c) => {
  const parsed = deviceBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400)
  const deviceHash = await hashDeviceId(c.env, parsed.data.deviceId)
  const session = await getAuthStore(c.env).attachDevice(c.get('session').id, c.get('playerId'), deviceHash)
  if (!session) return c.json({ error: 'session_expired' }, 401)
  return c.json({ deviceSignal: session.deviceHash !== null })
})

authRoutes.post('/logout', requireSession, async (c) => {
  await getAuthStore(c.env).revokeSession(c.get('session').id)
  c.header('Set-Cookie', clearSessionCookieHeader())
  return c.json({})
})

authRoutes.get('/me', requireSession, async (c) => {
  const player = await getAuthStore(c.env).getPlayerById(c.get('playerId'))
  if (!player) return c.json({ error: 'session_expired' }, 401)
  return c.json({ player: publicPlayer(player) })
})
