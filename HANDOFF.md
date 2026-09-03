# Handoff

State-of-the-build snapshot for anyone (human or agent) picking this up mid-build. Read this first, then `run-state.json` for machine-readable state, then `docs/phases/PHASE_2_SUMMARY.md` for the latest phase detail. Repo: https://github.com/winsznx/nim-relay

## Current state (2026-09-03 — resumed, tracking files re-synced to the working tree)

Phase 0: **PASS**. Phase 1: **PASS** (code `c798da8`; migrations applied to the fresh Supabase project 2026-09-03). Phase 2: **in progress**, committed through HEAD.

A prior session committed Phase 1 and then did a chunk of Phase 2 work without updating `run-state.json` / `TASKS.md` / a phase summary. That has now been reconstructed from the working tree and written back. Gate is green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, 38 tests (up from 13).

Phase 2 done so far (all uncommitted, on top of `c798da8`):
- `packages/relay-protocol/src/nimiq-rpc.ts` — first-party plain-`fetch` JSON-RPC client (`getBlockNumber`, `getTransactionByHash` + typed `TransactionNotFoundError`).
- `packages/relay-protocol/src/nimiq-verify.ts` — pure-JS Nimiq signed-message verify + Blake2b address derivation, cross-checked against a golden vector from the real `@nimiq/core` build (`evidence/testnet/phase2-nimiq-signature-vector.md`).
- `apps/worker/src/auth/` — `session.ts` (HMAC session cookie), `nonce.ts` (login nonce + message shape), `device-hash.ts` (peppered device-id hash), all with tests.
- `scripts/verify/nimiq-rpc-spike.ts` + `evidence/testnet/phase2-nimiq-rpc-spike.log`.
- `DECISIONS.md` D-006 — both RPC endpoints network-confirmed.
- deps: `@noble/ed25519`, `@noble/hashes`.

Full detail: `docs/phases/PHASE_2_SUMMARY.md`.

## Done since resuming (commits `6eb4269` … HEAD)

- `6eb4269` — reconstructed the earlier session's uncommitted Phase 2 work.
- `7ef422e` — `/api/auth` routes (`nonce` / `verify` / `logout` / `me`), `requireSession` middleware, `AuthStore` port + `InMemoryAuthStore`, `verifyHandoffTransaction` (pure PRD §9.6, 18 adversarial cases).
- **Phase 1 closed** — user provided a fresh Supabase project + DB password. `0001_init.sql` and `0002_login_nonces.sql` applied via `supabase db push --db-url`; 25 tables / 10 enums verified; rolled-back `pg` smoke of the full auth flow. Evidence: `evidence/testnet/phase1-supabase-migration.md`.
- `SupabaseAuthStore` (`service_role` supabase-js over `login_nonces` / `players` / `devices` / `sessions`); `getAuthStore(env)` feature-detects `SUPABASE_SERVICE_ROLE_KEY`. 72 tests, gate green.

Credentials live only in the gitignored `.env`. `apps/worker/.dev.vars.example` shows how to point local `wrangler dev` at the real project.

## Immediate next step when resuming

1. **Get the Supabase `service_role` key from the user** (dashboard → Project Settings → API — the `sb_publishable_…` key they gave is not enough, RLS is on with no policies). Put it in `apps/worker/.dev.vars` (local) and `wrangler secret put` (deploy). That flips `getAuthStore()` onto `SupabaseAuthStore`; then run `/api/auth/nonce → verify → me → logout` against the live DB and capture evidence.
2. Web-side Nimiq Mini App SDK bridge (SDK init, device identifier prompt, account list, `sign`). Non-device code + mock test can land first; real-device acceptance gate needs the physical phone.
3. Bind `/verify` to the SDK-reported checksummed NQ address, not just the hex address derived from the public key.
4. Open verification item: Nimiq Pay deep-link `/invite/<token>` path passthrough — test empirically.
5. Phase 2 **gate** needs the physical Nimiq Pay device (user blocker) for the real `sign()` / SDK acceptance checks.
6. Phase 9: design RLS policies for every `public` table (all currently service_role-only).

## Two real bugs/toolchain issues found and fixed this session (don't reintroduce)

