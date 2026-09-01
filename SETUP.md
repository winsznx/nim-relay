# Setup

Fresh clone to local development. This file is kept accurate against a real clean-room run (`scripts/clean-room/run.sh`, Phase 9) — if a step here doesn't work from a fresh clone, it's a bug in this file.

## Prerequisites

- Node.js 22+ (`.nvmrc` pins `22`)
- pnpm (`corepack enable` or `npm i -g pnpm`)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI, authenticated (`wrangler login`)
- [Supabase](https://supabase.com/docs/guides/cli) CLI, authenticated (`supabase login`)
- A phone with Nimiq Pay installed, on the same Wi-Fi/LAN as your dev machine, for real device testing

## Install

```bash
pnpm install
cp .env.example .env
# fill in .env with local/dev values — never commit real secrets
```

## Local development

```bash
pnpm dev:worker   # starts the Cloudflare Worker (Hono + Durable Objects) under `wrangler dev`
pnpm dev          # starts the Vite app with --host, proxying /api and /ws to the local Worker
```

Note the Vite "Network" URL it prints (e.g. `http://192.168.1.42:5173`). Open Nimiq Pay on your phone → Mini Apps → Custom URL → paste that address. Do not point the phone at `localhost` — that resolves to the phone itself.

## Database

```bash
supabase link --project-ref <project-ref>
supabase db push
```

## Verification commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:game
pnpm test:worker
pnpm test:e2e
pnpm test:security
pnpm test:replay
pnpm benchmark
pnpm build
pnpm preview:worker
pnpm verify:deployment
pnpm verify:testnet
pnpm verify:mainnet
pnpm clean-room
```

## Status

This file describes the target developer workflow. As of Phase 1, `apps/web` and `apps/worker` scaffolding is in progress — see `run-state.json` for what currently runs.
