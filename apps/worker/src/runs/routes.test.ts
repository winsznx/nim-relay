import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ENGINE_VERSION,
  RULES_HASH,
  replay,
  type InputTrace,
} from '@nim-relay/game-engine'
import {
  challengeMacMessage,
  nimiqPublicKeyFromPrivate,
  signNimiqSignedMessage,
  type ChallengeFields,
  type IssuedChallenge,
} from '@nim-relay/relay-protocol'
import { __resetAuthStoreForTests, getAuthStore } from '../auth/store'
import { buildLoginMessage } from '../auth/nonce'
import { __resetRunStoreForTests } from './store'

const RUN_CHALLENGE_SECRET = 'test-run-challenge-secret' // matches vitest.config.ts miniflare bindings

async function macFor(fields: ChallengeFields): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(RUN_CHALLENGE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(challengeMacMessage(fields)))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const TEST_ORIGIN = 'http://localhost:5173'
const PRIVATE_KEY_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'

/** Logs in through the real auth flow and returns the session cookie. */
async function login(): Promise<string> {
  const nonce = crypto.randomUUID()
  const now = Date.now()
  await getAuthStore(undefined).putNonce({ nonce, issuedAt: now, expiresAt: now + 5 * 60 * 1000 })
  const res = await SELF.fetch('https://example.com/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce,
      publicKeyHex: await nimiqPublicKeyFromPrivate(PRIVATE_KEY_HEX),
      signatureHex: await signNimiqSignedMessage({ message: buildLoginMessage(TEST_ORIGIN, nonce), privateKeyHex: PRIVATE_KEY_HEX }),
    }),
  })
  return (res.headers.get('Set-Cookie') ?? '').split(';')[0]!
}

function api(path: string, cookie: string, body?: unknown) {
  const init: RequestInit = { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie } }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { Cookie: cookie, 'Content-Type': 'application/json' }
  }
  return SELF.fetch(`https://example.com/api/runs${path}`, init)
}

const okTrace: InputTrace = [
  [100, 1],
  [4000, 0],
  [9000, 1],
  [14000, 0],
]

beforeEach(() => {
  __resetAuthStoreForTests()
  __resetRunStoreForTests()
})

describe('POST /api/runs/issue', () => {
  it('issues a MAC-signed challenge for the requested type', async () => {
    // #given a logged-in player
    const cookie = await login()
    // #when they request a stabilize challenge
    const res = await api('/issue', cookie, { challenge: 'stabilize' })
    // #then they get a full signed config they did not choose the seed for
    expect(res.status).toBe(200)
    const issued = (await res.json()) as IssuedChallenge
    expect(issued).toMatchObject({ challenge: 'stabilize', engineVersion: ENGINE_VERSION, difficulty: 3, durationMs: 20_000, rulesHash: RULES_HASH })
    expect(issued.seed).toMatch(/^[0-9a-f]{32}$/)
    expect(issued.mac).toMatch(/^[0-9a-f]{64}$/)
    expect(issued.startBefore).toBeGreaterThan(Date.now())
  })

  it('requires a session', async () => {
    expect((await SELF.fetch('https://example.com/api/runs/issue', { method: 'POST' })).status).toBe(401)
  })

  it('rejects an unknown challenge', async () => {
    const cookie = await login()
    expect((await api('/issue', cookie, { challenge: 'nope' })).status).toBe(400)
  })
})

