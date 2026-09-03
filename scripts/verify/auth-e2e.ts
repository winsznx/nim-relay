/**
 * Phase 2 auth flow smoke: nonce -> sign -> verify -> me -> logout -> me,
 * against a running Worker. Run with the Supabase-backed store active
 * (apps/worker/.dev.vars with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) to
 * exercise the real database path. Not part of CI - needs a live Worker.
 *
 * Usage: pnpm tsx scripts/verify/auth-e2e.ts [baseUrl] [appOrigin]
 */
import {
  nimiqPublicKeyFromPrivate,
  signNimiqSignedMessage,
} from '@nim-relay/relay-protocol'

const baseUrl = process.argv[2] ?? 'http://localhost:8798'
const appOrigin = process.argv[3] ?? 'http://localhost:5173'
const PRIVATE_KEY_HEX = '4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'

function loginMessage(nonce: string): string {
  return `NIM Relay login\norigin: ${appOrigin}\nnonce: ${nonce}`
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie')
  if (!raw) throw new Error('no Set-Cookie on verify response')
  return raw.split(';')[0]!
}

async function main() {
  const publicKeyHex = await nimiqPublicKeyFromPrivate(PRIVATE_KEY_HEX)

  const nonceRes = await fetch(`${baseUrl}/api/auth/nonce`, { method: 'POST' })
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  console.log(`nonce -> ${nonce}`)

  const signatureHex = await signNimiqSignedMessage({ message: loginMessage(nonce), privateKeyHex: PRIVATE_KEY_HEX })

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, publicKeyHex, signatureHex }),
  })
  if (verifyRes.status !== 200) throw new Error(`verify -> ${verifyRes.status} ${await verifyRes.text()}`)
  const verifyBody = (await verifyRes.json()) as { player: { id: string; handle: string; walletAddress: string } }
  const cookie = cookieFrom(verifyRes)
  console.log(`verify -> 200 player ${verifyBody.player.id} (${verifyBody.player.handle}) wallet ${verifyBody.player.walletAddress}`)

  const replayRes = await fetch(`${baseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, publicKeyHex, signatureHex }),
  })
  if (replayRes.status !== 400) throw new Error(`nonce replay should be 400, got ${replayRes.status}`)
  console.log('verify (replayed nonce) -> 400 as expected')

  const meRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  const meBody = (await meRes.json()) as { player?: { id: string } }
  if (meRes.status !== 200 || meBody.player?.id !== verifyBody.player.id) {
    throw new Error(`me -> ${meRes.status} ${JSON.stringify(meBody)}`)
  }
  console.log('me -> 200 same player')

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
  if (logoutRes.status !== 200) throw new Error(`logout -> ${logoutRes.status}`)
  console.log('logout -> 200')

  const meAfter = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })
  if (meAfter.status !== 401) throw new Error(`me after logout should be 401, got ${meAfter.status}`)
  console.log('me (after logout) -> 401 as expected')

  console.log(`\nAUTH_E2E_PASS player=${verifyBody.player.id}`)
}

await main()
