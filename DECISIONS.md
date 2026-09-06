# Decisions

Architectural decisions and rejected alternatives, recorded as they happen. Newest first.

---

## D-009 — Playable layer redesigned as one "Relay Run"; relay-protocol work paused behind a gameplay quality gate

**Date:** 2026-09-06 (Phase 4)
**Status:** Locked — Phase 5 blocked until the gate passes

**Context.** The five deterministic challenges (`stabilize`, `slipstream`, `pulse-sync`,
`sling`, `redline`) shipped and are correct, but on inspection they are five variations of
"hold/release one scalar toward a moving target" — no spatial world, no route decisions,
no second system, a flat skill ceiling. Benchmarked against the two ecosystem projects
that set the bar (`nimjump/game`, `harlski/nspace`) they are not competitive: those are
mature live services with dense arcade loops, quests/streaks, staked async 1v1, ghost/
spectating, persistence, and deep operations. Full audit: `docs/GAMEPLAY_BENCHMARK_AUDIT.md`.

**Decision.**
1. **Stop relay-protocol implementation** (the Phase 4 state machine / DO / handoff /
   chain-verification) until the game is fixed. Slice 1 (server-issued challenges +
   server replay + `game_runs`) is committed and preserved.
2. **Redesign the playable layer** as one continuous 45–75s **Relay Run** (`docs/RELAY_GAME_V2.md`):
   the five challenge concepts become integrated *systems* inside a single leg (Catch,
   Slipstream traversal, Stabilize turbulence, Pulse Sync rhythm, Redline emergent risk,
   Sling = the NIM handoff itself), with the previous runner's verified trace as a live
   race ghost, a seed+region+state content generator (no authored levels), baton lineage
   as verified-history progression, and Relay Echoes.
3. **Preserve every determinism/anti-cheat guarantee.** Engine `1.0.0` + its corpus stay
   frozen (D-008). V2 is a new `relay-run` composite challenge at `challengeVersion`
   `2.0.0` with its own committed cross-runtime corpus. Input stays binary transitions
   (one thumb). `/api/runs` server replay is unchanged.
4. **A 10-point Gameplay Quality Gate** (RELAY_GAME_V2.md §9) must pass before Phase 5.
   The bar: if NimJump and Nimiq Space re-entered this round unchanged, NIM Relay would
   still deserve first place on product experience.

**Cost.** Discards the *five-standalone-challenges* product framing (not the engine, not
the anti-cheat, not the schema). The `/play` route stays live as-is until V2 replaces it.

---

## D-008 — Baton Physics engine built via a delegated agent on a branch, gated on determinism

**Date:** 2026-09-06 (Phase 3)
**Status:** Locked; engine `1.0.0` is version-frozen

**Context.** The user wanted the game engine + playable challenges built by a
second agent (Codex) so this session could keep the relay/backend work moving.
The engine is the anti-cheat trust boundary (PRD §7.7 — the Worker re-runs it to
verify every score), so a "make it fun" delegation would have been unsafe.

**Decision.** The delegated build was scoped by a one-shot brief whose headline
constraint was determinism, with hard boundaries: touch only
`packages/game-engine/` + `apps/web/src/game/`, work on a `game-engine` branch,
no push, no deploy, no backend/social/wallet features, spec = PRD §7–8 +
`DESIGN.md`. The result was reviewed here before merge against: byte-level
determinism (BigInt fixed-point, integer PRNG, no `Math`/`Date`/random/DOM),
cross-runtime parity (Node / `workerd` / Chromium / WebKit on a 200-case
committed corpus), mutation testing, boundary compliance, and that the `/play`
client consumes the real engine with no forked physics. It passed and was
fast-forward merged to `main` (`601369e`, `76ce4e7`).

**Consequence.** `packages/game-engine` v1 (`ENGINE_VERSION = '1.0.0'`), its
scoring, and `tests/corpus/expected.json` are immutable. Gameplay tuning — which
is expected once a human playtests — must add a new `challengeVersion` handler
and a fresh corpus, never edit v1. Old runs stay replayable by their recorded
version (§7.3).