1. **`@nimiq/core` cannot be imported inside the Cloudflare Worker.** Empirically confirmed (`wasm2.__wbindgen_start is not a function` under real `workerd`). Backend Nimiq transaction verification uses plain JSON-RPC-over-HTTPS instead. Full writeup: `DECISIONS.md` D-001.
2. **`RelayRoom.webSocketClose` must not call `ws.close()` again** — it's a notification-only handler; doing so throws `InvalidAccessError` on a real disconnect (code 1005). Fixed; see `DECISIONS.md` D-005. Caught only by a *live* smoke test, not the unit test — keep doing live `wrangler dev` smoke passes for anything Hibernation-API-related, unit tests alone won't catch this class of bug.
3. **Toolchain churn**: `@cloudflare/vitest-pool-workers` is effectively dead for this stack right now (broken under Node 24.19, and Cloudflare has moved to `@cloudflare/vitest-plugin` for Vitest v4). Already migrated — see `DECISIONS.md` D-004. If a future `pnpm install` silently reverts this via a stale lockfile entry, that's a regression, not a preference.

## Open Nimiq verification items (all deferred to Phase 2 on purpose, not forgotten)

1. **RESOLVED** (`DECISIONS.md` D-006) — `rpc.nimiqwatch.com` = MainAlbatross, `rpc.testnet.nimiqwatch.com` = TestAlbatross, confirmed by live block-height cross-referencing in both directions.
2. **OPEN** — whether `/invite/<token>`-style nested paths survive the Nimiq Pay deep-link opener round-trip. Not yet tested.
3. **PARTIALLY RESOLVED** — the message-signing byte layout is cross-checked against a golden vector from the real `@nimiq/core` build (`evidence/testnet/phase2-nimiq-signature-vector.md`, verified by `packages/relay-protocol/src/nimiq-verify.ts`). Still open: confirming the Mini App SDK `sign()` path on a real physical device follows the same construction end to end.

Full detail: `docs/phases/PHASE_2_SUMMARY.md`, `docs/PHASE_0_VERIFICATION.md` §7, `DECISIONS.md` D-001/D-002/D-006.

## Outstanding user-owned blockers (see `run-state.json`)

1. Supabase `service_role` key (blocks activating `SupabaseAuthStore` / running the auth flow against the live DB). Project + DB password + migrations are done.
2. Physical phone with Nimiq Pay installed (blocks Phase 2's real-device gate and everything downstream that needs a real wallet action).
3. Real NIM on MainAlbatross (blocks Phase 10 production launch only — far off, not urgent yet).

## What exists in the repo right now

- Full monorepo scaffold: `apps/web` (Vite+React+TS shell), `apps/worker` (Hono + `RelayRoom` Durable Object + R2 binding + cron stub + `src/auth/` session/nonce/device-hash primitives, uncommitted), `packages/shared` (money/state types, tested), `packages/relay-protocol` (tx-data codec per PRD §9.5 + `nimiq-rpc.ts` + `nimiq-verify.ts`, tested; last two uncommitted), `packages/game-engine` (version-binding scaffold only — real Baton Physics is Phase 3), `packages/test-utils` (placeholder).
- `supabase/migrations/0001_init.sql` — full schema, not yet live (see above).
- All 15 required control docs from PRD §0.2 (`README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `SETUP.md`, `CONTRIBUTIONS.md`, `DECISIONS.md`, `CLAIMS.md`, `TASKS.md`, `BENCHMARKS.md`, `EVIDENCE.md`, `DEMO.md`, `HANDOFF.md`, `run-state.json`, `DESIGN.md`) plus `docs/PHASE_0_VERIFICATION.md` and per-phase summaries in `docs/phases/`.
- CI (`.github/workflows/ci.yml`) mirrors the local gate: typecheck, lint, test, build.
- 38 passing unit/integration tests (money conversion, tx-data codec adversarial cases, Nimiq RPC client, Nimiq signed-message golden-vector check, session/nonce/device-hash, a real in-`workerd` health-endpoint test) — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green as of 2026-09-03.
- Public MIT repo at https://github.com/winsznx/nim-relay. Three commits: `fc2f74d` Phase 0 scaffold, `57ea824` gitignore fix, `c798da8` Phase 1. The Phase 2 work described above is uncommitted in the working tree. Local `main` matches `origin/main`.
