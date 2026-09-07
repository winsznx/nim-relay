# Relay Game V2 — the playable layer redesign  ·  SUPERSEDED / FROZEN

> **This design failed the human playability gate (2026-09-06).** The Phase 3.6 slice
> was built and deployed; a tester played it and could not understand the objective,
> scoring, or mechanics — six named systems in a 45-second run created cognitive load,
> not depth. V2 is frozen on branch `experimental/relay-run-v2` (commit `594edbd`) as a
> regression reference and is not being extended. **The active playable-layer design is
> `docs/RELAY_GAME_V3.md`.** What carries forward from V2: the deterministic engine
> contract, the quantized-analog input format, the two-stage handoff model (§2.6), and
> the anti-cheat / server-replay architecture — nothing about the interaction model or
> the six-system structure.

---

Status: design, superseded by V3. Retained for the reasoning and the parts V3 reuses.

Companion: `docs/GAMEPLAY_BENCHMARK_AUDIT.md` (why this is necessary).

Hard constraint, restated: **preserve every deterministic-engine and server-replay
guarantee.** We already paid for that infrastructure. Extend or version the engine.
Never discard anti-cheat correctness for game feel.

---

## 1. The core idea: one Relay Run

Replace "pick one of five 20-second gauge exercises" with **one continuous 45–75 second
Relay Run**: you *are* the baton, flying a procedurally generated route from a source
region to a destination region across a stylized world, racing the previous runner's
ghost, and finishing by physically slinging the baton to the next runner — which is the
real NIM transaction.

The five old challenge concepts are not deleted; they become **systems inside the run**:

| Old challenge | Becomes | Where in the run | Duration |
|---|---|---|---|
| Catch (new) | Incoming-baton opening | 0–4 s | one beat |
| **Slipstream** | Primary traversal system | ~55–65% of the run | continuous |
| **Stabilize** | Mid-run turbulence control | 1–2 windows | ~6 s each |
| **Pulse Sync** | Rhythm / environment sequence | 1 window | ~8 s |
| **Redline** | Emergent high-risk state | anytime | continuous, latent |
| **Sling** | Final launch + NIM handoff | last 4–6 s | one beat |

