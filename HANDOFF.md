# Handoff

State-of-the-build snapshot for anyone (human or agent) picking this up mid-build. Read this first, then `README.md` for the product overview, then `DECISIONS.md` for the full history of design pivots. Repo: https://github.com/winsznx/nim-relay

## Current state (2026-09-17)

The product went through two full gameplay redesigns before landing on what's live today. The early five one-axis "hold/release" challenges and the V2/V3 "Relay Run" race concepts are all superseded — see `docs/history/` for that record. The shipped game is the **Relay Leg** deterministic engine, now on **v6** (`packages/game-engine/src/relay-leg`): a lane-based road with real edges, world events, two forks, a pulse section, and `deriveGhostline()`. **v5** (`.../relay-leg-v5`) is frozen as deployed so runs already verified against it keep replaying byte-for-byte forever — new gameplay work only goes into v6. See `DECISIONS.md` D-008 (v6 freeze/cutover).

What's built and committed:

- **Relay Leg engine (v6 live, v5 frozen)** — server-side issuance and replay, route sectors, ghost lineage (the previous runner's verified trace races alongside you), serials, echoes, achievements, artifacts, Chronicles, runner profiles, machine-readable reason codes, reservation timeouts, crew code privacy.
- **Handoff ceremony state machine** — throw locks the intent, hands off to Nimiq Pay, independently verifies the transaction, and handles decline / insufficient funds / ambiguous recovery / rejection / duplicate submission / resume.
- **Product shell** — routed 3D Earth home (the Relay Atlas: 24 stations, 55 routes), journey view, Chronicle, proof page, social screens, and a 3D Relay Station home with diegetic surfaces.
- **Custom domains** — `nimrelay.xyz` and `testnet.nimrelay.xyz` are the primary domains (the old `workers.dev` addresses still resolve), with server-rendered Open Graph tags and preview images for shared links.
- **Relay Atlas and Relay Grants** — Grants (a capped, server-held treasury funding a starter baton for eligible new runners) is live on both testnet and mainnet; starter batons are excluded from every qualified-handoff metric so Grants can never inflate the game's real activity numbers (`starter-baton.ts`).
- **Audio** — CC0 music and SFX, race music locked to the sim clock, a ceremony score.
- **Race presentation** — courier, ghost courier, five worlds, set pieces, camera work and juice.
- **Identity/social** — identicons, share cards, profiles, crew streaks, rivals, Daily ranks.
- **First-run product tour and gameplay micro-tutorial** (`apps/web/src/features/tour`, `apps/web/src/features/race/tutorial`).
- The leg flow is wired end to end, including a fix for an RPC client bug where `fetch` was called as an instance method and threw `Illegal invocation` under the Workers runtime — no real handoff could verify until a mocked two-wallet browser test caught it (`docs/submission/submission.md`). A local two-runner lifecycle passes end to end with a mocked Nimiq Pay wallet and mock chain RPC.

## Immediate next step when resuming

1. Ops analytics view with alerts.
2. Testnet deploy of the integrated build, then a live smoke pass.
3. Real two-wallet handoffs on physical iPhones in Nimiq Pay: done on mainnet on 2026-09-18, with three verified legs (`evidence/production/first-mainnet-handoffs-2026-09-18.md`).
4. Relay Echoes rendered directly in the race world from issued echoes.
5. Live spectating status for an in-progress leg.
6. Physical iPhone profiling and adaptive quality tuning from real measurements.
7. Mainnet deploy, only after the testnet handoff is verified.
8. Refresh `README.md`, `CLAIMS.md`, and `evidence/production` once real device evidence exists.
9. Competition submission assets — cycle choice (Cycle II closes 2026-09-18, Cycle III closes 2026-10-30) still pending from the user.

## Known real bugs/toolchain issues found and fixed (don't reintroduce)

1. **`@nimiq/core` cannot be imported inside the Cloudflare Worker.** Empirically confirmed (`wasm2.__wbindgen_start is not a function` under real `workerd`). Backend Nimiq transaction verification uses plain JSON-RPC-over-HTTPS instead. Full writeup: `DECISIONS.md` D-001.
2. **`RelayRoom.webSocketClose` must not call `ws.close()` again** — it's a notification-only handler; doing so throws `InvalidAccessError` on a real disconnect (code 1005). Fixed; see `DECISIONS.md` D-005.
3. **Toolchain**: Workers tests run on `@cloudflare/vitest-plugin`, not the now-dead `@cloudflare/vitest-pool-workers` — see `DECISIONS.md` D-004.
4. **RPC `fetch` under Workers** — the v5 leg flow shipped with a bug where no handoff could verify because of how the RPC client issued requests inside the Worker runtime; fixed as part of wiring v5 end to end.

## Outstanding user-owned blockers

1. Choice of competition submission cycle (Cycle II vs Cycle III).
2. Topping up the mainnet Relay Grants treasury as grants are claimed.

## What exists in the repo right now

- Full monorepo: `apps/web` (Vite + React + TS, 3D Relay Station shell, race presentation, tour/tutorial, social/atlas/leg/handoff features), `apps/worker` (Hono + `RelayRoom` Durable Object + auth/session/nonce/device-hash, run issuance/replay, handoff verification), `packages/shared`, `packages/relay-protocol` (tx-data codec, `nimiq-rpc.ts`, `nimiq-verify.ts`), `packages/game-engine` (the v5 Relay Leg deterministic engine + golden corpus; earlier v1/v2/v3 engines preserved for old replays, not extended), `packages/test-utils`.
- `supabase/migrations/` — live schema on the project referenced in `DECISIONS.md` D-003.
- Control docs: `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `PRIVACY.md`, `SETUP.md`, `CONTRIBUTIONS.md`, `DECISIONS.md`, `CLAIMS.md`, `TASKS.md`, `BENCHMARKS.md`, `EVIDENCE.md`, `DEMO.md`, `HANDOFF.md` (this file), `run-state.json`, `DESIGN.md`. Earlier phase summaries, PRD v1, and the V2/V3 redesign docs are archived under `docs/history/` — see `README.md` for the current system description instead.
- CI (`.github/workflows/ci.yml`) mirrors the local gate: typecheck, lint, test, build.
- Public MIT repo at https://github.com/winsznx/nim-relay.
