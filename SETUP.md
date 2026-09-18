# Setup

Fresh clone to local development, for the current `production-relay` rebuild.

## Prerequisites

- Node.js 22+ (`engines.node` in `package.json` requires `>=22`)
- pnpm 11.21.0 (`packageManager` pins this exactly — `corepack enable` picks it up automatically)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI, authenticated (`wrangler login`) — only needed for deploying or for real `wrangler dev`
- A phone with Nimiq Pay installed, on the same Wi-Fi/LAN as your dev machine, if you want to test against a real wallet instead of the mock RPC

Supabase is optional for local development — see "Database" below.

## Install

```bash
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# fill in apps/worker/.dev.vars — never commit real secrets
```

`apps/worker/.dev.vars` (gitignored) is what `wrangler dev` reads locally. A root-level `.env.example` also exists with an older/broader variable list (including frontend `VITE_*` values); `apps/worker/.dev.vars.example` is the current, authoritative one for the Worker.

Required in `apps/worker/.dev.vars`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `DEVICE_HASH_SECRET`, `RUN_CHALLENGE_SECRET`, `APP_ORIGIN`. `OPS_PLAYERS` is optional (comma-separated player ids/handles allowed to open `/ops`; empty means nobody can).

**Treasury (Relay Grants) is off by default.** `TREASURY_ENABLED=false` in the example file. Leave it as-is unless you're specifically testing grants — turning it on requires a real `TREASURY_PRIVATE_KEY` (use a throwaway testnet key locally; see `scripts/treasury/provision.ts` to generate one, or `docs/grants.md`).

## Database

Supabase is optional locally: with no `SUPABASE_SERVICE_ROLE_KEY` set, `getAuthStore()` falls back to an in-memory auth store, so you can run the Worker without a Supabase project for most local work (`apps/worker/wrangler.jsonc` documents this fallback directly).

To use a real Supabase project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

## Local development

```bash
pnpm dev:worker   # starts the Cloudflare Worker (Hono + Durable Objects) under `wrangler dev`
pnpm dev          # starts the Vite app with --host, proxying /api to the Worker and /ws to it over WebSocket
```

Open the Vite "Network" URL it prints (e.g. `http://192.168.1.42:5173`) in Nimiq Pay on your phone (Mini Apps → Custom URL). Don't point the phone at `localhost` — that resolves to the phone itself, not your machine.

### Testing without a real wallet

`scripts/e2e/mock-nimiq-rpc.mjs` is a local stand-in for the Nimiq Albatross JSON-RPC node:

```bash
node scripts/e2e/mock-nimiq-rpc.mjs [--port 8792] [--host 127.0.0.1]
```

It exposes the same read methods the Worker calls for chain verification (`getTransactionByHash`, `getBlockNumber`, `getAccountByAddress`, `getTransactionsByAddress`, `sendRawTransaction`), plus test-control endpoints (`/__register`, `/__confirm`, `/__balance`, `/__fail`, `/__sent`, `/__transactions`, `/__health`) to stage transactions without touching a real chain. Point `NIMIQ_RPC_URL` in `apps/worker/.dev.vars` at it to verify handoffs against staged fixtures instead of a public node. This is also what the Playwright lifecycle E2E suite drives against, alongside a mocked Nimiq Pay provider in the page.

## Verification commands

```bash
pnpm lint
pnpm typecheck
pnpm test              # every workspace package's test suite
pnpm test:game         # game engine only
pnpm test:worker       # Worker only
pnpm test:e2e          # web Playwright E2E
pnpm test:replay       # game engine replay/golden-corpus tests
pnpm benchmark
pnpm build
pnpm preview:worker    # wrangler dev on port 8788, against a production build
pnpm verify:auth       # scripts/verify/auth-e2e.ts — live login flow against a running Worker
pnpm verify:runs       # scripts/verify/runs-e2e.ts — live run issue/submit flow
pnpm verify:handoff    # scripts/verify/handoff.ts — live handoff prepare/confirm flow
```

Deploys go through `scripts/deploy.sh testnet|mainnet`, which builds the client, runs `wrangler deploy` and then smoke-checks the live URL. `evidence/production/rebuild-2026-09-17.md` records what verification is run in practice around a deploy.

## Status

The rebuild described by `evidence/production/rebuild-2026-09-17.md` is deployed and live on both MainAlbatross (`nim-relay.timjosh507.workers.dev`, custom domain `nimrelay.xyz`) and TestAlbatross (`nim-relay-testnet.timjosh507.workers.dev`, custom domain `testnet.nimrelay.xyz`). This is not a scaffolding-in-progress state — auth, the game engine, the relay/handoff protocol, Relay Grants and the Atlas network are all implemented and covered by the test suite referenced above.
