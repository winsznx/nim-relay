# Phase 0 — Source-of-Truth Verification

Date: 2026-09-01
Status: **PASS** (with two open items carried into Phase 2, see §7)

This document records what was independently verified against current official sources
before any implementation depended on it, per PRD §0.1 and §51 (Phase 0).

---

## 1. Competition rules and scoring (miniappscompetition.com)

Fetched directly from `/rules`, `/scoring`, `/faq`, `/cycles`, `/payout`, `/submissions/cycle2` on 2026-09-01.

- Cycle II is the **active cycle**: submission deadline **September 18, 2026**, winners announced October 2, 2026.
- Prize pool per cycle: $17,000 USDT (Gold $10,000 / Silver $5,000 / Bronze $2,000), paid on **Polygon** in 3 equal monthly installments gated on liveness + maintenance requirements.
- Scoring: 105 points total — Design & UX 25, Functionality 25, Usefulness & Originality 25, Marketing & Distribution 25, NIM Bonus 5. Matches PRD §1 exactly — no drift found.
- Hard requirement confirmed: "Simply displaying a Nimiq logo does not qualify as integration" — Nimiq wallet/tx must be load-bearing. Matches PRD's core invariant.
- MIT license, public GitHub repo, no gambling/chance-primary mechanics — confirmed, matches PRD §0.1 and §6.

No drift between the PRD and the live competition site. Proceeding on the PRD's rubric mapping as written.

## 2. Nimiq Mini App SDK (`@nimiq/mini-app-sdk`)

Source: `nimiq.dev/mini-apps`, `/mini-apps/api-reference/nimiq-provider`, `/mini-apps/development/load-local-mini-app`, `/mini-apps/development/build-with-ai`, `/mini-apps/features/*`.

- Confirmed current npm version: **0.1.0** (pre-1.0 — expect breaking changes; pin exact version, do not use a caret range).
- `init()` from `@nimiq/mini-app-sdk` is the documented entry point; does not itself trigger account approval (matches PRD §11.2).
- Confirmed methods: `listAccounts()`, `sign(message)`, `isConsensusEstablished()`, `getBlockNumber()`, `sendBasicTransaction(...)`, `sendBasicTransactionWithData(...)`, full staking method set (`sendNewStakerTransaction`, `sendStakeTransaction`, `sendSetActiveStakeTransaction`, `sendUpdateStakerTransaction`, `sendRetireStakeTransaction`, `sendRemoveStakeTransaction`).
- `requestDeviceIdentifier({ reason })`: returns a 64-char hex SHA-256-shaped string, scoped per (device, origin) pair — confirms PRD §11.5's device-not-identity framing. First call per origin shows a native consent prompt with the given `reason` string; later calls resolve silently. Stable across app reinstalls on the same device/origin.
- Ethereum/EVM provider confirmed EIP-1193 + EIP-6963 compliant via `window.ethereum`, standard `eth_*` methods routed through `rpcCall`. Not used for the core NIM baton (out of scope for the flagship loop) but available if a future Creator Relay wants EVM tokens.
- **Deep link format**: two forms are documented — `nimiqpay://miniapp?url=your-app.com` and `https://nimpay.app/miniapps/open/your-app.com`. **Could not confirm from official docs** whether nested path/query segments on the target URL (e.g. `/invite/<token>`) survive the opener round-trip. Carried into Phase 2 as an empirical test before locking the invite-link encoding (PRD §29 already anticipates this: "Claude must verify query/path preservation... before locking invite encoding").
- AI coding skill available: `npx skills add nimiq/developer-center --skill mini-apps` — installed later when writing Nimiq-integration code, not required for Phase 0.

## 3. Nimiq Web Client / backend transaction verification — **critical finding**

This is the most consequential Phase 0 finding and directly affects PRD §9.6 and §12.

**Official docs are silent on Cloudflare Workers / edge-runtime compatibility for `@nimiq/core`.** The Web Client is architecturally a WASM-compiled P2P light client (`client.waitForConsensusEstablished()` — it syncs blocks over a peer network), not a stateless RPC-over-HTTP client. That shape is fundamentally at odds with a Cloudflare Worker's per-request, no-persistent-socket execution model regardless of WASM support.

