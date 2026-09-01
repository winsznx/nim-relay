# Handoff

State-of-the-build snapshot for anyone (human or agent) picking this up mid-build. Updated at the end of every phase — read this first, then `run-state.json` for machine-readable state, then the latest `docs/phases/PHASE_N_SUMMARY.md`.

## Current state
Phase 0 complete (PASS). Phase 1 (repository and infrastructure foundation) in progress.

## What exists
- Monorepo scaffold (pnpm workspaces), root TypeScript/lint/test config groundwork.
- `docs/PHASE_0_VERIFICATION.md` — full API verification findings.
- `DECISIONS.md` — D-001 (Nimiq backend verification uses plain JSON-RPC, not `@nimiq/core`, backed by an empirical `workerd` spike), D-002 (Nimiq message-signing scheme deferred to an empirical Phase 2 spike), D-003 (fresh Supabase project).
- Control docs (`ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `CLAIMS.md`, `BENCHMARKS.md`, `EVIDENCE.md`, `DEMO.md`, this file) written as living documents — most sections marked `TARGET`/planned since no product surface exists yet to verify against.

## What's next
Finish Phase 1: apps/web (Vite+React+TS), apps/worker (Hono+DO+R2), Supabase migrations, local same-origin proxy, CI, then the Phase 1 gate (local build, Worker preview, DB migration, WS hello/reconnect, mobile app shell).

## Outstanding user-owned blockers (see `run-state.json`)
1. Supabase credentials for a fresh account (needed to apply live migrations, end of Phase 1).
2. Physical phone with Nimiq Pay for real-device testing (needed from Phase 2 onward).
3. Real NIM on MainAlbatross to fund the flagship relay (needed at Phase 10).

## Open technical verification items (see `DECISIONS.md`)
1. RPC network identity for candidate public Nimiq RPC hosts.
2. Nimiq Pay deep-link path/query passthrough behavior.
3. Nimiq message-signing byte layout (needs a real-device-produced signature to confirm).
