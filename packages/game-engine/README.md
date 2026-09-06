# Baton Physics 1.0.0

A pure, version-bound 60 Hz engine for Stabilize, Slipstream, Pulse Sync, Sling and Redline. The public `/play` client is backend-free; login remains at `/`. Local ghosts contain input transitions only and are explicitly **not server-verified**.

## Determinism contract

`createState(config)` and `step(state, input, tick)` return new state without mutating their arguments. Canonical values are integers with Q16.16 fractional precision (65536 units per whole); multiplication/division use BigInt intermediates and truncate toward zero. PRNG is SplitMix64 with explicit UTF-16 seed hashing. No clock, random source, renderer, timers, browser APIs or I/O participate in simulation. Display interpolation never feeds back.

Use `replay({ engineVersion, challenge, challengeVersion, seed, difficulty, durationMs, inputTrace })`. It returns integer `score`, signed score contributions in `breakdown`, `rulesHash` and a SHA-256 `resultHash` binding configuration, rules, inputs and **every final simulation field**. `resultForState` allows the client to compare its live final state with the replay hash. SHA-256 has standard known-vector tests. Hash serialization fixes field order and escapes non-ASCII UTF-16 units.

Binary transitions are `[[tMs, 1], [tMs, 0], …]`, starting released. The validator returns typed errors without throwing: shape, count, size, timestamp, ordering, after-end, value, transition, or duration. Maximum 4096 events / 32768 canonical JSON bytes; no duplicate timestamps or redundant transitions. Events must satisfy `0 <= tMs < durationMs`. Tick `t` consumes events with `tMs * 60 <= t * 1000`. The client records `floor(tick * 1000 / 60)`, once per effective input transition. Runs accept integer 15000–30000 ms, ceil to the next 60 Hz tick (the 30000 ms hard cap is exactly 1800 ticks). Difficulty is 1–10; seeds contain 1–128 UTF-16 units.

Invalid replay traces throw `ReplayError` carrying the validator code/index; invalid configurations throw `RangeError`. Server issuance, HMAC, persistence and verification status are intentionally outside this package. Never treat a local client score as authoritative.

`CHALLENGE_VERSIONS` retains explicit v1 handlers. Keep their implementation and corpus immutable when introducing new versions; add handlers rather than changing old rules. The former 0.1.0 scaffold had no runnable simulation and is not advertised as replayable.

## Run and verify

From repository root:

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm test:replay
pnpm --filter @nim-relay/game-engine exec vitest run --config tests/parity/vitest.config.mts
node packages/game-engine/tests/mutation-check.mjs
pnpm --filter @nim-relay/web exec vitest run src/game/controller.test.ts
pnpm --filter @nim-relay/web exec tsc --noEmit -p tests/tsconfig.json
pnpm --filter @nim-relay/web exec playwright test --config playwright.game.config.ts
pnpm --filter @nim-relay/web exec playwright test --config playwright.game.config.ts --browser webkit tests/game-parity.spec.ts
pnpm dev
```

Open `http://localhost:5173/play`. The isolated workerd harness uses the already-installed Cloudflare Vitest plugin, without loading application Worker source, Wrangler config or bindings ([configuration reference](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)). Tests require local socket and browser-launch permission.

The committed corpus contains 200 explicit configurations/traces: 40 per challenge, 200 seeds, ten difficulties, four durations, empty/held/end-boundary/dense/periodic/jittered patterns. Node and workerd tests each compare exact JSON results to snapshots, rerun them, and compare incremental simulation final hashes. Browser parity executes the same exports and corpus in Chromium/WebKit. Deliberate PRNG, multiplication and scoring mutations run in disposable source copies and must fail snapshots, then pass after restoration. To **deliberately** regenerate fixtures after reviewing a version change:

```sh
node --import tsx packages/game-engine/tests/corpus/generate.ts
```

## Controls and presentation

Touch the large action pad or hold **Space**; **P** pauses/resumes, **R** restarts. Stabilize builds/releases energy into a moving corridor. Slipstream and Redline steer right while held, left on release. Pulse Sync taps as the expanding cyan ring meets the gold ring; tempo changes between cycles. Sling charges while held and releases toward the top target, cyan power band and timing marker; only one shot scores per cycle. The next run of the same challenge automatically loads the previous local trace with prior score, translucent baton, live and final deltas. Stored artifacts contain no identities, wallet/session/device data.

The Pixi renderer caps DPR at 2, uses procedural Graphics without asset textures, and counts WebGL drawArrays/drawElements plus instanced variants. Results expose requestAnimationFrame interval mean/p95, frame count, duration, draw-call maximum and DPR. These are session measurements, not physical-device FPS certification. Browser tests run real countdowns and full 20-second input sessions; they never accelerate clocks or alter scores.

Screenshots: `artifacts/game-{stabilize,slipstream,pulse-sync,sling,redline,results,ghost,mobile-portrait}.png`.

Actual Nimiq Pay iOS WebView/device performance requires hardware verification. The referenced moodboard PNG was absent; DESIGN.md and existing tokens supplied the visual authority.

## Verification recorded 2026-09-06

Node 24.19.0 / pnpm 11.21.0: the exact install → typecheck → lint → test → build gate exited 0 (engine 240, shared 3, protocol 34, Worker 33 tests). Additional engine/client/E2E ESLint, E2E strict TypeScript, and all four client-controller tests passed. The 200-case corpus matched in Node, isolated workerd (201 checks), Chromium and WebKit. PRNG/multiply/scoring mutations failed 199/183/38 corpus cases respectively; every restored copy passed all 201 checks.

All seven distinct browser acceptance cases passed: six in the full run, then desktop/ghost plus parity in a two-test rerun after a development-server reload interrupted that case. Inputs ran for real 20-second sessions. The touch-only test includes simultaneous fingers, release-one/keep-one behavior, cancellation, and final recorded transitions. All eight screenshots above were captured and inspected.

Portrait headless Chromium, 390×844 at DPR 2: 1196 measured frame intervals across 20000.9 ms; mean **16.723 ms** (about **59.8 Hz**), p95 **17.5 ms**, maximum **3 WebGL draw calls/frame**. A separate 180-frame RAF sample averaged 16.667 ms. Actual Nimiq Pay iOS WebView rendering and device 60fps remain **NOT VERIFIED**; browser emulation is not hardware evidence.
