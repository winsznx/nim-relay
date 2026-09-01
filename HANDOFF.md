# Handoff

State-of-the-build snapshot for anyone (human or agent) picking this up mid-build. Read this first, then `run-state.json` for machine-readable state, then `docs/phases/PHASE_1_SUMMARY.md` for the latest phase detail. Repo: https://github.com/winsznx/nim-relay

## Current state (paused here at user request)

Phase 0: **PASS**. Phase 1: **in progress, 4/5 gate items passing with live evidence**, paused for handoff rather than blocked on a technical problem.

Phase 1 gate status:
- Local build (web + worker): **PASS**
- Worker preview (`wrangler dev`, live, twice): **PASS**
- WebSocket hello/reconnect against the real `RelayRoom` Durable Object: **PASS**, evidence in `evidence/local/phase1-websocket-hello-reconnect-smoke.log`
- Mobile app shell (Vite React app, `/api/health` reachable through the LAN dev proxy): **PASS**
- Database migration: **BLOCKED** — `supabase/migrations/0001_init.sql` is written (full PRD §15 schema, 24 tables, reviewed manually) but **not yet applied to a live database**. No Docker on this machine (can't run `supabase start` locally) and no dedicated NIM Relay Supabase project yet.

## Immediate next step when resuming

1. **Get Supabase credentials from the user** for the fresh account they mentioned providing (not the CLI-linked account — see `DECISIONS.md` D-003). Run `supabase link --project-ref <ref>` then `supabase db push` from repo root. Verify all 24 tables/enums create cleanly; fix forward and re-verify if anything in the migration doesn't apply as written (it has not been tested against a real Postgres yet).
2. Close the Phase 1 gate, write the commit, update `run-state.json` phase 1 → `PASS`.
3. Move to **Phase 2 — Nimiq bridge and session** (`TaskList` task #3). Start with the three open verification items below — they're Phase 2's actual first work, not optional extras.

## Two real bugs/toolchain issues found and fixed this session (don't reintroduce)

1. **`@nimiq/core` cannot be imported inside the Cloudflare Worker.** Empirically confirmed (`wasm2.__wbindgen_start is not a function` under real `workerd`). Backend Nimiq transaction verification uses plain JSON-RPC-over-HTTPS instead. Full writeup: `DECISIONS.md` D-001.
2. **`RelayRoom.webSocketClose` must not call `ws.close()` again** — it's a notification-only handler; doing so throws `InvalidAccessError` on a real disconnect (code 1005). Fixed; see `DECISIONS.md` D-005. Caught only by a *live* smoke test, not the unit test — keep doing live `wrangler dev` smoke passes for anything Hibernation-API-related, unit tests alone won't catch this class of bug.
3. **Toolchain churn**: `@cloudflare/vitest-pool-workers` is effectively dead for this stack right now (broken under Node 24.19, and Cloudflare has moved to `@cloudflare/vitest-plugin` for Vitest v4). Already migrated — see `DECISIONS.md` D-004. If a future `pnpm install` silently reverts this via a stale lockfile entry, that's a regression, not a preference.

## Open Nimiq verification items (all deferred to Phase 2 on purpose, not forgotten)

1. Which network (`TestAlbatross`/`MainAlbatross`) `rpc.nimiqwatch.com` (or any other RPC candidate) actually serves — confirm before using it for any real verification.
2. Whether `/invite/<token>`-style nested paths survive the Nimiq Pay deep-link opener round-trip — test empirically before locking the invite URL encoding.
3. The exact Nimiq message-signing byte layout for backend login-challenge verification — capture a real signature from a physical device via `sign()` and derive/cross-check against `@noble/ed25519` before any session-auth code depends on it.

Full detail on all three: `docs/PHASE_0_VERIFICATION.md` §7, `DECISIONS.md` D-001/D-002.

## Outstanding user-owned blockers (see `run-state.json`)

1. Supabase credentials (blocks closing Phase 1 — see above).
2. Physical phone with Nimiq Pay installed (blocks Phase 2's real-device gate and everything downstream that needs a real wallet action).
3. Real NIM on MainAlbatross (blocks Phase 10 production launch only — far off, not urgent yet).

## What exists in the repo right now

- Full monorepo scaffold: `apps/web` (Vite+React+TS shell), `apps/worker` (Hono + `RelayRoom` Durable Object + R2 binding + cron stub), `packages/shared` (money/state types, tested), `packages/relay-protocol` (tx-data commitment codec per PRD §9.5, tested), `packages/game-engine` (version-binding scaffold only — real Baton Physics is Phase 3), `packages/test-utils` (placeholder).
- `supabase/migrations/0001_init.sql` — full schema, not yet live (see above).
- All 15 required control docs from PRD §0.2 (`README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `SETUP.md`, `CONTRIBUTIONS.md`, `DECISIONS.md`, `CLAIMS.md`, `TASKS.md`, `BENCHMARKS.md`, `EVIDENCE.md`, `DEMO.md`, `HANDOFF.md`, `run-state.json`, `DESIGN.md`) plus `docs/PHASE_0_VERIFICATION.md` and per-phase summaries in `docs/phases/`.
- CI (`.github/workflows/ci.yml`) mirrors the local gate: typecheck, lint, test, build.
- 13 passing unit/integration tests (money conversion, tx-data codec adversarial cases, a real in-`workerd` health-endpoint test) — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green as of this pause.
- Public MIT repo live at https://github.com/winsznx/nim-relay (two commits pushed so far: Phase 0 scaffold, gitignore fix; this pause's Phase 1 work is about to be committed).
