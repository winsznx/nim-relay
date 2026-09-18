# Evidence Index

Index into `evidence/`, describing what's actually there. Updated when the directory changes, not on a fixed schedule.

```text
evidence/
  dependencies.json     Pinned dependency versions, recorded at Phase 0
  local/                Local-only spikes and smoke tests (pre-rebuild)
  testnet/               TestAlbatross deployment and verification logs
  production/            Current production (rebuild) deployment and verification
```

## `evidence/production/` — current, most relevant

- `network-release.md` — 2026-09-13 relay network release. Lists what shipped (network-separated batons with immutable intents, the Atlas globe with consented coarse countries, best-of-three/five matches, ghosts, handoff recovery, hashed invites) and its verification: 722 total tests passing, clean typecheck/lint/build, a mobile browser walkthrough, and a live mainnet RPC decode check against public transaction `d95a3935cb527c0d37d0de3eef25fb154a82b50de87a02d2d6b9c3187e029f63` — explicitly noted as an unrelated public transaction, not product usage.
- `rebuild-2026-09-17.md` — the current production deployment. Commit `5444734` on `production-relay`, deployed to both `nim-relay.timjosh507.workers.dev` (MainAlbatross) and `nim-relay-testnet.timjosh507.workers.dev` (TestAlbatross) with their Worker version IDs. Records pre-deploy verification (typecheck/lint/build, 904 engine + 178 Worker + 44 relay-protocol + 5 shared + 212 web unit tests, 17 browser network specs, a 7-scenario two-runner Playwright lifecycle E2E against a mocked Nimiq Pay provider and mock RPC) and post-deploy checks (`/api/health` on both Workers, public snapshot load).
- `verification.md` — an earlier production verification pass ("Station v4"): engine/shared/protocol/Worker test counts, a Playwright mobile walkthrough, asset generation provenance, a Supabase migration note, and an explicit statement that live real-wallet approval and physical-device profiling were not automated.
- `live-race.png`, `live-station.png` — dated product screenshots (430×900, phone-frame) from a live verification pass.
- `live-gameplay.webm` — a ~30-second recorded gameplay clip from a live verification pass.

## `evidence/testnet/`

- `phase1-supabase-migration.md` — record of applying migration `0001_init.sql` to the live Supabase project via `supabase db push`.
- `phase2-deploy.md` — first public TestAlbatross deployment: the Worker URL, the Cloudflare account it's under, which secrets were set via `wrangler secret put` versus which config lives in `wrangler.jsonc`.
- `phase2-nimiq-signature-vector.md` — a golden test vector for Nimiq signed-message verification, generated with the real `@nimiq/core@2.21.0` Node.js build offline, used to independently cross-check `packages/relay-protocol/src/nimiq-verify.ts` against the actual library rather than just a reading of its Rust source.
- `phase2-nimiq-rpc-spike.log` — a spike confirming `getBlockNumber` and `getTransactionByHash` behavior against both TestAlbatross and MainAlbatross public RPC endpoints, including the expected `TransactionNotFoundError` for an unknown hash.
- `phase2-auth-e2e.log` — an end-to-end run of the login flow (`scripts/verify/auth-e2e.ts`) against the live Supabase-backed Worker: nonce issue, verify, a replayed-nonce rejection (400, as expected), and `/me` returning the same player.
- `phase4-runs.md` — describes the server-verified game-run slice: the Worker issues a signed challenge the client can't alter, then re-derives the canonical score by replaying the submitted input trace, documenting the `/api/runs/issue` and `/api/runs/submit` contracts.

## `evidence/local/`

Pre-rebuild local spikes, kept for their historical record:

- `phase0-nimiq-core-workerd-spike.log` / `phase0-nimiq-core-workerd-spike-result.json` — confirms `@nimiq/core`'s WASM client fails to instantiate inside `workerd` (`wrangler dev` local mode), the reason the Worker uses pure-JS `@noble` primitives for crypto instead (see `packages/relay-protocol/src/nimiq-verify.ts`).
- `phase1-websocket-smoke-script.mjs` / `phase1-websocket-hello-reconnect-smoke.log` — a smoke test confirming a WebSocket `hello`/reconnect round-trip against a local `wrangler dev` Relay Room Durable Object.

## `evidence/dependencies.json`

Pinned dependency versions as recorded at Phase 0 (2026-09-01), sourced from `npm view <pkg> version` against the registry at that time. This is a point-in-time snapshot, not kept in sync with the current lockfile — check `package.json`/`pnpm-lock.yaml` for what's actually installed today.

## What's not here

There is no `evidence/load/`, `evidence/security/`, `evidence/clean-room/`, `evidence/replays/`, `evidence/handoffs/` or `evidence/submission/` directory yet — no load test, dedicated security pass, clean-room reproduction run, or packaged submission evidence has been recorded. `evidence/mainnet/` as a name doesn't exist either; production mainnet evidence lives under `evidence/production/` instead. Don't cite evidence from a path that isn't listed above; if you need it and it doesn't exist, that's a gap, not an oversight in this index.