**Not verified.** Gameplay feel (no human has played the five challenges) and
physical iOS Nimiq Pay WebView 60fps (headless Chromium only).

---

## D-007 — First deployment is a `workers.dev` TestAlbatross target; config via secrets, R2 deferred

**Date:** 2026-09-03 (Phase 2)
**Status:** Locked for TestAlbatross; revisit at Phase 10 for MainAlbatross production

**Context.** The user asked for a deployment they can test in Nimiq Pay on a real phone. Phase 2's gate does not require a public deploy, but the Mini App SDK `sign()` path (open verification item #3) can only be exercised inside the real Nimiq Pay WebView, which needs a public HTTPS origin.

**Decisions.**

1. **Target.** Deploy to `https://nim-relay.timjosh507.workers.dev` on the Workers free plan (account `eb94a234b390bb8da04babac718d6c92`). This is the TestAlbatross staging/test target, not production. Phase 10 stands up MainAlbatross production, most likely on a custom domain.

2. **All environment-specific and sensitive config is set with `wrangler secret put`, not `vars` in `wrangler.jsonc`.** Secrets shadow vars of the same name, so `wrangler.jsonc` keeps only non-sensitive shared values (`NIMIQ_NETWORK`, `NIMIQ_RPC_URL`) and nothing in git needs real values. `SESSION_SECRET` / `DEVICE_HASH_SECRET` / `RUN_CHALLENGE_SECRET` are fresh `openssl rand -hex 32`; `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `APP_ORIGIN` are the real values. Local `wrangler dev` reads the same names from the gitignored `apps/worker/.dev.vars` (see `.dev.vars.example`); `vitest.config.ts` pins deterministic test values via `miniflare.bindings`.

3. **The R2 binding (`REPLAY_BUCKET`) is omitted from the deploy.** R2 is not enabled on the account (`code: 10042`, needs a dashboard opt-in + payment method), and nothing reads the binding until replay-artifact storage is built in Phase 4+. `Env.REPLAY_BUCKET` is now optional. Rejected: enabling R2 now just to satisfy an unused binding, or blocking the deploy on it.

4. **`/api/auth/nonce` returns the full message to sign** (`{ nonce, message, expiresAt }`), so the client signs exactly what the server will verify and never needs to know `APP_ORIGIN`. This removes origin/message drift as a failure mode across environments.

5. **Nimiq Pay deep link format**, from `nimiq.dev/mini-apps` (2026-09-03): HTTPS form `https://nimpay.app/miniapps/open/<host>` (scheme stripped from the target), custom-scheme form `nimiqpay://miniapp?url=<host>`. `nimiqPayDeepLink()` uses the HTTPS form. An earlier guess (`pay.nimiq.com/mini-app?url=`) was wrong and is corrected. Whether a path/query after the host (the `/invite/<token>` case) survives the round-trip is still undocumented — that remains open verification item #2, to test on a device.

---

## D-001 — Backend Nimiq transaction verification uses plain JSON-RPC-over-HTTPS, not `@nimiq/core`

**Date:** 2026-09-01 (Phase 0)
**Status:** Locked, pending Phase 2 network-identity confirmation (see Open Item below)

**Context.** PRD §9.6 requires: "Use the current canonical Nimiq Web Client or current official Nimiq RPC path that is proven compatible with Cloudflare Workers. Do not assume package compatibility. Phase 0 must test the chosen verifier inside the actual Worker runtime."

**What was tested.** A minimal Hono Worker was built (`compatibility_date: 2026-08-04`, `nodejs_compat` enabled) importing `@nimiq/core@2.21.0` and run under real `wrangler dev` (local `workerd`). Hitting the route produced:

```text
TypeError: wasm2.__wbindgen_start is not a function
  at node_modules/@nimiq/core/bundler/main-wasm/index.js
```