**Empirical spike performed** (required by PRD §9.6 and §51 Phase 0 gate — "do not assume package compatibility"):

- Built a minimal Hono Worker, `compatibility_date: 2026-08-04`, `nodejs_compat` enabled, importing `@nimiq/core@2.21.0` inside a route handler.
- Ran it under real `wrangler dev` (local `workerd`), hit the route with `curl`.
- Result: **hard failure**. `TypeError: wasm2.__wbindgen_start is not a function`, thrown from `@nimiq/core/bundler/main-wasm/index.js` during module init.
- Raw evidence: `evidence/local/phase0-nimiq-core-workerd-spike.log`, `evidence/local/phase0-nimiq-core-workerd-spike-result.json`.
- `npm install` for `@nimiq/core` additionally pulled in `bufferutil`/`utf-8-validate` (native `node-gyp-build` addons used by the `ws` websocket stack) — a second, independent signal that this package targets Node.js's native module system, not `workerd`.

**Decision (recorded in `DECISIONS.md`): `@nimiq/core` is not used inside the Cloudflare Worker.** Backend transaction verification instead uses plain JSON-RPC-over-HTTPS (`fetch()` against a Nimiq Albatross RPC node), which requires no WASM and no native modules. Verified empirically:

```text
POST https://rpc.nimiqwatch.com  {"jsonrpc":"2.0","method":"getBlockNumber","params":[],"id":1}
→ {"jsonrpc":"2.0","result":{"data":60469309,"metadata":null},"id":1}
```

Called twice, ~10s apart, block number incremented — confirms a live, synced node, not a static stub, reachable over plain HTTPS `fetch` (i.e. Workers-compatible with zero special config).

**Open item carried to Phase 2**: which network `rpc.nimiqwatch.com` serves (Main vs Test Albatross) is not yet confirmed — no official public RPC directory was found for either network. Phase 2's "backend transaction lookup spike" must (a) confirm network identity for any candidate RPC host before it is used for MainAlbatross verification, and (b) evaluate running/pinning our own lightweight Albatross RPC node if no reliable public option is confirmed reliable enough for production. `@nimiq/core`'s Node.js build remains available for **local/offline tooling only** (e.g. a local script that reconciles against `@nimiq/core` on a developer machine) — never inside the deployed Worker.

The community npm package `nimiq-rpc-client-ts` (typed HTTP/WS JSON-RPC client, fetch-based, no WASM) is a candidate typed wrapper over the same plain-RPC approach; it is **not an official Nimiq org package**. Decision: write a small first-party typed RPC client in `packages/relay-protocol` scoped to only the methods NIM Relay needs (`getTransactionByHash`-equivalent, `getBlockNumber`), rather than take an unofficial dependency for the trust-critical verification path. Rationale recorded in `DECISIONS.md`.

## 4. Nimiq message signing (backend login-challenge verification)

Could not find an official, directly-fetchable spec page for the exact signed-message byte layout (prefix + hash + Ed25519 verify). The `nimiq-network/developer-reference` repo's `verify.md` covers block/transaction validation, not message signing specifically.

**Decision**: treat the exact signing scheme as unverified until Phase 2, where it will be derived empirically — call `sign()` from a real device via the Mini App SDK against TestAlbatross, capture the exact bytes, and cross-check verification using a pure-JS Ed25519 primitive (`@noble/ed25519`, pure TS, zero native deps, Workers-safe) before trusting it for session auth. This is a harder gate than "read the docs": Phase 2 cannot close until a real device-produced signature verifies correctly server-side.

## 5. TestAlbatross / MainAlbatross

Confirmed as the `ClientConfiguration.network()` string values (`TestAlbatross`, `MainAlbatross`, plus `DevAlbatross`). Exact genesis/chain-ID values were not independently confirmed from an official page — not required to proceed (the Mini App SDK and Nimiq Pay select network implicitly; the Worker-side verifier only needs to know which RPC host corresponds to which network, which is the Phase 2 open item above).

## 6. Cloudflare Workers / Durable Objects / R2 / Cron

Source: developers.cloudflare.com (workers, durable-objects, workers/static-assets, workers/wrangler, r2, workers/runtime-apis/nodejs).

Key findings that change PRD-era assumptions:

