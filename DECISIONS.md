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

## D-003 — Supabase project provisioned fresh, not reusing an existing linked project

**Date:** 2026-09-01 (Phase 0)
**Status:** Locked

The locally authenticated Supabase CLI account has existing unrelated projects (from other work). Per PRD §41.4 ("Use a fresh project unless an existing NIM Relay project is intentionally provided") and the user's explicit instruction to provide credentials to a **new** Supabase account rather than use the CLI-linked one, NIM Relay provisions and links a dedicated fresh Supabase project once those credentials are provided (needed starting end of Phase 1, when migrations are first applied against a live database).
