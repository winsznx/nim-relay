# Handoff

State-of-the-build snapshot for anyone (human or agent) picking this up mid-build. Read this first, then `run-state.json` for machine-readable state, then `docs/phases/PHASE_2_SUMMARY.md` for the latest phase detail. Repo: https://github.com/winsznx/nim-relay

## Current state (2026-09-03 — resumed, tracking files re-synced to the working tree)

Phase 0: **PASS**. Phase 1: **PASS**. Phase 2: **in progress**, committed through HEAD. Deployed to `https://nim-relay.timjosh507.workers.dev` (TestAlbatross) — auth flow works end to end; the one thing left for the Phase 2 gate is a real-phone Connect run in Nimiq Pay.

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
- **Phase 1 closed** — user provided a fresh Supabase project, DB password, and `service_role` key. `0001_init.sql` and `0002_login_nonces.sql` applied via `supabase db push --db-url`; 25 tables / 10 enums verified.
- `SupabaseAuthStore` (`service_role` supabase-js over `login_nonces` / `players` / `devices` / `sessions`); `getAuthStore(env)` feature-detects `SUPABASE_SERVICE_ROLE_KEY`.
- **Auth flow verified end-to-end** against the live Supabase project and against the deployed Worker: `nonce → sign → verify` (player + session persisted) → nonce replay 400 → `me` 200 → `logout` 200 (session revoked) → `me` 401. `pnpm verify:auth [url] [origin]`; evidence in `evidence/testnet/phase2-auth-e2e.log` and `phase2-deploy.md`. Test rows cleaned up.
- **Nimiq Pay login harness** in `apps/web` (`lib/nimiq.ts`, `lib/auth-api.ts`, `App.tsx`) — Connect button runs SDK connect → device id → sign challenge → `/verify`. `/api/auth/nonce` now returns the message to sign.
- **Deployed**: `https://nim-relay.timjosh507.workers.dev` (Cloudflare Workers free plan, TestAlbatross). Secrets via `wrangler secret put`; R2 omitted (not enabled, `Env.REPLAY_BUCKET` now optional).
- 72 tests, gate green.

Credentials live only in the gitignored `.env` and `apps/worker/.dev.vars`. Redeploy: `cd apps/worker && npx wrangler deploy` (build web first: `pnpm build`).

## Immediate next step when resuming

1. **Real phone**: open `https://nim-relay.timjosh507.workers.dev` in Nimiq Pay (TestAlbatross account), tap Connect, confirm the signed-in state. If `sign()` fails `/verify`, capture the device's `{ publicKey, signature, message }` and reconcile `packages/relay-protocol/src/nimiq-verify.ts` — closes open verification item #3 and the D-002 caveat.
2. Bind `/verify` to the SDK-reported checksummed NQ address, not just the hex address derived from the public key.
3. Deep-link `/invite/<token>` path passthrough — test empirically (open verification item #2).
4. Wire `NimiqRpcClient` + `verifyHandoffTransaction` into the handoff-finalization path — mostly Phase 4.
5. Phase 9: design RLS policies for every `public` table (all currently service_role-only).

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

1. ~~Supabase credentials~~ — resolved 2026-09-03 (project, DB password, service_role key all provided; auth flow verified against the live DB).
2. Physical phone with Nimiq Pay installed (blocks Phase 2's real-device gate and everything downstream that needs a real wallet action).
3. Real NIM on MainAlbatross (blocks Phase 10 production launch only — far off, not urgent yet).

## What exists in the repo right now

- Full monorepo scaffold: `apps/web` (Vite+React+TS shell), `apps/worker` (Hono + `RelayRoom` Durable Object + R2 binding + cron stub + `src/auth/` session/nonce/device-hash primitives, uncommitted), `packages/shared` (money/state types, tested), `packages/relay-protocol` (tx-data codec per PRD §9.5 + `nimiq-rpc.ts` + `nimiq-verify.ts`, tested; last two uncommitted), `packages/game-engine` (version-binding scaffold only — real Baton Physics is Phase 3), `packages/test-utils` (placeholder).
- `supabase/migrations/0001_init.sql` — full schema, not yet live (see above).
- All 15 required control docs from PRD §0.2 (`README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `SETUP.md`, `CONTRIBUTIONS.md`, `DECISIONS.md`, `CLAIMS.md`, `TASKS.md`, `BENCHMARKS.md`, `EVIDENCE.md`, `DEMO.md`, `HANDOFF.md`, `run-state.json`, `DESIGN.md`) plus `docs/PHASE_0_VERIFICATION.md` and per-phase summaries in `docs/phases/`.
- CI (`.github/workflows/ci.yml`) mirrors the local gate: typecheck, lint, test, build.
- 38 passing unit/integration tests (money conversion, tx-data codec adversarial cases, Nimiq RPC client, Nimiq signed-message golden-vector check, session/nonce/device-hash, a real in-`workerd` health-endpoint test) — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green as of 2026-09-03.
- Public MIT repo at https://github.com/winsznx/nim-relay. Three commits: `fc2f74d` Phase 0 scaffold, `57ea824` gitignore fix, `c798da8` Phase 1. The Phase 2 work described above is uncommitted in the working tree. Local `main` matches `origin/main`.
