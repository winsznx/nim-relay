# Decisions

Architectural decisions and rejected alternatives, recorded as they happen. Newest first.

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
**Status:** Open, scheduled for Phase 2

No official, directly-fetchable specification for the exact Nimiq signed-message byte layout (prefix + hash + Ed25519 verify) was found at Phase 0. Rather than guess a byte layout and risk silently accepting or rejecting valid signatures, Phase 2 will capture a real signature produced by a physical device via `sign()` (Mini App SDK, TestAlbatross) and derive/cross-check the verification routine against it before any session-auth code depends on it. Verification will use `@noble/ed25519` (pure TypeScript, zero native dependencies, Workers-safe) rather than `@nimiq/core`'s WASM crypto module, for the same Workers-runtime reasons as D-001.

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

## D-003 — Supabase project provisioned fresh, not reusing an existing linked project

**Date:** 2026-09-01 (Phase 0)
**Status:** Locked

The locally authenticated Supabase CLI account has existing unrelated projects (from other work). Per PRD §41.4 ("Use a fresh project unless an existing NIM Relay project is intentionally provided") and the user's explicit instruction to provide credentials to a **new** Supabase account rather than use the CLI-linked one, NIM Relay provisions and links a dedicated fresh Supabase project once those credentials are provided (needed starting end of Phase 1, when migrations are first applied against a live database).
