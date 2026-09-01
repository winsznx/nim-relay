# Phase 1 Summary — Repository and infrastructure foundation

**Status: IN PROGRESS (paused for handoff).** Four of five gate items pass with live evidence; the fifth (database migration) is blocked on user-provided Supabase credentials, not on any unresolved technical question.

## Objective
Monorepo, TypeScript strict, lint, test runner, Vite app, Worker, Hono, Durable Object, R2 binding, Supabase migrations, local same-origin proxy, environment schemas, basic CI, docs skeleton.

## Files changed (since Phase 0 commit)
- `apps/worker/` — Hono app, `RelayRoom` Durable Object (Hibernation WebSocket API, alarm stub), `wrangler.jsonc`, `Env` types, Vitest config using `@cloudflare/vitest-plugin`, a real `/api/health` test running inside `workerd`.
- `apps/web/` — Vite + React + TS app shell, LAN dev proxy to the local Worker for `/api`, `/ws`, `/proof`, `/invite`, moodboard-derived CSS tokens.
- `packages/shared/` — integer-Luna money conversion (tested), relay/handoff state enums (Zod).
- `packages/relay-protocol/` — the PRD §9.5 tx-data commitment codec: `deriveCommitment`/`encodeTxData`/`decodeTxData`, with tests proving byte-length budget, deterministic round-trip, malformed-input rejection, and the 128-bit collision target.
- `packages/game-engine/` — engine-version binding scaffold (real Baton Physics simulation is Phase 3).
- `packages/test-utils/` — placeholder, populated as later phases need shared fixtures.
- `supabase/migrations/0001_init.sql` — full schema per PRD §15 (24 tables/enums, uniqueness constraints for `tx_hash`, `(relay_id, leg_number)`, the "one sendable intent per leg" partial unique index, canonical-ordering check on `friendships`). **Not yet applied to a live database** — see Known limitations.
- `.github/workflows/ci.yml`, `eslint.config.js` — CI mirrors the local gate (typecheck, lint, test, build).

## Commands executed
```text
pnpm install / pnpm approve-builds esbuild workerd sharp
pnpm typecheck && pnpm lint && pnpm test && pnpm build   (all green, see below)
wrangler dev (live, twice) + curl /api/health
node <websocket smoke script> against the live Worker (hello + reconnect)
```

## Test counts/results
- Unit tests: 13 passing across `packages/shared` (3), `packages/game-engine` (2), `packages/relay-protocol` (7), plus `apps/worker`'s real in-`workerd` health-endpoint test (1). **Total: 13 passing, 0 failing.**
- `pnpm lint`: 0 errors, 0 warnings (two unused-arg warnings fixed by prefixing with `_`).
- `pnpm build`: both `apps/web` (Vite) and `apps/worker` (`tsc --noEmit`) succeed.

## Adversarial cases executed
`packages/relay-protocol`'s tx-data codec tests include 9 malformed-input cases (`decodeTxData` never throws, returns `null`) and 3 encode-time rejection cases (bad relay code, short commitment, negative leg number, oversized relay code).

## Network evidence produced
- Live `wrangler dev` on `localhost:8797`: `GET /api/health` → `200 {"ok":true,...}`.
- Live WebSocket hello/reconnect against `RelayRoom`: first connect → `hello_ack` with correct `relayName` (proves `env.RELAY_ROOM.idFromName`/DO routing works); clean close; **reconnect** → new connection, new `hello_ack`, same relay name. Evidence: `evidence/local/phase1-websocket-hello-reconnect-smoke.log`.

## Bug found and fixed during this phase
`RelayRoom.webSocketClose` was calling `ws.close(code, reason)` again inside the close-notification handler, which threw `InvalidAccessError: Invalid WebSocket close code: 1005` the first time a real client disconnected. Caught by the live smoke test, not by the unit test (the unit test never actually closes a real socket). Fixed — see `DECISIONS.md` D-005.

## Toolchain findings (see `DECISIONS.md` D-004)
`@cloudflare/vitest-pool-workers` (originally pinned) is broken against Node.js 24.19.0 in this environment and doesn't understand the newer declarative Durable Object `"exports"` config field at its pinned wrangler peer version. Replaced with the current official `@cloudflare/vitest-plugin` (Vitest v4-based) after confirming against live Cloudflare docs. `wrangler.jsonc` uses the legacy `migrations` array for DO classes for the same reason.

## Deployment evidence
None — no staging/production deploy this phase (local-only, by design; Phase 1 gate doesn't require a public deployment).

## Security findings
None new. No secrets committed; `.env.example` remains names/comments only.

## Evidence paths
`evidence/local/phase1-websocket-hello-reconnect-smoke.log`, `evidence/local/phase1-websocket-smoke-script.mjs`.

## Known limitations
**Database migration not yet applied.** `supabase/migrations/0001_init.sql` is written and manually reviewed but has not been run against a live Postgres instance — this machine has neither Docker (so `supabase start` can't run a local instance) nor a linked NIM Relay Supabase project (the CLI-linked account holds unrelated projects; the user is providing credentials to a dedicated fresh account per `DECISIONS.md` D-003). **This is the one open Phase 1 gate item, blocked on user input, not on an unresolved technical question.**

## Claim-ledger changes
None yet — no product claims to make until Phase 2+ builds real user-facing surfaces.

## Decision changes
D-004 (Workers Vitest tooling), D-005 (`webSocketClose` bug) added to `DECISIONS.md`.

## Commit SHA
Recorded in `run-state.json` after this phase's commit.

## Result: IN PROGRESS — resume by applying `supabase/migrations/0001_init.sql` once credentials arrive, then close the Phase 1 gate and move to Phase 2.
