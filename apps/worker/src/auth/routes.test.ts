import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  nimiqPublicKeyFromPrivate,
  signNimiqSignedMessage,
} from '@nim-relay/relay-protocol'
import { buildLoginMessage } from './nonce'
import { __resetAuthStoreForTests, getAuthStore } from './store'

const TEST_ORIGIN = 'http://localhost:5173' // must match wrangler.jsonc `vars.APP_ORIGIN`
const PRIVATE_KEY_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'

async function credentials(nonce: string) {
  const publicKeyHex = await nimiqPublicKeyFromPrivate(PRIVATE_KEY_HEX)
  const signatureHex = await signNimiqSignedMessage({
    message: buildLoginMessage(TEST_ORIGIN, nonce),
    privateKeyHex: PRIVATE_KEY_HEX,
  })
  return { nonce, publicKeyHex, signatureHex }
}

async function seededNonce(overrides: { expiresAt?: number } = {}): Promise<string> {
  const nonce = crypto.randomUUID()
  const now = Date.now()
  await getAuthStore(undefined).putNonce({
    nonce,
    issuedAt: now,
    expiresAt: overrides.expiresAt ?? now + 5 * 60 * 1000,
  })
  return nonce
}

function post(path: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const init: RequestInit = { method: 'POST' }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json', ...extraHeaders }
  } else if (extraHeaders) {
    init.headers = extraHeaders
  }
  return SELF.fetch(`https://example.com/api/auth${path}`, init)
}

beforeEach(() => {
  __resetAuthStoreForTests()
})

describe('POST /api/auth/nonce', () => {
  it('issues a nonce with the message to sign and an expiry', async () => {
    const res = await post('/nonce')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nonce: string; message: string; expiresAt: number }
    expect(body.nonce).toHaveLength(36)
    expect(body.message).toContain(body.nonce)
    expect(body.message).toContain('NIM Relay login')
    expect(body.expiresAt).toBeGreaterThan(Date.now())
  })
})

describe('POST /api/auth/verify', () => {
  it('opens a session for a valid signed challenge and sets an HttpOnly cookie', async () => {
    const nonce = await seededNonce()
    const res = await post('/verify', await credentials(nonce))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toMatch(/nr_session=/)
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Secure/)
    const body = (await res.json()) as { player: { id: string; walletAddress: string } }
    expect(body.player.id).toBeTruthy()
    expect(body.player.walletAddress).toMatch(/^[0-9A-F]{40}$/i)
  })

  it('returns the same player on a second login from the same key', async () => {
    const first = await post('/verify', await credentials(await seededNonce()))
    const second = await post('/verify', await credentials(await seededNonce()))
    const a = (await first.json()) as { player: { id: string } }
    const b = (await second.json()) as { player: { id: string } }
    expect(a.player.id).toBe(b.player.id)
  })

  it('rejects an unknown nonce', async () => {
    const res = await post('/verify', await credentials('never-issued'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unknown_nonce' })
  })

  it('rejects a nonce that is already consumed (single-use, no replay)', async () => {
    const nonce = await seededNonce()
    const creds = await credentials(nonce)
    expect((await post('/verify', creds)).status).toBe(200)
    const replay = await post('/verify', creds)
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ error: 'unknown_nonce' })
  })

  it('rejects an expired nonce', async () => {
    const nonce = await seededNonce({ expiresAt: Date.now() - 1 })
    const res = await post('/verify', await credentials(nonce))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'nonce_expired' })
  })

  it('rejects a signature over the wrong message (different nonce)', async () => {
    const nonce = await seededNonce()
    const creds = await credentials('a-different-nonce')
    const res = await post('/verify', { ...creds, nonce })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'bad_signature' })
  })

  it('rejects a malformed body', async () => {
    expect((await post('/verify', { nonce: 'x' })).status).toBe(400)
    expect((await post('/verify', { nonce: 'x', publicKeyHex: 'zz', signatureHex: 'zz' })).status).toBe(400)
  })
})

describe('session lifecycle', () => {
  async function login() {
    const res = await post('/verify', await credentials(await seededNonce()))
    const cookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0]!
    return cookie
  }

  it('GET /me requires a session', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('GET /me returns the player for a valid session', async () => {
    const cookie = await login()
    const res = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    expect((await res.json()) as { player: unknown }).toHaveProperty('player')
  })

  it('logout revokes the session so /me stops working', async () => {
    const cookie = await login()
    const out = await post('/logout', undefined, { Cookie: cookie })
    expect(out.status).toBe(200)
    const after = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } })
    expect(after.status).toBe(401)
  })

  it('rejects a forged session cookie', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/me', {
      headers: { Cookie: 'nr_session=forged.session.value' },
    })
    expect(res.status).toBe(401)
  })
})