describe('POST /api/runs/submit', () => {
  async function issued(cookie: string): Promise<IssuedChallenge> {
    return (await (await api('/issue', cookie, { challenge: 'stabilize' })).json()) as IssuedChallenge
  }

  it('replays the trace server-side and returns the canonical score', async () => {
    // #given an issued challenge
    const cookie = await login()
    const challenge = await issued(cookie)
    // #when the player submits an input trace
    const res = await api('/submit', cookie, { ...challenge, inputTrace: okTrace })
    // #then the score matches a direct engine replay of the same config
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; score: number; serverResultHash: string; created: boolean }
    const direct = replay({
      engineVersion: challenge.engineVersion, challenge: challenge.challenge, challengeVersion: challenge.challengeVersion,
      seed: challenge.seed, difficulty: challenge.difficulty, durationMs: challenge.durationMs, inputTrace: okTrace,
    })
    expect(body.score).toBe(direct.score)
    expect(body.serverResultHash).toBe(direct.resultHash)
    expect(body.runId).toBe(challenge.runId)
    expect(body.created).toBe(true)
  })

  it('is idempotent on the run id', async () => {
    const cookie = await login()
    const challenge = await issued(cookie)
    expect(((await (await api('/submit', cookie, { ...challenge, inputTrace: okTrace })).json()) as { created: boolean }).created).toBe(true)
    const second = (await (await api('/submit', cookie, { ...challenge, inputTrace: okTrace })).json()) as { created: boolean }
    expect(second.created).toBe(false)
  })

  it('reports whether the client-claimed result hash matches the server', async () => {
    const cookie = await login()
    const challenge = await issued(cookie)
    const direct = replay({
      engineVersion: challenge.engineVersion, challenge: challenge.challenge, challengeVersion: challenge.challengeVersion,
      seed: challenge.seed, difficulty: challenge.difficulty, durationMs: challenge.durationMs, inputTrace: okTrace,
    })
    const honest = (await (await api('/submit', cookie, { ...challenge, inputTrace: okTrace, clientResultHash: direct.resultHash })).json()) as { clientMatchesServer: boolean }
    expect(honest.clientMatchesServer).toBe(true)

    const challenge2 = await issued(cookie)
    const lying = (await (await api('/submit', cookie, { ...challenge2, inputTrace: okTrace, clientResultHash: 'f'.repeat(64) })).json()) as { clientMatchesServer: boolean }
    expect(lying.clientMatchesServer).toBe(false)
  })

  it('rejects a tampered MAC', async () => {
    const cookie = await login()
    const challenge = await issued(cookie)
    const res = await api('/submit', cookie, { ...challenge, mac: 'a'.repeat(64), inputTrace: okTrace })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'bad_mac' })
  })

  it('rejects a changed seed even though the MAC is well-formed', async () => {
    const cookie = await login()
    const challenge = await issued(cookie)
    const res = await api('/submit', cookie, { ...challenge, seed: 'deadbeefdeadbeefdeadbeefdeadbeef', inputTrace: okTrace })
    expect(res.status).toBe(401)
  })

  it('rejects a malformed trace with the validator code', async () => {
    const cookie = await login()
    const challenge = await issued(cookie)
    const res = await api('/submit', cookie, { ...challenge, inputTrace: [[5000, 1], [100, 0]] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_trace', code: 'order' })
  })

  it('rejects a validly-signed challenge whose start window has fully elapsed', async () => {
    // #given a challenge signed with a startBefore already past its duration window
    const cookie = await login()
    const template = await issued(cookie)
    const expiredFields: ChallengeFields = {
      runId: crypto.randomUUID(),
      engineVersion: template.engineVersion,
      challenge: template.challenge,
      challengeVersion: template.challengeVersion,
      seed: template.seed,
      difficulty: template.difficulty,
      durationMs: template.durationMs,
      rulesHash: template.rulesHash,
      startBefore: Date.now() - 21_000,
    }
    const expired: IssuedChallenge = { ...expiredFields, mac: await macFor(expiredFields) }
    // #when it is submitted
    const res = await api('/submit', cookie, { ...expired, inputTrace: okTrace })
    // #then it is refused as expired, not as a bad MAC
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ error: 'expired' })
  })
})

describe('GET /api/runs/:runId', () => {
  it('returns a stored run to its owner and 404s otherwise', async () => {
    const cookie = await login()
    const challenge = (await (await api('/issue', cookie, { challenge: 'sling' })).json()) as IssuedChallenge
    await api('/submit', cookie, { ...challenge, inputTrace: okTrace })

    const mine = await api(`/${challenge.runId}`, cookie)
    expect(mine.status).toBe(200)
    expect((await mine.json() as { runId: string }).runId).toBe(challenge.runId)

    expect((await api('/00000000-0000-4000-8000-000000000000', cookie)).status).toBe(404)
  })
})
