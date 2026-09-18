> This document describes an earlier stage of NIM Relay (as of Phase 2, 2026-09-03) and is kept for historical record. See README.md for the current system.

# Phase 2 Summary — Nimiq bridge and session

**Status: IN PROGRESS.** RPC client, signed-message verify, session/nonce/device
primitives, `/api/auth` routes, the backend tx verifier, the Supabase-backed
store, and a Nimiq Pay login harness are committed. The auth flow is verified
end-to-end against the live Supabase project **and against the deployed Worker**
(`https://nim-relay.timjosh507.workers.dev`). Remaining: the real-phone Connect
run (open verification item #3), NQ-address binding, and the deep-link test.

## Objective
Nimiq Mini App SDK bridge, login-challenge signing/verification, session cookies,
device-identifier handling, and an independent backend transaction verifier — the
trust boundary from PRD §9.6, §11, §32.

## Done so far

### `packages/relay-protocol`
- **`src/nimiq-rpc.ts` (+ `nimiq-rpc.test.ts`)** — first-party JSON-RPC client over plain
  `fetch()`, scoped to only `getBlockNumber` and `getTransactionByHash`. Typed
  `NimiqTransaction`, `NimiqRpcError`, and a distinct `TransactionNotFoundError` so
  callers never confuse "not on chain" with "network failed". `AbortController`
  timeout (8s default). No `@nimiq/core`, no WASM — see `DECISIONS.md` D-001.
- **`src/nimiq-verify.ts` (+ `nimiq-verify.test.ts`)** — pure-JS Nimiq signed-message
  verification: `0x16 ++ "Nimiq Signed Message:\n" ++ decimalAsciiLen ++ message`,
  SHA-256, Ed25519 verify via `@noble/ed25519`; `deriveNimiqAddress` = first 20 bytes
  of Blake2b-256 of the public key. `verifyNimiqSignedMessage` never throws on
  malformed input, returns `false`. Cross-checked byte-for-byte against a golden
  vector generated from the real `@nimiq/core@2.21.0` Node build
  (`evidence/testnet/phase2-nimiq-signature-vector.md`, `VECTOR_CHECK_PASS`).
- deps added: `@noble/ed25519@3.2.0`, `@noble/hashes@2.4.0`.
- `src/index.ts` now re-exports both modules.

### `apps/worker/src/auth/`
- **`session.ts` (+test)** — HMAC-SHA256-signed opaque session token
  (`sessionId.playerId.sig`), `nr_session` cookie with `HttpOnly; Secure;
  SameSite=Lax; Max-Age=30d`, timing-safe signature compare, cookie read/clear
  helpers. DB `sessions` row stays the revocation source of truth (PRD §11.6).
- **`nonce.ts` (+test)** — single-use login nonce (`crypto.randomUUID`), 5-minute TTL,
  and `buildLoginMessage(origin, nonce)` — the exact origin-bound + nonce-bound
  string the user signs (PRD §11.4 / §32.3). Nonce storage is wired in Phase 4
  alongside the rest of the protocol storage layer; this module fixes the contract.
- **`device-hash.ts` (+test)** — `hashDeviceId` = HMAC-SHA256(pepper, rawDeviceId) as
  hex. Raw Nimiq Pay device identifier is never persisted (PRD §11.5).

### Scripts / evidence
- **`scripts/verify/nimiq-rpc-spike.ts`** — live dual-network RPC spike, run manually
  (needs real network, not in CI). Evidence: `evidence/testnet/phase2-nimiq-rpc-spike.log`
  (`NIMIQ_RPC_SPIKE_PASS`).

### Backend transaction verifier (`packages/relay-protocol`)
- **`src/verify-transaction.ts` (+ `verify-transaction.test.ts`)** — the pure PRD §9.6
  decision function `verifyHandoffTransaction(tx, expected)`. Checks sender,
  recipient, no self-transfer, value (Luna, bigint-exact), the `NR1` tx-data
  commitment (relay code / leg / 128-bit commitment, via `decodeTxData`), network
  (with RPC alias tolerance), inclusion, execution result, and confirmation depth.
  Returns a discriminated `{ ok: true, confirmations, blockNumber } | { ok: false,
  reason, detail }` — never throws on hostile input. 18 adversarial cases (wrong
  sender/recipient/value, unparseable value, malformed/missing data, cross-relay
  and cross-leg commitment replay, wrong/absent network, not-included, reverted,
  under-confirmed, exact-threshold).

### Auth routes (`apps/worker/src/auth/`)
- **`routes.ts` (+ `routes.test.ts`)** — Hono sub-app mounted at `/api/auth`:
  `POST /nonce` (issue + persist single-use challenge), `POST /verify` (zod body
  validation → consume nonce → expiry check → `verifyNimiqSignedMessage` over the
  origin+nonce-bound message → derive wallet address from the public key → find-or-
  create player → hash device id → create session → set `nr_session` cookie),
  `POST /logout` (revoke + clear cookie), `GET /me`. 12 route tests via real
  `workerd` (`SELF.fetch`), including single-use/replay, expiry, wrong-message
  signature, forged cookie, and full login→me→logout lifecycle.
- **`middleware.ts`** — `requireSession`: HMAC signature check as the cheap gate,
  store lookup as the authority for revocation/expiry (PRD §11.6); clears the
  cookie and 401s on an expired/revoked session.
- **`store.ts` (+ `store.test.ts`)** — `AuthStore` port (nonces, players, sessions).
  `getAuthStore(env)` returns `SupabaseAuthStore` when `SUPABASE_SERVICE_ROLE_KEY`
  is set, else `InMemoryAuthStore` (local `wrangler dev` without secrets, tests).
- **`supabase-store.ts` (+ `supabase-store.test.ts`)** — `SupabaseAuthStore`: a
  `service_role` supabase-js client over `login_nonces` / `players` / `devices` /
  `sessions`. Single-use nonce via `delete … returning`, handle-collision retry on
  `23505`, device upsert then a linked session row, idempotent revoke
  (`where revoked_at is null`). 6 tests against a PostgREST-builder fake.
  Needs `0002_login_nonces.sql` (added this phase, applied to the live project).
- **`nimiq-verify.ts`** gained `signNimiqSignedMessage` / `nimiqPublicKeyFromPrivate`
  (offline tooling + tests only — not on the trust path).
- `apps/worker`: `env.ts` gains `APP_ORIGIN`; `wrangler.jsonc` gains a dev/test
  `vars` block; `.env.example` documents `APP_ORIGIN`.
- Live `wrangler dev` smoke: `/api/auth/nonce` → 200, `/verify` bad body → 400,
  `/me` no cookie → 401.
- **End-to-end against the live Supabase project** (`SupabaseAuthStore` active via
  `apps/worker/.dev.vars`): `nonce → sign → verify` (200, player + session rows
  persisted) → nonce replay 400 → `me` 200 → `logout` 200 (session `revoked_at`
  set) → `me` 401. `scripts/verify/auth-e2e.ts` (`pnpm verify:auth`);
  `evidence/testnet/phase2-auth-e2e.log`. Test rows cleaned up afterward.
  `vitest.config.ts` pins the Supabase bindings empty so unit tests never leave
  the in-memory store.

### Nimiq Pay login harness (`apps/web`) + deployment
- **`/api/auth/nonce`** now returns `{ nonce, message, expiresAt }` — the client
  signs the exact server-built message, so it needs no client-side knowledge of
  `APP_ORIGIN` and origin/message drift is impossible.
- **`src/lib/nimiq.ts`** — `@nimiq/mini-app-sdk` wrappers: `isInsideNimiqPay()`,
  `connectAccount()` (`listAccounts`), `signMessage()` (`sign` → `{publicKey,
  signature}`, unwraps the SDK's `{error}` shape), `deviceIdentifier()`
  (`requestDeviceIdentifier`), `nimiqPayDeepLink()`.
- **`src/lib/auth-api.ts`** — typed `/api/auth` client.
- **`src/app/App.tsx`** — login harness (real screens are Phase 5-8): inside Nimiq
  Pay → **Connect with Nimiq Pay** runs connect → device id → sign challenge →
  `/verify` → signed-in state (handle + wallet) + Sign out; outside Nimiq Pay →
  "Open in Nimiq Pay" deep link (PRD §20.3). `me` via react-query, login/logout
  as mutations.
- **Deployed** to `https://nim-relay.timjosh507.workers.dev` (Workers free plan,
  TestAlbatross). Secrets via `wrangler secret put`; R2 binding omitted (not
  enabled, unused — `Env.REPLAY_BUCKET` now optional). `auth-e2e` passes against
  the deployed Worker + live Supabase. `evidence/testnet/phase2-deploy.md`.

### Decisions
- **D-006** — both Nimiq RPC endpoints confirmed by network in both directions
  (MainAlbatross `rpc.nimiqwatch.com`, TestAlbatross `rpc.testnet.nimiqwatch.com`),
  via live block-height cross-referencing against nimiq.watch's explorer API. Closes
  Phase 0's first open verification item.

## Gate status as of 2026-09-03
```
pnpm typecheck  PASS
pnpm lint       PASS  (0 errors, 0 warnings)
pnpm test       PASS  (72 passing, 0 failing)   [13 at end of Phase 1]
pnpm verify:auth PASS  (AUTH_E2E_PASS, live Supabase - evidence/testnet/phase2-auth-e2e.log)
pnpm build      PASS
deployed        https://nim-relay.timjosh507.workers.dev  (health 200, auth-e2e PASS - evidence/testnet/phase2-deploy.md)
```

## Open verification items
1. **RESOLVED (D-006)** — RPC network identity.
2. **OPEN** — Nimiq Pay deep-link path/query passthrough for `/invite/<token>` URLs.
   Not yet tested.
3. **OPEN, ready to close on a phone** — the Mini App SDK `sign()` path. The login
   harness is deployed; opening it in Nimiq Pay and tapping Connect exercises
   `sign()` end to end against `verifyNimiqSignedMessage`. If it fails, capture the
   device's `{ publicKey, signature, message }` and reconcile the verifier.

## Remaining Phase 2 work
- **Real-phone Connect run** against the deployed Mini App (item #3 above).
- Wire `NimiqRpcClient` + `verifyHandoffTransaction` into the handoff-finalization
  path — mostly Phase 4 (relay protocol); the verifier and client are ready.
- Bind `/verify` to the SDK-reported checksummed NQ address rather than only the
  hex address derived from the public key.
- Deep-link `/invite/<token>` passthrough test (item #2).

## Blockers
- `physical-nimiq-pay-device` (user-owned) — blocks the Phase 2 **gate**, not the
  non-device work above.
- `supabase-service-role-key` — **resolved 2026-09-03**; the auth flow runs against
  the live DB. For deploy, set the Supabase secrets with `wrangler secret put`.

## Result: IN PROGRESS
