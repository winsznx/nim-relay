# Architecture

This describes the system as it runs today, not a plan. It is a living document: update it when the shape of the system changes.

## Four authorities

NIM Relay never confuses these four sources of truth:

| Authority | Owns | Never owns |
|---|---|---|
| **Nimiq chain** (Albatross, read via plain JSON-RPC over HTTPS, see `DECISIONS.md` D-001) | Real NIM value transfer: sender, recipient, amount, tx data, inclusion | Game skill, social state, live coordination |
| **Game verifier** (`packages/game-engine`, replayed inside the Worker) | Skill truth: deterministic replay of a submitted input trace against the server-issued config | Money, live coordination, social state |
| **Durable Objects** (`RelayRoom`, `StationRoom`, SQLite-backed) | Live coordination truth: serialized handoff claims, live network state, WebSocket broadcast | Durable relational history, money, skill |
| **Supabase Postgres** | Durable relational product history: players, sessions, login nonces, game runs, station races, the relay network snapshot | Live in-flight coordination, money custody |

The Worker (Hono, one production origin) is the only thing that talks to all four. The browser only talks to the Worker.

## One origin

A single Cloudflare Worker (`apps/worker`) serves the built Vite app (Workers Static Assets), the Hono API, WebSocket upgrades, and share/OG pages. From `apps/worker/src/index.ts`:

```text
/api/health         liveness check
/api/station/*      station, network, atlas, grants and race routes (apps/worker/src/station/routes.ts)
/api/auth/*         nonce, verify, session, logout, me
/api/runs/*         run issue/submit (server-verified game runs)
/ws/network         WebSocket -> StationRoom Durable Object (global live feed)
/ws/relays/:code     WebSocket -> RelayRoom Durable Object (one room per active relay)
/r/*, /invite/*, /proof/*   app shell, rendered client-side; /proof/* additionally gets server-rendered OG tags (share routes)
```

A `www.` request 301-redirects to the apex so sessions and link previews share one origin. `wrangler.jsonc` also enables `workers_dev` alongside the custom domains, so the original `*.workers.dev` addresses keep working after the domain migration.

## Domains and environments

Two Cloudflare Worker environments, defined in `apps/worker/wrangler.jsonc`:

- **production** (default env): `nimrelay.xyz` / `www.nimrelay.xyz`, `NIMIQ_NETWORK=MainAlbatross`, RPC at `rpc.nimiqwatch.com`, `TREASURY_ENABLED=true`.
- **testnet** (`--env testnet`): `testnet.nimrelay.xyz`, `NIMIQ_NETWORK=TestAlbatross`, RPC at `rpc.testnet.nimiqwatch.com`, `TREASURY_ENABLED=true`.

Both environments share the `RelayRoom` and `StationRoom` Durable Object bindings and each gets its own Supabase project via secrets (not committed).

Cron triggers are declared (`0 0 * * *` and `*/10 * * * *`) but the `scheduled()` handler in `apps/worker/src/index.ts` currently only logs the trigger; no reconciliation or rotation job runs from it yet. Don't read the cron declaration as evidence of an active scheduled job.

## Auth

Nimiq-account login, no passwords, implemented in `apps/worker/src/auth/` (`nonce.ts`, `session.ts`, `device-hash.ts`, `routes.ts`, `store.ts`, `supabase-store.ts`). `POST /api/auth/nonce` issues a single-use, origin-bound challenge; the client signs it with its Nimiq account key through the Mini App SDK; `POST /api/auth/verify` checks that signature (`packages/relay-protocol`, pure `@noble` crypto, no `@nimiq/core` WASM, see `DECISIONS.md` D-001/D-002), derives the wallet address, finds-or-creates the player, and opens a signed session cookie. `getAuthStore()` uses the in-memory store when `SUPABASE_SERVICE_ROLE_KEY` is unset (local dev, tests) and the Supabase-backed store otherwise.

## Server-verified game runs

`packages/game-engine` is a pure, deterministic 60 Hz simulation shared verbatim between the browser and the Worker: no DOM, no timers, no I/O in the simulation itself. Two engine generations exist side by side:

- **`packages/game-engine/src/relay-leg-v5`** is frozen as deployed on 2026-09-17 (commit `30e7a40`, "Freeze Relay Leg v5 as relay-leg-v5 for permanent replay of verified runs"). It exists only so previously verified v5 runs can still be replayed and checked; new gameplay work does not touch it.
- **`packages/game-engine/src/relay-leg`** is the live engine (v6): lane-based road, real edges, world events, two forks, a pulse section, and `deriveGhostline()` for the next runner's ghost. This is what `/api/station` issues and verifies today.