One thumb throughout. Understandable in seconds (it's "fly the comet, thread the gates,
don't overheat, land the throw"). Deep enough that a 20-session player is materially,
visibly better than a 1-session player.

---

## 2. Run structure and the six systems

### 2.1 Catch (0–4 s) — receiving the baton

The previous runner's Sling (or, for the flagship leg 1, the world) throws the baton in
from off-screen along a predicted arc. A shrinking reticle converges on the catch point.
One input: tap/hold at the right moment.

- **Clean catch** → full starting momentum, combo seed +1, the ghost starts level with
  you.
- **Graze** → reduced starting momentum.
- **Fumble** → you start slow, ~1.5 s behind the ghost, no combo seed.

The catch difficulty is set by how clean the *previous* runner's Sling was — so a great
run by the person before you is a gift, a sloppy one is a handicap you carry. This is the
first place the relay is *social*, not solo.

### 2.2 Slipstream (traversal) — the spine of the run

The baton auto-flies forward down the route at a speed that rises with your score. One
input: **quantized analog horizontal steering** (one thumb, portrait) — where your thumb
sits along the bottom control zone is where the baton wants to be, mapped through a
deterministic quantization grid (§7.1). A separate **pressed/released** channel is the
contextual action (Catch timing, Pulse taps folded into steering intent, Sling charge).
No control inversion, ever.

The route contains:

- **Gates** — pass through; **center** = boost + score + combo, **graze** = small score,
  **miss** = speed penalty + combo reset. Gate spacing tightens with pace (dynamic
  difficulty, seeded).
- **Hazards** — crosswind bands, drift fields, tumbling debris — that apply lateral force
  you must anticipate and counter-bank against.
- **Route forks** — 2–3 commit points per run. A **wide line** (safe, standard score) or
  a **tight line** (a visible shortcut: shorter, worth ~1.6×, but narrow and it spikes
  your heat — see Redline). The ghost's fork choice is visible a beat before yours, so
  their run informs your gamble.
- **Collectibles** — trail motes along the ideal racing line; a full string grants a
  short overdrive. Rewards reading the optimal path, not just survival.

### 2.3 Stabilize (turbulence windows) — 1–2 × ~6 s

The baton flies through a storm cell / updraft. Turbulence changes **learnable physical
parameters** of the baton for the window — never the control mapping. Any mix of:

- **higher inertia** — the baton is heavier, responds slower, overshoots more;
- **lateral drift** — a steady or slowly-oscillating environmental force pushes the baton
  off your intended line, which you lead and counter-steer against (the force is visible
  in the world — bent debris, streaked light);
- **reduced steering strength** — your input authority is throttled, so you must start
  corrections earlier;
- **angular instability** — the baton yaws; you damp it by holding a steady line rather
  than chasing.

A **safe corridor** still narrows toward the exit. Hold it → clean break, combo intact,
small time refund. Fall out → you exit off-line and behind, corridor time counts against
you. Every parameter is announced by the world a beat before it bites and is the same on
every replay — turbulence is a skill you get better at, not a surprise that flips your
thumb. Seed places the windows to interrupt a flow state (after a fast clean stretch, or
just before a fork).

### 2.4 Pulse Sync — a resonance layer *inside* traversal (not a separate screen)

There is no rhythm minigame and no stop in traversal. On a **Pulse section** of the route
the music, the gates and the environment become one system:

- gates on the pulse section **breathe** open/closed on the beat; the ideal racing line
  through them is a rhythmic weave you steer, not a series of taps;
- passing a gate **on its open beat** stacks a combo multiplier (`×2 … ×5`) and flares the
  baton with the track; passing off-beat still gets you through (reduced score), it just
  doesn't stack;
- the whole scene pulses with the bed so the section *feels* different while you keep
  doing the one thing you've been doing — steering the baton.

Tempo shifts once mid-section so the weave can't be memorised as a fixed path. This is a
feel showcase folded into the spine of the game, not a detour.

### 2.5 Redline (emergent risk state) — latent, whole-run

A **heat meter** fills whenever you push: riding a tight fork line, holding an overdrive,
carrying a high combo. It cools when you play the wide line / drop the overdrive / break
combo.

- In the **greedy zone** near the top, score gain scales up sharply.
- **Redline it** (heat hits max) → **Overheat**, a purely in-run consequence: for ~1 s
  the baton's steering authority is cut hard (it keeps flying forward, you can still nudge
  it — you never "lose the baton"), the **combo multiplier resets to ×1**, and **heat
  dumps to zero**. That's the whole failure. The ghost, if ahead of you at that moment,
  extends its lead because you're slow to correct.

Redline **never** costs, burns, locks, or transfers the holder's NIM. There is no
monetary consequence anywhere in the run — the baton's value and the player's economic
rights are untouched by anything that happens in gameplay. Redline is score risk only:
"push this line for the multiplier, or bank the points I already have."

A skilled player rides the greedy zone at ~90% heat and dumps it deliberately before a
turbulence window; a new player either never engages it or overheats on every fork.

### 2.6 Sling — a two-stage handoff (launch input → wallet → cinematic arrival)

The route ends at the destination. The baton must be **launched** to the next runner.

**Stage 1 — the throw (in-game, deterministic, immutable).** Charge-and-aim: build power
while your aim sweeps the destination arc; commit. **Angle + power + timing** accuracy is
recorded into the run trace and **frozen** — this is canonical run input and cannot
change after this point. It sets your final score multiplier (up to ~2×) and the
*intended* Catch difficulty for the next runner (§2.7).

**Stage 2 — the launch threshold + wallet confirm.** The baton accelerates to a dramatic
**launch threshold** and **freezes there**, mid-arc, trailing light. The game hands off to
**native Nimiq Pay** for transaction confirmation (the handoff intent + tx-data commitment
were staged server-side before Stage 1 — PRD §9.4). The player confirms in the wallet.

