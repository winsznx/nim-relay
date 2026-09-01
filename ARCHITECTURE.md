# Architecture

Status: living document, updated every phase. Current as of Phase 1.

## Four authorities

NIM Relay never confuses these four sources of truth:

| Authority | Owns | Never owns |
|---|---|---|
| **Nimiq chain** (Albatross, verified via plain JSON-RPC over HTTPS — see `DECISIONS.md` D-001) | Real NIM value transfer: sender, recipient, amount, tx data, inclusion | Game skill, social state, live coordination |
| **Game verifier** (`packages/game-engine`, replayed inside the Worker) | Skill truth: deterministic replay of a submitted input trace against server-issued config | Money, live coordination, social state |
| **Durable Object** (`RelayRoom`, one per active relay, SQLite-backed storage) | Live coordination truth: serialized runner claims, pass-intent state, spectator broadcast, alarms | Durable relational history, money, skill |
| **Supabase Postgres** | Durable relational product history: players, relays, legs, runs, crews, seasons, achievements | Live in-flight coordination, money custody |

The Worker (Hono, one production origin) is the only thing that talks to all four. The browser talks only to the Worker.

## One origin

Single Cloudflare Worker serves static Vite assets, the Hono API, WebSocket upgrades, share/OG pages, and proof pages, per PRD §14.1-14.2. Routes:

```text
/            static app shell
/api/*       Hono API (run_worker_first)
/ws/*        WebSocket upgrade → RelayRoom Durable Object
/r/*         short share redirects
/invite/*    invite claim pages
/proof/*     public judge proof surface
/assets/*    static asset cache
```

## Non-custodial invariant

The Worker never holds a user private key and never signs a user's NIM transfer. Every real baton handoff is signed by the holder through native Nimiq Pay (`sendBasicTransactionWithData`, client-side). The Worker's only role in the money path is: (1) issue a durable handoff intent before the wallet prompt opens, (2) independently look up the resulting transaction by hash via plain JSON-RPC and confirm sender/recipient/value/data/inclusion match that intent, (3) mark the handoff canonical only after that independent check passes. See `DECISIONS.md` D-001 for why this is plain RPC rather than the official WASM Web Client.

## Repository layout

```text
apps/web/       Vite + React + TypeScript strict frontend (PixiJS game canvas, Zustand ephemeral state, TanStack Query server state)
apps/worker/    Cloudflare Worker: Hono API, auth, RelayRoom Durable Object, Nimiq RPC verifier, game replay verifier, jobs (cron), proof endpoints, security middleware
packages/game-engine/     Deterministic Baton Physics simulation — no DOM/PixiJS/browser APIs, shared verbatim between client and Worker
packages/relay-protocol/  Tx-data commitment codec, intent hashing, first-party Nimiq JSON-RPC client, shared relay state-machine types
packages/shared/          Cross-cutting types/schemas (Zod) used by both apps
packages/test-utils/      Shared test fixtures/harnesses
supabase/migrations/      SQL migrations, applied via Supabase CLI
scripts/                  verify/, evidence/, load/, clean-room/ automation
```

Full rationale for the monorepo boundary: the game engine and relay protocol must be byte-identical between the browser (where a player plays) and the Worker (where the server replays/verifies) — sharing them as workspace packages, rather than duplicating logic, is what makes "server-derived score only" (PRD §7.7, §54 item 5) actually true rather than aspirational.

## Deployment model

One Cloudflare Worker per environment (local `wrangler dev`, staging, production), each bound to its own Supabase project/schema and its own Durable Object + R2 namespace. Local development proxies `/api` and `/ws` from Vite to a locally running Wrangler dev server so LAN-connected Nimiq Pay traffic hits the same-origin shape production uses (PRD §25.3) — this avoids CORS drift between environments.

## Updated per phase

This file is amended as each phase lands real infrastructure (Durable Object schema, API surface, RPC verifier host, etc.) rather than written once and left stale.
