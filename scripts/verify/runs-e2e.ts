/**
 * Phase 4 server-verified run smoke: login -> issue -> submit -> the server
 * score matches a local engine replay -> GET the stored run -> a second
 * submit is idempotent -> a tampered seed is rejected. Runs against a live
 * Worker with the Supabase-backed stores active.
 *
 * Usage: pnpm tsx scripts/verify/runs-e2e.ts [baseUrl] [appOrigin]
 */
import { nimiqPublicKeyFromPrivate, signNimiqSignedMessage, type IssuedChallenge } from '@nim-relay/relay-protocol'
import { replay, type InputTrace } from '@nim-relay/game-engine'

const baseUrl = process.argv[2] ?? 'http://localhost:8798'
const appOrigin = process.argv[3] ?? 'http://localhost:5173'
const PRIVATE_KEY_HEX = '4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'

const trace: InputTrace = [
  [120, 1],
  [3800, 0],
  [7200, 1],
  [11050, 0],
  [15600, 1],
  [18900, 0],
]

async function login(): Promise<string> {
  const publicKeyHex = await nimiqPublicKeyFromPrivate(PRIVATE_KEY_HEX)
  const { nonce } = (await (await fetch(`${baseUrl}/api/auth/nonce`, { method: 'POST' })).json()) as { nonce: string }
  const signatureHex = await signNimiqSignedMessage({
    message: `NIM Relay login\norigin: ${appOrigin}\nnonce: ${nonce}`,
    privateKeyHex: PRIVATE_KEY_HEX,
  })
  const res = await fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, publicKeyHex, signatureHex }),
  })
  if (res.status !== 200) throw new Error(`login -> ${res.status} ${await res.text()}`)
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!
}

async function post(path: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/runs${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function main() {
  const cookie = await login()
  console.log('login -> ok')

  const issued = (await (await post('/issue', cookie, { challenge: 'stabilize' })).json()) as IssuedChallenge
  console.log(`issue -> run ${issued.runId} seed ${issued.seed}`)

  const submitRes = await post('/submit', cookie, { ...issued, inputTrace: trace })
  if (submitRes.status !== 200) throw new Error(`submit -> ${submitRes.status} ${await submitRes.text()}`)
  const result = (await submitRes.json()) as { score: number; serverResultHash: string; created: boolean }

  const local = replay({
    engineVersion: issued.engineVersion, challenge: issued.challenge, challengeVersion: issued.challengeVersion,
    seed: issued.seed, difficulty: issued.difficulty, durationMs: issued.durationMs, inputTrace: trace,
  })
  if (result.score !== local.score || result.serverResultHash !== local.resultHash) {
    throw new Error(`server/local mismatch: server ${result.score}/${result.serverResultHash} vs local ${local.score}/${local.resultHash}`)
  }
  console.log(`submit -> score ${result.score}, matches local replay, created=${result.created}`)

  const getRes = await fetch(`${baseUrl}/api/runs/${issued.runId}`, { headers: { Cookie: cookie } })
  const stored = (await getRes.json()) as { runId: string; score: number }
  if (getRes.status !== 200 || stored.runId !== issued.runId || stored.score !== result.score) {
    throw new Error(`get -> ${getRes.status} ${JSON.stringify(stored)}`)
  }
  console.log('get -> 200 same run and score')

  const again = (await (await post('/submit', cookie, { ...issued, inputTrace: trace })).json()) as { created: boolean }
  if (again.created !== false) throw new Error('second submit should be idempotent (created=false)')
  console.log('resubmit -> idempotent (created=false)')

  const tampered = await post('/submit', cookie, { ...issued, seed: 'deadbeefdeadbeefdeadbeef00000000', inputTrace: trace })
  if (tampered.status !== 401) throw new Error(`tampered seed should be 401, got ${tampered.status}`)
  console.log('tampered seed -> 401 as expected')

  console.log(`\nRUNS_E2E_PASS run=${issued.runId} score=${result.score}`)
}

await main()