`npm install` for the package also pulled in `bufferutil`/`utf-8-validate` — native `node-gyp-build` addons used by the Node.js `ws` stack — an independent signal the package targets Node's native module system, not `workerd`. Official Nimiq docs never claim Workers/edge-runtime support for `@nimiq/core`; the client is architecturally a P2P-syncing light client (`waitForConsensusEstablished()`), which is also the wrong execution shape for a stateless per-request Worker even if the WASM issue were fixed.

Evidence: `evidence/local/phase0-nimiq-core-workerd-spike.log`, `evidence/local/phase0-nimiq-core-workerd-spike-result.json`.

**Decision.** The Worker never imports `@nimiq/core`. Backend transaction verification (PRD §9.6: independently retrieve a transaction by hash and verify hash/sender/recipient/value/data/network/inclusion state) is implemented as a small first-party typed JSON-RPC-over-HTTPS client in `packages/relay-protocol`, calling a Nimiq Albatross RPC node with plain `fetch()`. This requires no WASM, no native modules, and no `nodejs_compat` shims for the RPC path itself.

Verified empirically that a public Nimiq RPC responds correctly to plain JSON-RPC over HTTPS:

```text
POST https://rpc.nimiqwatch.com  {"jsonrpc":"2.0","method":"getBlockNumber","params":[],"id":1}
→ {"jsonrpc":"2.0","result":{"data":60469309,...}}
```
Called twice ~10s apart; block number incremented, confirming a live synced node.

**Rejected alternative: `nimiq-rpc-client-ts` (community package).** A typed HTTP/WS JSON-RPC client exists (`onmax/albatross-rpc-client-ts`) that would give the same fetch-based approach with less code. Rejected for the trust-critical verification path specifically because it is not an official Nimiq-org package, and the PRD's non-negotiable invariant is that the server independently verifies the Nimiq transaction (§54 item 6) — that logic should have the smallest possible third-party surface. NIM Relay writes its own minimal typed client scoped only to the methods it needs (block/transaction lookup). This is not a blanket rejection of community packages elsewhere in the stack, only for this specific trust boundary.

**`@nimiq/core`'s Node.js build is still used**, but only in local/offline developer tooling (e.g. a reconciliation script run on a developer machine, never in the deployed Worker) where its P2P/WASM shape is not a problem.

**Open item (Phase 2).** Which network `rpc.nimiqwatch.com` (or any other RPC candidate) actually serves — Main or Test Albatross — is not yet confirmed; no official public RPC directory was found for either network at Phase 0. Phase 2's "backend transaction lookup spike" must confirm network identity before any candidate host is used for MainAlbatross production verification, and must evaluate whether NIM Relay needs to run/pin its own lightweight Albatross RPC node if no public option proves reliable enough for production judging traffic. This does not weaken the product invariant (independent server verification still happens) — it only affects which specific node performs that verification.

---

## D-002 — Nimiq message-signing verification scheme deferred to an empirical Phase 2 spike

**Date:** 2026-09-01 (Phase 0)
**Status:** Resolved 2026-09-05

No official, directly-fetchable specification for the exact Nimiq signed-message byte layout (prefix + hash + Ed25519 verify) was found at Phase 0. Rather than guess a byte layout and risk silently accepting or rejecting valid signatures, Phase 2 will capture a real signature produced by a physical device via `sign()` (Mini App SDK, TestAlbatross) and derive/cross-check the verification routine against it before any session-auth code depends on it. Verification will use `@noble/ed25519` (pure TypeScript, zero native dependencies, Workers-safe) rather than `@nimiq/core`'s WASM crypto module, for the same Workers-runtime reasons as D-001.

**Resolved.** The construction was first derived from the `core-rs-albatross` Rust source and pinned with a golden vector from the real `@nimiq/core` Node build (`evidence/testnet/phase2-nimiq-signature-vector.md`). On 2026-09-05 it was confirmed end to end on a physical phone: signing in through Nimiq Pay on the deployed Mini App produced a `sign()` result that `verifyNimiqSignedMessage` accepted, and `deriveNimiqAddress(publicKey)` matched the expected address. `SIGN_PREFIX = 0x16 ++ "Nimiq Signed Message:\n"`, `hash = SHA-256(prefix ++ decimalAsciiLength ++ message)`, `Ed25519.verify(sig, hash, pubkey)`; address = first 20 bytes of Blake2b-256(pubkey). No changes needed.