**Stage 3 — resume.** When the app regains control and the transaction has entered the
appropriate state, the frozen baton **releases** and completes its cinematic launch into
the next runner's hands. **Canonical baton arrival still requires server-side transaction
verification** (`verify-transaction.ts`, PRD §9.6) — the cinematic is presentation; the
relay's canonical holder only advances after the Worker independently confirms the tx.
If the wallet is cancelled/fails, the run's score stands as a solo result and the baton
stays put (reroute — PRD §10.1). The player's thrown input is never replayed or re-asked;
only the transaction step is retried.

This ordering means the skill moment (the throw) is locked *before* any wallet UI, so the
wallet step can never be blamed for a bad launch, and a slow confirmation can't cost the
player a good throw.

### 2.7 Leg inheritance — the previous runner shapes your run (non-monetary, capped)

A runner's **canonical, server-verified performance** on their leg generates a small
bounded **baton carry-state** that seeds the *next* leg. This is the second way the relay
is social, and it is strictly non-monetary and safety-capped.

| Carry-state | Derived from previous leg | Effect on next leg | Cap |
|---|---|---|---|
| `incomingMomentum` | previous final speed & clean-gate ratio | starting forward speed of the Catch/opening | clamped to `[0.85, 1.15]` of baseline |
| `incomingStability` | previous turbulence-window performance | starting inertia/damping of your baton for the first ~10 s | clamped to `[0.9, 1.1]` of baseline |
| `incomingTrajectory` | previous Sling angle | the arc the baton flies in on — which side of the field you start Catch from | bounded to on-screen, always catchable |
| `catchDifficulty` | previous Sling power+timing accuracy | reticle speed / window size of your Catch | clamped so even the worst previous Sling yields a Catch that a first-timer can graze |

**Equations (slice values, tune later):**

```
momentum_in   = clamp(0.85 + 0.30 * prevCleanGateRatio,           0.85, 1.15)
stability_in   = clamp(1.10 - 0.20 * prevTurbulenceScoreNorm,       0.90, 1.10)
catch_window   = clamp(BASE_CATCH_WINDOW * (1.4 - 0.8 * prevSlingAccuracy), 0.45 * BASE, 1.4 * BASE)
trajectory_in  = quantize(prevSlingAngle, TRAJECTORY_GRID)   // never off-screen
```

**Hard invariant:** no combination of previous-runner inputs can make a later leg
impossible or unwinnable. Every carry-state is clamped to a band around baseline, and the
clamps are part of the deterministic sim (server-reproducible). A disastrous previous run
makes your run *slightly harder to start*, never unplayable. Inheritance never touches
score directly — only the physical starting conditions, which a skilled player overcomes.

---

## 3. The ghost — the previous runner, physically present

The previous leg's **canonical, server-verified input trace** is replayed by the same
deterministic engine against the **same `relayRunConfig`**, stepped tick-for-tick
alongside the live player.

- The ghost baton is rendered translucent, in the same world, on the same route, in real
  time — threading the same gates, choosing a fork a beat ahead of you, redlining or
  playing safe.
- Live position/score delta on the HUD; a "catch-up" or "pulling away" cue.
- **Beating the ghost's final score wins the leg** → XP, streak credit, a lineage mark
  (§5), a social notification to the previous runner ("{you} beat your leg 24 by 1,340").
- Ghost data is **inputs only** (PRD §8.4): handle, prior score, trace. Never wallet,
  device, IP, session.

The ghost must *materially change how the run feels* (a quality-gate criterion): their
fork choice de-risks or bluffs your gamble, their redline blowout is your window, the
final 6 seconds are a genuine race to the Sling. A run with the ghost hidden should feel
noticeably flatter — if it doesn't, the ghost integration failed.

This is the pattern the current `/play` already implements (step a trace alongside the
live sim), upgraded from "your own last local run" to "a real other player's verified
run."

---

## 4. Content architecture — deterministic composition of authored modules

