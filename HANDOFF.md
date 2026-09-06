# Handoff

State-of-the-build snapshot for anyone (human or agent) picking this up mid-build. Read this first, then `run-state.json` for machine-readable state, then `docs/phases/PHASE_2_SUMMARY.md` for the latest phase detail. Repo: https://github.com/winsznx/nim-relay

## TOP BLOCKER (2026-09-06) — game redesign, relay-protocol work STOPPED

The 5 one-axis hold/release challenges are not competitive with the previous Nimiq Mini App winners. Relay-protocol implementation is **stopped**. Two design docs are written and are the required reading before any more gameplay code:

- `docs/GAMEPLAY_BENCHMARK_AUDIT.md` — deep audit of `github.com/nimjump/game` and `github.com/harlski/nspace` (full source reads: game scripts, backend models, admin, ops docs), with a ranked gap analysis. Short version: NIM Relay's engine + anti-cheat + wallet integration are at or above the bar; the *game* is far below it.
- `docs/RELAY_GAME_V2.md` — the redesign: one cohesive **45–75s Relay Run** (Catch → Slipstream traversal → Stabilize turbulence → Pulse Sync rhythm → Redline emergent risk → Sling = the NIM handoff), the previous runner's verified ghost racing alongside, a `(relaySeed, legNumber, sourceRegion, destRegion, relayState, echoes)` content generator, baton lineage as verified-history progression, Relay Echoes, and a **10-point Gameplay Quality Gate**. Engine v1 + corpus stay frozen; V2 is a new `relay-run` composite challenge at `challengeVersion 2.0.0` keeping every determinism/replay guarantee.

**Phase 5 is blocked until that gate passes.** All Phase 0–4 anti-cheat / HMAC issuance / server-replay / auth / Supabase work is preserved and unchanged.

## Current state (2026-09-06)

Phase 0: **PASS**. Phase 1: **PASS**. Phase 2: **in progress** (auth verified end
to end on a real phone; `SupabaseAuthStore` live). Phase 3: **in progress** —
Baton Physics engine `1.0.0` + all 5 challenges + playable `/play` client, built
by a delegated agent on the `game-engine` branch, reviewed and fast-forward
merged to `main` 2026-09-06.

Deployed: `https://nim-relay.timjosh507.workers.dev` — `/` is Nimiq Pay login,
`/play` is the solo Baton Physics challenges (no login). Gate green:
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, 312 tests (game-engine
240, worker 33, protocol 34, shared 3, web 4) plus corpus parity, mutation
checks and 7 Playwright browser tests.

Full detail: `docs/phases/PHASE_2_SUMMARY.md`, `docs/phases/PHASE_3_SUMMARY.md`.

## Phase 3 — what the delegated build delivered (commits `601369e`, `76ce4e7`)

