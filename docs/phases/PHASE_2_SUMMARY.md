# Phase 2 Summary — Nimiq bridge and session

**Status: IN PROGRESS.** Reconstructed on 2026-09-03 from the working tree — the prior
session did this work on top of the Phase 1 commit (`c798da8`) but did not update
`run-state.json`, `TASKS.md`, or write this summary. Nothing here is committed yet.

## Objective
Nimiq Mini App SDK bridge, login-challenge signing/verification, session cookies,
device-identifier handling, and an independent backend transaction verifier — the
trust boundary from PRD §9.6, §11, §32.

## Done so far (working tree, uncommitted)

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
- **`store.ts` (+ `store.test.ts`)** — `AuthStore` port (nonces, players, sessions)
  with an `InMemoryAuthStore` for local `wrangler dev` and tests. The Supabase-
  backed implementation lands with the fresh project's credentials; route and
  middleware code depends only on the interface.
- **`nimiq-verify.ts`** gained `signNimiqSignedMessage` / `nimiqPublicKeyFromPrivate`
  (offline tooling + tests only — not on the trust path).
- `apps/worker`: `env.ts` gains `APP_ORIGIN`; `wrangler.jsonc` gains a dev/test
  `vars` block; `.env.example` documents `APP_ORIGIN`.
- Live `wrangler dev` smoke: `/api/auth/nonce` → 200, `/verify` bad body → 400,
  `/me` no cookie → 401.

### Decisions
- **D-006** — both Nimiq RPC endpoints confirmed by network in both directions
  (MainAlbatross `rpc.nimiqwatch.com`, TestAlbatross `rpc.testnet.nimiqwatch.com`),
  via live block-height cross-referencing against nimiq.watch's explorer API. Closes
  Phase 0's first open verification item.

## Gate status as of 2026-09-03
```
pnpm typecheck  PASS
pnpm lint       PASS  (0 errors, 0 warnings)
pnpm test       PASS  (66 passing, 0 failing)   [13 at end of Phase 1]
pnpm build      PASS
```

## Open verification items
1. **RESOLVED (D-006)** — RPC network identity.
2. **OPEN** — Nimiq Pay deep-link path/query passthrough for `/invite/<token>` URLs.
   Not yet tested.
3. **PARTIALLY RESOLVED** — message-signing byte layout matches the real `@nimiq/core`
   build for a generated keypair. Still open: confirming the Mini App SDK `sign()`
   path on a **real physical device** produces a signature that verifies through the
   same construction end to end.

## Remaining Phase 2 work
- Swap `InMemoryAuthStore` for a Supabase-backed `AuthStore` once credentials land
  (players / sessions / login_nonces). Blocked on `supabase-credentials`.
- Wire `NimiqRpcClient` + `verifyHandoffTransaction` into the handoff-finalization
  path (the RPC lookup + retry/confirmation-wait loop that calls the pure verifier).
  Most of this is Phase 4 (relay protocol), but the verifier and client are ready.
- Web-side Nimiq Mini App SDK bridge (SDK init, device identifier prompt, account
  list, `sign`). Real-device acceptance gate is blocked on the physical-phone
  blocker; the non-device code and a mock-backed test can land first.
- Bind the `/verify` route to the SDK-reported NQ address (checksummed
  user-friendly form) rather than only the hex address derived from the public key.
- Deep-link `/invite/<token>` passthrough test (open verification item 2).

## Blockers
- `physical-nimiq-pay-device` (user-owned) — blocks the Phase 2 **gate**, not the
  non-device work above.
- `supabase-credentials` (user-owned) — still the open Phase 1 gate item; the auth
  `verify` route's player upsert and session persistence need the live DB.

## Result: IN PROGRESS