**Not** unconstrained procedural geometry. A route is assembled by the seed from a
library of **hand-authored route modules** — the generator chooses *which* modules, in
*what order*, with *which authored variant and parameters*; it never invents raw geometry.
The result must feel **art-directed**, because every piece of it was designed by hand and
only the arrangement is procedural.

```
relayRunConfig = compose(
  relaySeed,        // fixed for the whole life of a relay
  legNumber,        // which leg — advances difficulty baseline & module pool
  sourceRegionId,   // theme + which authored hazard/environment set
  destRegionId,     // theme + environment set + partial distance
  relayState,       // baton_amount_luna (framing only), rescued/stranded flag
  echoes,           // verified historic placements (§6) slotted into module anchor points
  carryState        // §2.7 inheritance — starting physical conditions only
)
```

**Authored module library** (data, versioned with the engine):

| Module kind | Authored content | Seed picks |
|---|---|---|
| **Straight / drift lane** | lane width profile, hazard slots, mote line | which of ~4 variants, hazard fill |
| **Gate cluster** | gate positions & radii as a designed weave (not random dots) | which of ~6 authored weaves, mirror, spacing scale |
| **Fork** | the geometry of a wide line + a tight line and their reconnect | which of ~3 authored forks, which side is tight |
| **Turbulence cell** | the physical-parameter envelope (§2.3) + corridor shape | which of ~3 cells, intensity within an authored band |
| **Pulse section** | the breathing-gate rhythm pattern + tempo-shift point + music bed ref | which of ~3 patterns, length |
| **Chicane / set piece** | a signature designed moment (a canyon threading, a ring pass) | which set piece, region dressing |
| **Approach / Sling arena** | the destination geometry and aim arc | region variant only |

**Composition rules** (deterministic, in the engine):
- fixed skeleton — `Approach(Catch) → [3–6 modules] → Sling arena`;
- the module sequence is drawn from a **leg-number-gated pool** (early legs: gentler
  modules; later legs unlock harder set pieces) with authored adjacency constraints (never
  two turbulence cells back to back, exactly one Pulse section, at least one Fork);
- module params (spacing scale, hazard fill, intensity) are drawn from **authored bands**,
  not open ranges, so no arrangement produces a broken or ugly route;
- great-circle distance between regions picks the module *count* (3–6) → run length inside
  the 45–75 s band.

**Region theme** (`sourceRegionId` / `destRegionId`) = 1 palette + 1 skybox/ground
treatment + an authored environment/hazard *set* (desert → dust devils & mesas, ocean →
spray & swells, aurora → light curtains, …) + 1 music bed. Same modules, region-authored
dressing. `relayState.baton_amount_luna` affects **framing/presentation intensity only**,
never mechanics or score.

The composer + module library are pure and live in the engine package (deterministic,
server-reproducible). Region dressing is a client rendering concern keyed by id.

---

## 5. Baton lineage — cosmetic / presentation progression only

The baton is a rendered object whose **appearance and presentation** are a pure function
of its verified relay history. This is **strictly cosmetic**. Baton history **never**
affects the monetary value of the baton (`baton_amount_luna`), a player's economic
rights, payouts, qualification math, or the score of any run. A historic baton looks
grander; it is not worth more and does not make its carrier better off. Progression you
earn by the baton being carried, not cosmetics you buy.

| Signal | Source (verified) | Visual effect |
|---|---|---|
| Age | legs completed | trail lengthens, gains segments |
| Distance | total great-circle km across regions | material richens, core glow intensifies |
| Cleanliness | clean handoffs ÷ (fumbles + strandings) | warm/whole vs cracked/cooled |
| Region diversity | distinct regions crossed | facet colors accumulate |
| Notable legs | a ghost-beat blowout, a near-stranding recovery, a region Sling record | a permanent **facet** minted, tagged with that runner's handle |

- Rendered identically on: the world-map marker, the run HUD, the proof page (PRD §7.9
  judge surface), and share cards.
- **Two batons are never visually identical after ~10 legs.** A historic baton (leg 80,
  20 regions, 3 near-stranding recoveries) looks and feels materially different from a
  fresh one — a judge should be able to tell them apart at a glance.