`apps/worker/src/runs/routes.ts` issues a challenge config with an HMAC (`RUN_CHALLENGE_SECRET`, `apps/worker/src/runs/challenge-mac.ts`) so a client cannot alter the seed or rules and still submit a valid run. The client plays locally against that config, submits its recorded input trace, and the Worker replays the trace with the same engine `replay()` the client used (`apps/worker/src/station/race-engines.ts`) before trusting any result. A client-reported score is never read for anything competitive.

## Relay leg and handoff

A holder races a deterministic leg against the previous runner's verified ghost (server-replayed, never trusted from the client). On a qualified finish the holder picks the next Atlas route and station, and the app opens a handoff: the Worker locks the recipient, amount and a short commitment before Nimiq Pay opens (`apps/worker/src/station/network/handoff.ts`, `handoff-recovery.ts`, `packages/relay-protocol`), the holder approves a real Nimiq transaction, and the Worker independently looks that transaction up over JSON-RPC and checks sender, recipient, value, commitment, network and confirmations before custody moves. The Worker never holds a user private key and never signs a user's transfer; every real baton handoff is signed by the holder through native Nimiq Pay.

## Relay Atlas

`packages/shared/src/atlas.ts` defines the fixed set of Relay Stations and the routes between them; each route is a real relay-leg course. Stations are game-world destinations the baton travels through, never a player's or user's location. `apps/worker/src/station/network/atlas.ts` and `atlas-missions.ts` track which routes and stations have lit up through qualified legs; `apps/web/src/features/atlas` renders the globe. See `docs/atlas.md` for the full station/route reference.

## Relay Grants

`apps/worker/src/station/network/grants/` (`config.ts`, `eligibility.ts`, `desk.ts`, `ledger.ts`, `chain.ts`, `starter-baton.ts`, `journey.ts`) is a server-held treasury that can fund a starter baton for an eligible player, signed with a Worker-only key provisioned by `scripts/treasury/provision.ts`. It is gated behind `TREASURY_ENABLED` (must be exactly `"true"`) and is off by default in every environment except the deployed production and testnet Workers, where it is currently on. A grant-funded starter baton is recorded on the baton itself but never creates a handoff record, so it is structurally excluded from qualified-handoff counts, Atlas statistics, ghosts, crews and rivalries (`starter-baton.ts`). See `docs/grants.md` and `SECURITY.md` for caps and the threat model.

## First-run tour and race tutorial

`apps/web/src/features/tour` drives a first-run product tour (coach marks, spotlighting, a guided finale) gated by `apps/worker/src/station/network/tour-ledger.ts` so it only fires once per player. `apps/web/src/features/race/tutorial` is a separate in-race micro-tutorial (`GameplayCoach.tsx`, a state machine in `machine.ts`) that teaches the actual leg controls the first time someone races.

## Client stack

`apps/web` is Vite + React + TypeScript. The race and Relay Station scenes render with Three.js (`apps/web/src/features/race/scene`, `apps/web/src/features/relay-station/scene`); server state is TanStack Query; ephemeral client state is Zustand (`apps/web/src/stores`). `@nimiq/mini-app-sdk` drives the Nimiq Pay handoff; `@nimiq/identicons` renders runner identicons.

## Repository layout

```text
apps/web/                 Vite + React + TypeScript frontend: routes, features (race, atlas, grants, tour, relay-station, social, shell), stores, hooks
apps/worker/               Cloudflare Worker: Hono API, auth, RelayRoom/StationRoom Durable Objects, station/network domain logic (handoff, atlas, grants, ghosts, echoes, chronicles, ops), runs (server-verified replay), share/OG routes
packages/game-engine/      Deterministic Baton Physics simulation: relay-leg (v6, live) and relay-leg-v5 (frozen)
packages/relay-protocol/   Nimiq JSON-RPC client, transaction verification, commitment/intent codecs shared by client and Worker
packages/shared/           Cross-cutting types/schemas and the Atlas station/route data
packages/test-utils/       Shared test fixtures/harnesses
supabase/migrations/       SQL migrations (0001 init through 0005 relay network), applied via Supabase CLI
scripts/                   verify/, treasury/, e2e/ (including a mock Nimiq RPC), submission/ assets, deploy.sh
```

## Deployment model

One Cloudflare Worker per environment (local `wrangler dev`, testnet, production), sharing the `RelayRoom`/`StationRoom` Durable Object classes and each bound to its own Supabase project via secrets. `apps/worker/wrangler.jsonc` serves `../web/dist` as static assets with `run_worker_first` on the API, WebSocket and share/proof paths so the Worker sees those requests before the asset handler does. Local development proxies `/api` and `/ws` from Vite to a locally running `wrangler dev`, so LAN-connected Nimiq Pay traffic hits the same-origin shape production uses.