---

## D-004 — Workers test runtime uses `@cloudflare/vitest-plugin`, not `@cloudflare/vitest-pool-workers`

**Date:** 2026-09-01 (Phase 1)
**Status:** Locked

**Context.** PRD §39.3 requires "Use current Workers Vitest integration" for Durable Object/Worker tests, running inside real `workerd` rather than a Node.js mock.

**What happened.** The originally-installed `@cloudflare/vitest-pool-workers@0.9.14` (paired with our pinned `wrangler@4.128.0` and `vitest@^3.2.4`) failed in two independent ways when actually run:
1. Its resolved peer `wrangler@4.44.0` doesn't understand the declarative `"exports"` DO-class field (a newer wrangler feature, see the Cloudflare API research in `docs/PHASE_0_VERIFICATION.md` §6) - rejected with "Unexpected fields found in top-level field: exports". Fixed by using the legacy `migrations` array in `wrangler.jsonc` instead, which both the pinned direct `wrangler@4.128.0` and the older peer understand.
2. After that fix, the bundled `miniflare@4.20251011.0`/`workerd` runtime threw `TypeError: vm._setUnsafeEval is not a function` under Node.js 24.19.0 - an environment incompatibility inside the test-pool's own runtime shim, not something fixable from application code.

Rather than downgrade the local Node.js version to work around a test-tooling bug (which would fight the `.nvmrc`-pinned Node 22+/24 target instead of the actual problem), the fix was to check current official docs directly: Cloudflare has replaced `@cloudflare/vitest-pool-workers`'s config-based setup (`defineWorkersConfig` from a `"./config"` export) with a **plugin-based** one, `@cloudflare/vitest-plugin` (`cloudflareTest()` used as a Vite/Vitest plugin), aligned with Vitest v4's architecture. Confirmed via `developers.cloudflare.com/workers/testing/vitest-integration/get-started/write-your-first-test/`.

**Decision.** Upgraded `vitest` to `^4.1.11` workspace-wide and replaced `@cloudflare/vitest-pool-workers` with `@cloudflare/vitest-plugin@^1.1.3` in `apps/worker`. `apps/worker/src/index.test.ts` (a real `/api/health` request via `SELF.fetch`) now passes running inside actual `workerd`, not a mock - satisfying PRD §39.3 for real.