- Fully derived from `game_runs` + `relay_legs` + handoff verification data already in
  the schema. No new custody or trust surface.

---

## 6. Relay Echoes — historic gameplay moments as playable content

**Not Nimiq Space's building mechanic.** Echoes are how a relay's *own history* becomes
something later runners physically play through.

When a notable moment is verified on a leg, the server mints an **Echo**: a small,
positioned artifact embedded into the **route geometry of future legs of the same
relay**.

- **Trigger examples:** beat the ghost by a top-percentile margin; recover a run from
  near-stranding; set a region's fastest Sling; thread a fork line no one else has
  matched.
- **In a later run** you fly past a faint translucent **echo gate** at the exact spot
  where, on leg 12, "Kai" threaded a shortcut nobody has matched since. Passing it
  cleanly grants a small bonus and a nod ("matched Kai's line, leg 12"). Missing it costs
  nothing — it's an optional flourish for skilled players.
- **Properties:** deterministic (minted from verified run data, baked into
  `relayRunConfig`, so the server replays them identically); bounded (max N per leg,
  least-notable/oldest decay as new ones mint); inputs-only + privacy-safe (handle +
  position + type, never wallet/device/IP); reproducible for the judge proof page.
- This is the **Chronicle made physical** — the same history the Chronicle screen lists,
  now embedded in the world you fly through.

---

## 7. Engine mapping — how V2 keeps every anti-cheat guarantee

- **Engine `1.0.0` and its 200-case corpus stay frozen** (`DECISIONS.md` D-008). The five
  v1 challenges remain replayable forever by their recorded version.
- **New challenge type `relay-run` under engine/challenge version `2`.** Built as **one
  composite deterministic sim**: Catch → traversal (forks, hazards, Redline heat,
  Stabilize turbulence cells, Pulse sections) → Sling, all as **phases of a single
  fixed-60Hz tick loop** driven by one seed + the composed module list. Same contract as
  v1: pure `createState` / `step`, integer + Q16.16 fixed-point only, seeded integer PRNG,
  no DOM/Math/Date/random/IO, `replay()` returns a full-final-state SHA-256 `resultHash`.

### 7.1 Input format — deterministic quantized analog steering

Two channels, one thumb:

- **`steer`** — horizontal intent, **quantized to a fixed integer grid** `STEER_MIN … STEER_MAX`
  (slice: `-64 … 64`, 7-bit). The client maps thumb-x (or keyboard ramp) to a float in
  `[-1, 1]`, then `steerQ = round(x * 64)` — the quantization happens **client-side before
  the value ever enters the trace**, so the sim and the server both consume the exact same
  integers. The sim treats `steer` as a target the baton accelerates toward (physical
  steering model), never as a direct position.
- **`pressed`** — 0/1 contextual action (Catch commit, Sling charge/hold, overdrive hold).

**Replay format — `RelayInputTrace`:** an ordered list of samples
`[tickDelta, steerQ, pressed]` written **only when `steerQ` or `pressed` changes**, plus a
**forced keyframe every `KEYFRAME_TICKS` (slice: 30 → 2 Hz)** so a long steady hold still
bounds gaps and resync is trivial. `tickDelta` is the gap in ticks from the previous
sample (varint-friendly). Between samples the sim uses **sample-and-hold** (piecewise
constant) — no interpolation, so it's bit-exact.

- **Bounds:** `MAX_SAMPLES` (slice: 4096) and `MAX_TRACE_BYTES` (slice: 24 KB). A 75 s run
  at heavy steering ≈ 2000–3000 samples ≈ 12–18 KB. Validator rejects: out-of-order
  ticks, ticks past run end, `steerQ` outside the grid, `pressed` not 0/1, samples
  exceeding the caps, a first sample not at tick 0. Never throws — typed error, same as
  v1's `validateInputTrace`.
- `steerAtTick(trace, tick)` / `pressedAtTick(trace, tick)` — binary search for the last
  sample at or before `tick` (same pattern as v1 `inputAtTick`).
