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

### Decisions
- **D-006** — both Nimiq RPC endpoints confirmed by network in both directions
  (MainAlbatross `rpc.nimiqwatch.com`, TestAlbatross `rpc.testnet.nimiqwatch.com`),
  via live block-height cross-referencing against nimiq.watch's explorer API. Closes
  Phase 0's first open verification item.

## Gate status as of 2026-09-03
```
pnpm typecheck  PASS
pnpm lint       PASS  (0 errors, 0 warnings)
pnpm test       PASS  (38 passing, 0 failing, 13 files)   [was 13 at end of Phase 1]
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
- Wire the auth primitives into Worker routes: `POST /api/auth/nonce` →
  `POST /api/auth/verify` (verify signed message, upsert player, create session, set
  cookie) → session middleware → `POST /api/auth/logout`.
- Backend transaction verifier module composing `NimiqRpcClient` into the full
  PRD §9.6 check (hash / sender / recipient / value / data commitment / network /
  inclusion state) with adversarial tests (wrong recipient, wrong value, wrong
  network, not-yet-included, reorg'd out).
- Web-side Nimiq Mini App SDK bridge (SDK init, device identifier prompt, account
  list, `sign`). Real-device acceptance gate is blocked on the physical-phone
  blocker; the non-device code and a mock-backed test can land first.
- Deep-link passthrough test (item 2 above).

## Blockers
- `physical-nimiq-pay-device` (user-owned) — blocks the Phase 2 **gate**, not the
  non-device work above.
- `supabase-credentials` (user-owned) — still the open Phase 1 gate item; the auth
  `verify` route's player upsert and session persistence need the live DB.

## Result: IN PROGRESS