- `packages/game-engine` — deterministic core: Q16.16 fixed-point (BigInt
  intermediates), SplitMix64 PRNG, pure 60Hz `step`, the PRD §7.6 trace format +
  typed validator, all 5 challenges, per-challenge scoring, `replay()` (the
  function Phase 4's Worker calls) with a full-final-state SHA-256 `resultHash`,
  and an immutable v1 version registry. No DOM/Math/Date/random/IO.
- **200-case committed corpus** verified byte-identical in Node, isolated
  `workerd`, Chromium and WebKit. Mutation testing proves the corpus catches
  drift. Fixtures deliberately not PRNG-generated.
- `apps/web/src/game` — PixiJS 8 renderer separate from the sim, accumulator
  fixed-tick stepping, trace recording, a live-sim-vs-canonical-replay assert,
  local ghost replay (labeled "not server-verified"), keyboard + full multi-touch
  lifecycle, `/play` route. On-brand visuals (dark navy, gold hex baton, cyan
  perfect-zone band).
- Boundaries respected: touched only `packages/game-engine/`,
  `apps/web/src/game/`, `apps/web/tests/`, an additive `App.tsx` route, and
  `artifacts/`. Nothing in `apps/worker/`, `relay-protocol/`, `shared/`,
  `supabase/` or deploy config.

Engine `1.0.0` is **version-frozen** — gameplay tuning adds a new
`challengeVersion` + corpus, never edits v1.

## Immediate next step when resuming

1. **Phase 4 — wire `replay()` into the relay** (owned here): server-side
   challenge issuance (signed config + HMAC, §7.8), `/api/runs/*` endpoints that
   replay the submitted trace server-side and derive the canonical score (§7.7),
   R2 artifact storage (§7.9), `game_runs` / `relay_legs` tables. Also the baton
   handoff state machine and `verifyHandoffTransaction` wiring (RPC lookup +
   confirmation-wait loop).
2. **Human playtest** the 5 challenges at `/play` — feel is unverified.
3. Bind `/verify` to the SDK-reported checksummed NQ address, not just the hex
   address derived from the public key.
4. Deep-link `/invite/<token>` path passthrough — test empirically (open
   verification item #2).
5. Phase 9: design RLS policies for every `public` table (all currently
   service_role-only).

## Two real bugs/toolchain issues found and fixed this session (don't reintroduce)

1. **`@nimiq/core` cannot be imported inside the Cloudflare Worker.** Empirically confirmed (`wasm2.__wbindgen_start is not a function` under real `workerd`). Backend Nimiq transaction verification uses plain JSON-RPC-over-HTTPS instead. Full writeup: `DECISIONS.md` D-001.
2. **`RelayRoom.webSocketClose` must not call `ws.close()` again** — it's a notification-only handler; doing so throws `InvalidAccessError` on a real disconnect (code 1005). Fixed; see `DECISIONS.md` D-005. Caught only by a *live* smoke test, not the unit test — keep doing live `wrangler dev` smoke passes for anything Hibernation-API-related, unit tests alone won't catch this class of bug.
3. **Toolchain churn**: `@cloudflare/vitest-pool-workers` is effectively dead for this stack right now (broken under Node 24.19, and Cloudflare has moved to `@cloudflare/vitest-plugin` for Vitest v4). Already migrated — see `DECISIONS.md` D-004. If a future `pnpm install` silently reverts this via a stale lockfile entry, that's a regression, not a preference.

## Open Nimiq verification items (all deferred to Phase 2 on purpose, not forgotten)

1. **RESOLVED** (`DECISIONS.md` D-006) — `rpc.nimiqwatch.com` = MainAlbatross, `rpc.testnet.nimiqwatch.com` = TestAlbatross, confirmed by live block-height cross-referencing in both directions.
2. **OPEN** — whether `/invite/<token>`-style nested paths survive the Nimiq Pay deep-link opener round-trip. Not yet tested.
3. **PARTIALLY RESOLVED** — the message-signing byte layout is cross-checked against a golden vector from the real `@nimiq/core` build (`evidence/testnet/phase2-nimiq-signature-vector.md`, verified by `packages/relay-protocol/src/nimiq-verify.ts`). Still open: confirming the Mini App SDK `sign()` path on a real physical device follows the same construction end to end.

Full detail: `docs/phases/PHASE_2_SUMMARY.md`, `docs/PHASE_0_VERIFICATION.md` §7, `DECISIONS.md` D-001/D-002/D-006.

## Outstanding user-owned blockers (see `run-state.json`)

1. ~~Supabase credentials~~ — resolved 2026-09-03 (project, DB password, service_role key all provided; auth flow verified against the live DB).
2. Physical phone with Nimiq Pay installed (blocks Phase 2's real-device gate and everything downstream that needs a real wallet action).
3. Real NIM on MainAlbatross (blocks Phase 10 production launch only — far off, not urgent yet).

## What exists in the repo right now

- Full monorepo scaffold: `apps/web` (Vite+React+TS shell), `apps/worker` (Hono + `RelayRoom` Durable Object + R2 binding + cron stub + `src/auth/` session/nonce/device-hash primitives, uncommitted), `packages/shared` (money/state types, tested), `packages/relay-protocol` (tx-data codec per PRD §9.5 + `nimiq-rpc.ts` + `nimiq-verify.ts`, tested; last two uncommitted), `packages/game-engine` (version-binding scaffold only — real Baton Physics is Phase 3), `packages/test-utils` (placeholder).
- `supabase/migrations/0001_init.sql` — full schema, not yet live (see above).
- All 15 required control docs from PRD §0.2 (`README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `SETUP.md`, `CONTRIBUTIONS.md`, `DECISIONS.md`, `CLAIMS.md`, `TASKS.md`, `BENCHMARKS.md`, `EVIDENCE.md`, `DEMO.md`, `HANDOFF.md`, `run-state.json`, `DESIGN.md`) plus `docs/PHASE_0_VERIFICATION.md` and per-phase summaries in `docs/phases/`.
- CI (`.github/workflows/ci.yml`) mirrors the local gate: typecheck, lint, test, build.
- 38 passing unit/integration tests (money conversion, tx-data codec adversarial cases, Nimiq RPC client, Nimiq signed-message golden-vector check, session/nonce/device-hash, a real in-`workerd` health-endpoint test) — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green as of 2026-09-03.
- Public MIT repo at https://github.com/winsznx/nim-relay. Three commits: `fc2f74d` Phase 0 scaffold, `57ea824` gitignore fix, `c798da8` Phase 1. The Phase 2 work described above is uncommitted in the working tree. Local `main` matches `origin/main`.
