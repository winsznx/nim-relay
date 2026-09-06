# Relay Game V2 — the playable layer redesign

Status: design, not yet implemented. Supersedes the five standalone challenges as the
player-facing experience. The V2 engine work is **blocked from starting** until this doc
is reviewed; **Phase 5 is blocked** until the Gameplay Quality Gate (§9) passes.

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
input: **hold** banks the baton one way, **release** banks it back. Pure 1D lateral
control, one thumb, portrait.

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

The baton hits a storm cell / updraft. For the window: lateral control becomes **noisy
and partially inverted**, forward speed drops, and a **narrowing safe corridor** appears.
Input becomes tap-pulse: each tap nudges the baton toward corridor center against the
noise; over-correcting throws it to the far wall.

- Hold the corridor to the exit → clean break, combo intact, a small time refund.
- Spat out → you exit off-line and behind, corridor time counts against you.

Turbulence windows are placed by the seed at points that interrupt a flow state — right
after a fast clean stretch, or right before a fork.

### 2.4 Pulse Sync (rhythm sequence) — 1 × ~8 s

The route enters a resonant stretch. Generated music kicks in; the whole scene pulses
with the beat; a run of gates **opens and closes on the beat**. Input: tap to pass each
gate on its open beat.

- On-beat pass → combo multiplier stacks (`×2 … ×5`), the baton flares with the track.
- Off-beat / missed → multiplier resets to `×1`.

This is the deliberate juice showcase — the one stretch where the game stops being about
threading and starts being about *feel*. Tempo shifts once mid-sequence so it can't be
button-mashed.

### 2.5 Redline (emergent state) — latent, whole-run

A **heat meter** fills whenever you are: holding an overdrive, riding a tight fork line,
or carrying a high combo. It cools when you release / play the wide line / break combo.

- Near the top of the meter, **score gain scales up sharply** (the greedy zone).
- **Redline it** → the baton overheats: you lose control for ~1 s, the ghost pulls ahead,
  combo resets, heat dumps to zero.

Redline is not a section. It is the **risk/reward decision that runs through every fork,
every overdrive, every combo streak** — "do I push this line or bank the points I have."
A skilled player lives at 90% heat; a new player either never uses it or blows up on
every fork.

### 2.6 Sling (final launch + NIM handoff) — last 4–6 s

The route ends at the destination region. The baton must be **launched** to the next
runner. Charge-and-release aim: **hold** to build power while your aim sweeps across the
destination arc; **release** to fire.

- **Angle + power + timing** accuracy → your final score multiplier (up to ~2×) **and**
  the difficulty of the next runner's Catch.
- A perfect Sling: the baton streaks clean into the next runner's hands; they get an easy
  Catch and a note ("clean pass from {you}").

**The Sling release is the NIM transaction.** When the player commits the throw, the
client fires `sendBasicTransactionWithData` (the handoff intent + tx-data commitment
already staged server-side per PRD §9.4). The wallet confirmation *is* the launch
follow-through; the transaction landing on-chain *is* the baton visibly arriving. The
handoff is the emotional finale of the run, not a detached wallet errand. If the tx
fails/cancels, the run's score still stands as a solo result but the baton doesn't move
(reroute — PRD §10.1).

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

## 4. Content-generation architecture (no authored levels per route)

```
relayRunConfig = generate(
  relaySeed,        // fixed for the whole life of a relay
  legNumber,        // which leg — advances difficulty baseline
  sourceRegionId,   // theming + hazard flavor + partial distance
  destRegionId,     // theming + hazard flavor + partial distance
  relayState,       // baton_amount_luna, stranded/rescued history flags
  echoes            // verified historic moments embedded into this leg (§6)
)
```

- **`(relaySeed, legNumber)`** seeds the leg's PRNG stream → gate layout, hazard
  placement, fork positions, turbulence/pulse window timing, difficulty curve, collectible
  lines. Deterministic and server-reproducible. Every leg of a relay is different; the
  same leg is byte-identical on every replay forever.
- **`sourceRegionId` / `destRegionId`** → a **Region Theme**: 1 palette, 1 skybox/ground
  treatment, 3 hazard reskins (desert → dust devils, ocean → spray + swells, aurora →
  light curtains, city → thermals + drones, mountain → downdrafts, …), 1 music bed for
  Pulse Sync. **Same mechanics, different dressing.** The great-circle distance between
  the two regions scales the run length inside the 45–75 s band.
- **`relayState`** → `baton_amount_luna` drives framing intensity (a 50-NIM baton gets a
  more cinematic treatment than a 1-NIM one); leg number raises the difficulty floor
  (leg 40 ≠ leg 2); a rescued/stranded flag can scar the route visually.
- **~6–8 Region Themes** × the seeded generator = every route on Earth feels distinct
  with **zero hand-authored levels**. Adding a theme is a palette + skybox + 3 reskins +
  a music bed, not a level design pass.

The generator is pure and lives in the engine package (deterministic). Region themes are
a client-side rendering concern (visual only, headless-gated), keyed by id.

---

## 5. Baton lineage — visible persistent progression

The baton is a rendered object whose appearance is a **pure function of its verified
relay history**. Not cosmetics you buy — progression you earn by the baton being carried.

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
- **New challenge type `relay-run` at `challengeVersion` `2.0.0`** (or a new engine
  minor — decide at implementation). Built as **one composite deterministic sim**: Catch →
  Slipstream (with forks, hazards, Redline heat) → Stabilize windows → Pulse Sync window
  → Sling, all as **phases of a single fixed-60Hz tick loop** driven by one seed. Same
  contract as v1: pure `createState` / `step`, integer + Q16.16 fixed-point only, seeded
  integer PRNG, no DOM/Math/Date/random/IO, `replay()` returns a full-final-state SHA-256
  `resultHash`.
- **Input stays binary transitions `[[tMs, 0|1]]`** — one thumb. The *meaning* of
  hold/release is contextual per phase (bank / pulse-tap / charge); the sim derives it
  from its phase state. Trace format, the §7.6 validator, and the anti-cheat pipeline are
  **untouched**.
- **A fresh committed corpus** for `relay-run`: ≥200 cases across region pairs, seeds,
  leg numbers, difficulty baselines, and synthetic input patterns; byte-identical in
  Node / `workerd` / Chromium / WebKit; mutation-tested.
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
