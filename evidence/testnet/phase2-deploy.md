# Phase 2 — first public deployment (TestAlbatross)

Deployed the Worker (Hono API + `RelayRoom` DO + static Vite app) to Cloudflare so
the Nimiq Pay login flow can be tested on a real phone.

## URL

`https://nim-relay.timjosh507.workers.dev`

Account `eb94a234b390bb8da04babac718d6c92` (`timjosh507@gmail.com`), Workers free
plan. `wrangler deploy` from `apps/worker/`.

## Config

- **Secrets** (`wrangler secret put`): `SESSION_SECRET`, `DEVICE_HASH_SECRET`,
  `RUN_CHALLENGE_SECRET` (fresh `openssl rand -hex 32` each), `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN` (= the workers.dev URL). Nothing
  sensitive is in `wrangler.jsonc`.
- **Vars** (`wrangler.jsonc`): `NIMIQ_NETWORK=TestAlbatross`,
  `NIMIQ_RPC_URL=https://rpc.testnet.nimiqwatch.com/`.
- **R2** (`REPLAY_BUCKET`) omitted — R2 is not enabled on the account and nothing
  reads the binding yet (added back in Phase 4+). `env.REPLAY_BUCKET` is now
  optional in the `Env` type.
- Durable Object `RelayRoom` (SQLite, migration tag `v1`) and both cron triggers
  deployed.

## Smoke (deployed)

```
GET  /api/health                    -> 200 {"ok":true,"service":"nim-relay-worker","network":"TestAlbatross"}
GET  /                              -> 200 (SPA shell)

pnpm tsx scripts/verify/auth-e2e.ts https://nim-relay.timjosh507.workers.dev https://nim-relay.timjosh507.workers.dev
  nonce -> ...
  verify -> 200 player <id> (runner-8b97a3) wallet 988D42...B97A3
  verify (replayed nonce) -> 400
  me -> 200 same player
  logout -> 200
  me (after logout) -> 401
  AUTH_E2E_PASS
```

Auth runs against the live Supabase project through the deployed Worker. Test
rows deleted afterward (players/sessions/devices/login_nonces back to 0).

## What is testable on a phone now

Open `https://nim-relay.timjosh507.workers.dev` inside **Nimiq Pay** (deep link:
`https://nimpay.app/miniapps/open/nim-relay.timjosh507.workers.dev` (or the custom scheme `nimiqpay://miniapp?url=nim-relay.timjosh507.workers.dev`)).
The screen shows a **Connect with Nimiq Pay** button that runs
connect -> `requestDeviceIdentifier` -> sign the server challenge -> `/api/auth/verify`,
then shows the signed-in handle and wallet address, with a Sign out button.
Opened in a normal browser it shows an "Open in Nimiq Pay" link instead.

This is the first real-device exercise of the Mini App SDK `sign()` path
(open verification item #3). If the SDK's signature does not verify against
`verifyNimiqSignedMessage`, capture the failing `{ publicKey, signature, message }`
from the device and reconcile the verifier — that is the point of testing it here.

Not yet built: any game, baton pass, or relay UI. Real product screens are
Phase 5-8.

## Result — real phone, 2026-09-05

Signed in successfully in Nimiq Pay on a physical iPhone over LTE. Screen showed
"Signed in / runner-204816 / F823E386D87A9352C3A85FC9CB140163FB204816 / Sign out".

Confirms:
- The Mini App SDK `sign()` output verifies against `verifyNimiqSignedMessage`
  (open verification item #3 / D-002 — resolved).
- `deriveNimiqAddress(publicKey)` produces the correct address from real Nimiq
  Pay output.
- `requestDeviceIdentifier`, the nonce round-trip, session cookie, and the live
  SupabaseAuthStore all work from a real device.