This is the second empirical toolchain-compatibility finding after D-001, for the same underlying reason: package version numbers and even package *names* in this ecosystem move fast enough that assuming compatibility from memory (mine or the PRD's) would have produced a build that looked configured but silently never ran a real test.

---

## D-005 — `webSocketClose` must not call `ws.close()` again (found via live smoke test)

**Date:** 2026-09-01 (Phase 1)
**Status:** Fixed

A live `wrangler dev` smoke test (real `workerd`, not the Vitest pool) connected a WebSocket to `RelayRoom`, sent `hello`, got `hello_ack`, closed, then reconnected. First connection worked; closing it threw server-side: `InvalidAccessError: Invalid WebSocket close code: 1005` from inside `webSocketClose`. Root cause: the handler was calling `ws.close(code, reason)` again on a socket the platform was already closing, and the client's default no-status close surfaces as code `1005`, which is not a valid explicit close code to pass back. Fixed by making `webSocketClose` a pure notification handler (no `.close()` call) - matches the Hibernation API's actual contract (the handler is *told* the socket closed, it doesn't close it). Re-verified with a corrected smoke script (clean explicit close code) that now passes for both a fresh connect and a reconnect. Evidence: `evidence/local/phase1-websocket-hello-reconnect-smoke.log`, `evidence/local/phase1-websocket-smoke-script.mjs`.

---

## D-006 — Nimiq RPC endpoints confirmed by network, both directions

**Date:** 2026-09-02 (Phase 2)
**Status:** Locked

Phase 0's open item ("which network does `rpc.nimiqwatch.com` serve?") is resolved with direct evidence, not inference from the hostname:

- **MainAlbatross**: `https://rpc.nimiqwatch.com` — `getBlockNumber` returned a live height that tracked `api.nimiq.watch`'s mainnet explorer API within a ~70-block gap over ~70 seconds (i.e. moving in real time, same chain).
- **TestAlbatross**: `https://rpc.testnet.nimiqwatch.com/` — `getBlockNumber` returned a live height that matched `test-api.nimiq.watch`'s testnet explorer API, at a completely different height from mainnet (confirms it's genuinely a separate chain, not the same node mislabeled).
- Both are listed under "Open RPC Servers" in the official `nimiq/awesome` GitHub org repo, operated by the same known community maintainer (`sisou`, also the author of the `nimiq.watch` explorer software).
- `getTransactionByHash` confirmed as the correct method name empirically: calling it with a well-formed-but-nonexistent hash against the testnet endpoint returns `{"error":{"code":-32603,"message":"Internal error","data":"Transaction not found: <hash>"}}` rather than a method-not-found error, confirming both the method name and its not-found error shape.

**Limitation to carry forward.** `nimiq/awesome` explicitly labels these "public RPC servers that may not be suitable for production applications... no uptime guarantees." They're used for TestAlbatross development throughout the build. Before Phase 10 (MainAlbatross production), revisit whether a single best-effort community node is sufficient for judging traffic or whether NIM Relay should run/pin a dedicated node or query multiple RPC sources for quorum - tracked as an open Phase 9/10 item, not resolved here.

`NIMIQ_RPC_URL` in `.env.example` is set per-environment: TestAlbatross endpoint for local/staging, the MainAlbatross endpoint (revisited per the limitation above) for production.

---

## D-003 — Supabase project provisioned fresh, not reusing an existing linked project

**Date:** 2026-09-01 (Phase 0)
**Status:** Locked

The locally authenticated Supabase CLI account has existing unrelated projects (from other work). Per PRD §41.4 ("Use a fresh project unless an existing NIM Relay project is intentionally provided") and the user's explicit instruction to provide credentials to a **new** Supabase account rather than use the CLI-linked one, NIM Relay provisions and links a dedicated fresh Supabase project once those credentials are provided (needed starting end of Phase 1, when migrations are first applied against a live database).

**Resolved (2026-09-03).** The user provided a fresh project (`eu-west-2`) plus its DB password. `0001_init.sql` and `0002_login_nonces.sql` were applied with `supabase db push --db-url <session-pooler>` (no `supabase link` — the user gave DB credentials, not a personal access token). Verified: 25 tables, 10 enums, both migrations tracked in `supabase_migrations.schema_migrations`, and a rolled-back `pg` smoke exercising the full player/device/session/nonce flow including the `wallet_address` unique constraint. Evidence: `evidence/testnet/phase1-supabase-migration.md`. Credentials live only in the gitignored `.env`.

**Fully resolved (2026-09-03, later same day).** The `service_role` key was provided. `getAuthStore()` now activates `SupabaseAuthStore` when `SUPABASE_SERVICE_ROLE_KEY` is set, and the auth flow (`nonce → verify → me → logout`) was run end-to-end against the live project: player and session rows persist, the nonce is consumed single-use, logout sets `revoked_at`. Evidence: `evidence/testnet/phase2-auth-e2e.log`. `vitest.config.ts` pins the Supabase bindings empty so unit tests never leave the in-memory store even with a local `.dev.vars` present.

**Carried forward.** Every `public` table has RLS enabled with **no policies** (Supabase auto-enables RLS on new tables); only `service_role` can touch data. That is fine while the Worker is the only client, but explicit RLS policy design is a PRD Phase 9 item and a hard prerequisite for any direct browser→Supabase access.