- **`wrangler.jsonc` is current**, not `wrangler.toml`-only. Config uses `"assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "single-page-application" }` for serving the Vite build, with `"run_worker_first": ["/api/*", "/ws/*", "/r/*", "/invite/*", "/proof/*"]` so Hono routes are not shadowed by static asset serving.
- **Durable Object binding declaration has changed.** The legacy `migrations` array (`new_sqlite_classes`, etc.) still works but is superseded by a declarative `"exports"` field pairing each DO class with `"storage": "sqlite"`. `exports` and `migrations` are mutually exclusive in one config. NIM Relay uses the current `exports` form with SQLite-backed storage for `RelayRoom`.
- **DO instance routing**: `env.RELAY_ROOM.getByName(relayId)` is the current one-call API (supersedes the two-step `idFromName()` + `.get()`, which still exists but is no longer the primary documented path). Inside the DO, `ctx.id.name` recovers the routing name without threading it through request args.
- **WebSocket Hibernation API confirmed**: `ctx.acceptWebSocket(ws)`, handlers `webSocketMessage`/`webSocketClose`/`webSocketError`, `ws.serializeAttachment()`/`deserializeAttachment()` (16,384-byte cap) for connection metadata (matches PRD §14.4 exactly).
- **Alarms**: `ctx.storage.setAlarm(timestampMs)`, `async alarm(alarmInfo)` with `{ retryCount, isRetry }`. At-least-once with a **finite** built-in retry budget (~6 retries, exponential backoff from ~2s) — confirms PRD §14.5's "alarm logic must be idempotent" is necessary, not defensive-only; code must also self-reschedule on exhaustion rather than assume infinite platform retries.
- **Cron Triggers**: `"triggers": { "crons": [...] }` in wrangler config, `async scheduled(controller, env, ctx)` handler, runs in UTC, up to 15 min propagation delay — matches PRD §14.6.
- **`nodejs_compat`**: for `compatibility_date >= 2026-08-04` (which we use), Node.js compat is **on by default** — no explicit flag required, though we set it explicitly for clarity/portability. Two tiers exist (native Workers-runtime implementations vs. Wrangler-shimmed polyfills that can throw `[unenv] ... is not implemented yet!` at runtime for unsupported calls) — this is exactly the class of risk the `@nimiq/core` spike surfaced concretely.
- R2 binding/API confirmed as documented in PRD §14.7 (`env.BUCKET.put/get/delete`).

## 7. Open items carried forward (not blocking Phase 1)

1. **RPC network identity** for the candidate public endpoint(s) — resolve in Phase 2's backend transaction lookup spike, before any TestAlbatross/MainAlbatross verification code depends on a specific host.
2. **Nimiq deep-link path/query passthrough** — resolve empirically in Phase 2 before locking `/invite/<token>` encoding.
3. **Nimiq message-signing byte layout** — resolve empirically in Phase 2 using a real device signature, cross-verified with `@noble/ed25519`.

None of these block Phase 1 (repo/infrastructure scaffolding), which does not depend on any of them.

## 8. Supabase

`supabase` CLI confirmed installed and authenticated locally (`supabase projects list` returns existing org projects). No existing NIM Relay project — a fresh Supabase project will be provisioned in Phase 1 using credentials the user is providing directly for a new account (not the CLI-linked account, which holds unrelated projects). Supabase JS client (`@supabase/supabase-js@2.112.4`) confirmed current; used server-side only inside the Worker per PRD §26.1 — never exposed to the browser.

## 9. Dependency versions pinned at Phase 0 (recorded in `evidence/dependencies.json`)

```text
@nimiq/mini-app-sdk  0.1.0
@nimiq/core          2.21.0   (Node.js build, local/offline tooling only — not shipped in the Worker)
hono                 4.13.5
pixi.js              8.20.1
zustand              5.0.15
@tanstack/react-query 5.102.8
zod                  4.5.4
vite                 8.2.2 (frontend build tool — verify SSR/Worker-adjacent compat as apps/web is scaffolded)
react / react-dom    19.2.8
typescript           5.9.3 (pinned; 7.0.2 exists but is pre-release-adjacent and untested against current tooling — verify before upgrading)
wrangler             4.128.0
@supabase/supabase-js 2.112.4
motion               13.1.1
@noble/ed25519       3.2.0
```