- The v1 binary trace format and its validator are **untouched**; `relay-run` is a
  separate format used only by version-2 challenges.

- **A fresh committed corpus** for `relay-run`: cases across composed module sequences,
  seeds, leg numbers, carry-states, and synthetic analog input patterns (steady holds,
  sweeps, jitter, keyframe-boundary edges); byte-identical in Node / `workerd` /
  Chromium / WebKit; mutation-tested. (The **Phase 3.6 slice** ships a smaller corpus,
  Node + `workerd` parity minimum; the full ≥200-case cross-browser corpus is a
  pre-Phase-5 requirement.)
- **The ghost is `replay()`** of the previous leg's verified trace against the same
  `relayRunConfig`, stepped alongside — the existing `/play` pattern, unchanged in
  principle.
- **`/api/runs/issue` extends** (already MAC-signed, PRD §7.8) to carry `relayId`,
  `legNumber`, `sourceRegionId`, `destRegionId`, `ghostRunId`, `echoSetHash` — all
  covered by the challenge MAC. `/api/runs/submit` replays server-side exactly as it does
  now.
- **Server-derived score only** (PRD §7.7) — unchanged. The client's number never counts.

The deterministic engine must continue to make every gameplay outcome server-verifiable.
Nothing in V2 relaxes that.

---

## 8. First-session and retention design (closing the audit gaps)

- **First session:** open in Nimiq Pay → (leg 1 of the flagship, or a practice run) → 3-2-1
  → a Relay Run that visibly *is a game* within the first 10 seconds → finish → score vs
  ghost, lineage mark, "you're on the board." A 15-second silent screen recording must
  read as a real game (gate criterion).
- **5 minutes:** beat-the-ghost delta (small, closeable), fork/Redline decisions to
  master, Pulse Sync combo ceiling, collectible-line reading, region variety, the Sling
  skill.
- **Return tomorrow:** relay streak (staked, escalating — NimJump pattern), a daily
  "featured leg" with a leaderboard, the flagship world relay advancing while you were
  gone, Echoes from other players appearing on relays you're in.
- **Invite:** the relay *is* the invite — you choose and pass to the next runner. Plus
  Quick Relay (a short private 2–4 person relay you spin up and share) as the low-stakes
  on-ramp.

---

## 9. GAMEPLAY QUALITY GATE

The V2 playable layer **does not pass** — and Phase 5 does not begin — until **all** of
the following are true, verified as described.

| # | Criterion | How it is verified |
|---|---|---|
| 1 | A fresh tester **voluntarily plays ≥ 5 runs** without being asked to test five separate features. | Hand someone the link, say "try it", watch. Count runs before they stop on their own. No prompting. |
| 2 | A run contains **≥ 3 meaningful decisions**, not just reaction timing. | Name them: e.g. fork choice ×2–3, Redline push-or-bank at each, Sling commit timing, which collectible line. Each must have a real trade-off a skilled player weighs differently than a new one. |
| 3 | The previous player's **ghost materially changes how a run feels**. | A/B: same seed, ghost on vs ghost hidden. Testers describe the ghost-on run as tenser / more of a race. If they can't tell the difference, fail. |
| 4 | The game has a **clear risk/reward decision**. | Redline + tight forks. A tester can articulate "I could've played safe there but went for it." |
| 5 | **Two generated runs feel materially different.** | Two different region pairs + seeds, back to back. Testers describe them as different experiences, not "same thing, different numbers." |
| 6 | Gameplay remains **deterministic and server-replayable**. | The `relay-run` committed corpus passes byte-identical in Node / `workerd` / Chromium / WebKit; mutation tests catch drift; `/api/runs/submit` server score matches a local `replay()` for real recorded runs. |
| 7 | The interaction runs at **60 FPS on the actual target mobile WebView** (Nimiq Pay iOS). | Measured on a physical device inside Nimiq Pay — not headless Chromium. Frame-time trace attached. Anything else is NOT VERIFIED. |
| 8 | A **15-second silent screen recording clearly looks like a real game**. | Show the clip to someone who knows nothing about the project. "What is this?" → a game, not a demo or a settings screen. |
| 9 | The **primary fun survives with all blockchain UI hidden**. | Run a build with wallet/NIM/handoff chrome stripped. It must still be a game worth replaying. |
| 10 | The **NIM handoff is the emotional finale**, not an unrelated wallet action. | The Sling → wallet confirm → baton-lands sequence tests as the peak of the run. Testers describe the transaction as "landing the throw", not "then I had to do a payment." |

