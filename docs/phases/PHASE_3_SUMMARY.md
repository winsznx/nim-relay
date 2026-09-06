# Phase 3 Summary — Baton Physics deterministic engine

**Status: IN PROGRESS.** The engine and a playable solo-challenge client were
built on the `game-engine` branch by a delegated agent (Codex), reviewed here,
and fast-forward merged to `main` on 2026-09-06 (`601369e`, `76ce4e7`). Deployed
at `https://nim-relay.timjosh507.workers.dev/play`.

## What landed

### `packages/game-engine` — the deterministic core (PRD §7)

- **`fixed-point/`** — Q16.16, `BigInt` intermediates, truncate-toward-zero. All
  canonical math routes through it.
- **`prng/`** — SplitMix64 with explicit UTF-16/FNV seed hashing. No runtime APIs.
- **`simulation/`** — pure `createState(config)` / `step(state, input, tick)`,
  fixed 60 ticks/second, integer tick counter.
- **`input/`** — the PRD §7.6 binary-transition trace format `[[tMs, 0|1], …]`
  plus a validator that returns typed errors (shape / count / size / timestamp /
  order / after-end / value / transition / duration) and never throws.
- **`challenges/`** — all five: Stabilize, Slipstream, Pulse Sync, Sling, Redline,
  each a frozen `{ id, version: '1.0.0', deriveConfig, initialState, step }`.
- **`scoring/`** — per-challenge integer `score` + signed `breakdown`.
- **`replay/`** — `replay({ engineVersion, challenge, challengeVersion, seed,
  difficulty, durationMs, inputTrace })` is the function the Worker will call in
  Phase 4. `resultForState` binds the **entire** final simulation state into a
  hand-rolled SHA-256 `resultHash`, so a one-unit drift is detectable even when
  the displayed score is unchanged. `rulesHash` per §7.3/§7.8.
- **`versions/`** — `ENGINE_VERSION = '1.0.0'`, immutable v1 handler registry.
  New challenge versions add handlers; v1 and its corpus never change.
- No DOM / `Math` / `Date` / `performance` / random / timers / I/O anywhere in
  the package (verified by review).

### Determinism evidence (the point of the whole phase)

- **200-case immutable corpus** (`tests/corpus/expected.json`, committed): 40 per
  challenge, 200 distinct seeds, 10 difficulties, 4 durations, and
  empty/held/boundary/dense/periodic/jittered input patterns. Fixtures are
  deliberately **not** generated with the engine PRNG, so a PRNG mutation changes
  results rather than silently regenerating matching fixtures.
- **Cross-runtime parity**: every corpus case produces a byte-identical
  `resultHash` in **Node, isolated `workerd`** (a `@cloudflare/vitest-plugin`
  harness that never loads the deployed Worker, its config or bindings),
  **Chromium and WebKit**.
- **Mutation testing** (`tests/mutation-check.mjs`): breaking the SplitMix64
  constant, the fixed-point divisor, or a scoring constant fails 199 / 183 / 38
  corpus cases in a sandboxed source copy; every restore passes again.
- The `/play` client asserts its live simulation and the canonical replay of its
  own recorded trace agree, and throws if they diverge.

### `apps/web/src/game` — playable client

- PixiJS 8 renderer, strictly separate from the sim. Accumulator-based fixed-tick
  stepping (no elapsed time discarded). Trace recorded on input transitions only.
- Local ghost replay from `localStorage`, re-validated and re-scored, rendered as
  a translucent baton with live and final deltas — labeled "Local replay ·
  not server-verified" everywhere.
- Keyboard (Space / P / R) **and** multi-touch, with full pointer lifecycle
  (capture, cancel, lost-capture, blur → pause, visibilitychange → pause,
  orientationchange → pause; held inputs cleared on pause/resume/start/results).
- `/play` route (client-routed; the Worker's SPA fallback serves it). Login stays
  at `/`, no auth needed to play.
- On-brand visuals: dark navy field with particle texture, gold hexagon baton
  with comet trail, cyan perfect-zone band, glass HUD with tabular numerics.

## Gate

`pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` exits 0.
Tests: game-engine 240, worker 33, relay-protocol 34, shared 3, web-controller 4.
Plus `tests/parity` (workerd), `mutation-check.mjs`, and 7 Playwright browser
tests (including touch-only multi-finger completion). Screenshots in `artifacts/`.

## Boundaries respected

The delegated build touched only `packages/game-engine/`, `apps/web/src/game/`,
`apps/web/tests/`, a minimal additive change to `apps/web/src/app/App.tsx` (adds
the `/play` route, keeps the login UI), and `artifacts/`. It did **not** touch
`apps/worker/`, `packages/relay-protocol/`, `packages/shared/`, `supabase/`, any
deploy or secret config. No push, no deploy by the agent.

## Remaining

- **Human playtest** the five challenges — gameplay feel is unverified; no person
  has played them yet. Tuning goes through a `challengeVersion` bump + a fresh
  corpus, keeping v1 intact.
- **Physical Nimiq Pay iOS WebView 60fps — NOT VERIFIED.** Headless Chromium
  (390×844, DPR 2) measured ~59.8 Hz / 16.7 ms mean frame interval, 3 WebGL draw
  calls/frame. Browser emulation is not hardware evidence.
- Phase 8 does the premium visual polish pass; the current look is a solid
  on-brand first pass, not final.

## Next (Phase 4, owned here)

Wire `replay()` into the Worker: server-side challenge issuance (signed config +
HMAC, §7.8), `/api/runs/*` endpoints that replay the submitted trace server-side
and derive the canonical score (§7.7), R2 artifact storage (§7.9), and the
`game_runs` / `relay_legs` tables.