Benchmark aggressively. Do not lower the bar because implementation is hard or because
other phases already exist. The target is not "better than the current `/play`." The
target is: **if NimJump and Nimiq Space entered this same round unchanged, NIM Relay
would still deserve first place on product experience.**

---

## 9.5 Phase 3.6 — the instrumented vertical slice (`/lab/relay-run-v2`)

Build **one complete Relay Run** before building the full content system. Isolated lab
route, not linked from the product. Placeholder handoff completion *inside the lab only* —
**do not touch or mock the production Nimiq relay protocol; Phase 4's chain work stays
untouched.**

**The slice must contain, end to end:**
- cinematic incoming baton + Catch;
- real spatial traversal with quantized analog one-thumb steering (§7.1);
- **≥ 1 meaningful route fork** where safe vs risky have distinct, felt consequences;
- an integrated Stabilize turbulence cell (physical-parameter, no inversion);
- an integrated Pulse section (resonance layer inside traversal);
- a Redline risk/reward system live across the whole run;
- a previous canonical run rendered as a **live race ghost**;
- a final Sling sequence (Stage 1 throw; Stage 2/3 wallet steps are a labelled lab
  placeholder);
- full scoring + a post-run breakdown;
- **exact deterministic record + server replay of the whole composite run**
  (`replay()` for `relay-run` v2, a slice corpus, Node + `workerd` parity, the live
  sim-vs-canonical divergence assert).

**Game-quality instrumentation** (collected client-side, shown in a lab panel + emitted as
JSON for capture; aggregate in `localStorage`): frame-time distribution (mean / p50 / p95 /
p99 / worst, draw calls), input latency (event → applied tick), restart rate, run
completion rate, voluntary replay count, route-choice split, Redline usage (engaged ticks,
blowouts, greedy-zone time), ghost lead-change count, failure location (tick + module),
score distribution.

**The slice does not pass because tests pass.** It passes when it can be personally played
repeatedly and *feels like a commercial mobile game*, and a silent 15-second recording
visibly communicates movement, danger, control, competition and game state with no
narration.

**Order of work:** establish control feel → decision-making → mastery → replay desire
**first**. Do not hide a weak core behind particles, screen shake or cinematic
transitions. Juice is added only once the core reads as good unjuiced.

**On deploy, stop.** Report: the direct playable URL; the control explanation in ≤ 2
sentences; instrumentation results; deterministic replay evidence; what remains below the
quality gate. Do not proceed into full V2 world/content production until the slice is
played and approved.

---

## 10. What is explicitly out of scope for V2

- The full relay state machine / `RelayRoom` DO coordination / chain-verification loop —
  that is the rest of Phase 4, resumed *after* this gate passes.
- Crews / Rival / Daily / Creator relay modes (Phase 6).
- Premium visual polish pass (Phase 8) — V2 must look like a real game, but the final art
  pass comes later.
- Real-time multiplayer. The ghost is asynchronous by design (PRD §8).

## 11. Preserved as-is (do not touch without a measured reason)

`packages/game-engine` v1 + its corpus; `packages/relay-protocol` (`challenge.ts`,
`verify-transaction.ts`, `nimiq-verify.ts`, `tx-data.ts`, `nimiq-rpc.ts`);
`apps/worker/src/auth/*`; `apps/worker/src/runs/*` (HMAC issuance + server replay +
`game_runs` persistence); the Supabase schema; the deployed auth + `/api/runs` surface.
V2 builds on this, it does not rewrite it.
