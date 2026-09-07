# RELAY_GAME_V3 — the race, redesigned around one legible fantasy

**Status: design spec. No V3 implementation until this doc is approved.**

V2 is frozen on branch `experimental/relay-run-v2` (commit `594edbd`) as a regression
reference. The deterministic engine v1 + its 200-case corpus, HMAC challenge issuance,
server replay + scoring (`/api/runs`), and the Worker/Supabase/auth infrastructure are
**preserved and unchanged**. V3 does not require any of V2's visuals or interaction
choices.

---

## 0. Why V3 (the V2 post-mortem, one paragraph)

V2 failed the human playability gate. A tester played the deployed slice and could not
tell what the objective, the scoring, or the mechanics were. Root cause: V2 put six
named systems (Catch, Slipstream, Stabilize, Pulse Sync, Redline, Sling) inside a 45-second
run and asked the player to hold all of them at once. That is cognitive load, not depth.
The benchmark lesson from NimJump and Nimiq Space is now explicit and non-negotiable:
**one immediately understandable primary interaction, then deep systems layered around
it** — never a decathlon in the first run.

---

## 1. The one fantasy, the one game

> **You are a Relay Courier carrying a real NIM baton. Race it through the route and
> reach the handoff gate.**

One game, four verbs, in this order every single run:

```
steer  →  race  →  beat the ghost  →  reach the handoff
```

It is a **race**. Time is the score. The previous courier is on the track with you. The
route ends at a handoff gate where you sling the baton to the next courier. Everything
else is dressing on that sentence.

If a judge opens the slice, they should understand *that* — a courier, a track, a rival,
a finish — within five seconds, from motion alone.

---

## 2. Controls — legible without a word of documentation

| Input | Action | Feel |
|---|---|---|
| **Drag left / right** (thumb anywhere on the lower screen) | steer the courier across the track | 1:1, immediate, the courier leans into the turn |
| **Hold** (press and keep held) | boost — faster, more ground covered, heat rises | the board lights up, wind streaks, the world stretches slightly |
| **Release** | conserve — cool the heat back down | streaks fade, the gauge drains |

Three inputs. No modes. No context-dependent meaning. The player learns all three in the
first 20 seconds because the level teaches them (§8). Keyboard for desktop dev: ←/→
steer, Space hold-to-boost, R restart.

There is **no separate tap-to-catch, tap-to-sync, or charge-and-release-to-sling
button.** Those moments are handled by where the courier already is and whether they are
already boosting.

---

## 3. The five V2 mechanics → six invisible systems

None of these words ever appear in the player-facing UI. They are level-design and
physics vocabulary only.

| V2 name | V3 reinterpretation | What the player sees / does |
|---|---|---|
| **Catch** | **The opening.** The previous courier slings the baton; it arcs toward you as you're already moving; you slide roughly under it and it clicks into your courier's hand. | A ~2-second cinematic arrival. Input = just be near the middle. A clean line into it = a small starting boost. Never scored on screen. |
| **Slipstream** | **The race.** Continuous forward flight down an authored track. Drag to steer, thread the gold gates, avoid the red hazards. | This is 90% of the run and the thing the controls are *for*. |
| **Stabilize** | **Turbulence.** Stretches where wind / heat-haze / downdraft push the courier and make steering float or drag. The force is *visible in the world* (bent flags, blown sand, light curtains) a beat before it bites. | A rougher patch of track you learn to lead and lean against. No corridor UI, no meter, no word. |
| **Pulse Sync** | **Live track sections.** On certain stretches the track and environment pulse to the music; gates and boost pads open on the beat. Hitting them on the beat = extra speed and the world flares. | "The track is alive here, ride the rhythm." Not a rhythm minigame, not a separate combo readout. Just a faster, louder, more satisfying stretch if you flow with it. |
| **Redline** | **Boost heat.** Hold to boost, heat climbs cool-blue → gold → red. Overheat = the board sputters, you slow for a beat and lose your line. | One gauge on the HUD. The risk/reward of "push the boost or bank the speed I have." |
| **Sling** | **The finish.** The route ends at a handoff gate. You carry speed into a launch ramp and the baton flies to the next courier waiting there. Your line and timing into the ramp = how clean the pass is. | The last ~4 seconds. This is where the real NIM transaction is staged (before) and confirmed (after), with the cinematic launch resuming when the tx enters the right state — the two-stage handoff from V2 §2.6 is the one interaction model that carries over. |

---

## 4. The Relay Courier — a visible avatar, and the identity system it anchors

**There is a courier on screen at all times.** A rendered character on a board / glider,
carrying the glowing NIM-gold baton. This is the single biggest change from V2 (which had
an abstract dot) and it does a lot of work: it makes the fantasy legible, it makes the
ghost obviously *another person*, and it is the hook for every cosmetic and social
surface the product needs.

Design an **original Relay Courier visual system** — not a copy of any existing game's
character — built to support, from day one of the data model even if not the art:

| Layer | What it is | Sourced from |
|---|---|---|
| **Courier identity** | the base character silhouette + face/helmet | player pick at onboarding |
| **Skins** | recolors / material sets on the courier | earned (streak, season, achievement) — never pay-to-win, cosmetic only |
| **Boards / gliders** | the thing they ride — shape changes the silhouette, not the physics | earned / season |
| **Trails** | the light trail behind the courier | earned; a "historic baton" trail is minted from verified relay history |
| **Ghost appearance** | the previous courier renders as *their* courier + board + trail, desaturated / translucent | pulled from that player's profile (cosmetic ids only, never wallet/device) |
| **Crew identity** | a crew emblem / color accent on the courier and trail | crew membership |
| **Season cosmetics** | a themed set that rotates | season track |
| **Historic baton appearance** | the baton itself changes with the relay's verified history (age, distance, cleanliness, regions) — cosmetic **only**, never affects `baton_amount_luna` or any economic right | derived from `game_runs` + `relay_legs` + handoff verification |

For the slice: **one premium courier + board + trail**, hand-authored, plus the ghost
rendering *a visibly different* courier/board/trail so "that's another racer" is
instant. The full unlock economy is Phase 6-8; the data model and render pipeline must be
shaped for it now.

---

## 5. Renderer — Three.js, evaluated and recommended, sim stays canonical

**Recommendation: build the V3 renderer in Three.js**, with a deliberately low-poly /
flat-shaded stylized look (reference feel: *Alto's Odyssey*, *Race the Sun*, *Audiosurf* —
premium through art direction and motion, not polygon count or textures) and a
behind-the-courier chase camera.

**Why Three.js and not the V2 2D renderer or PixiJS:**
- "A visible courier on a board" and "the ghost is visibly another competitor" are now
  hard requirements. A behind-the-character 3D chase cam delivers both for free; faking
  it in 2D is fighting the medium.
- "A silent screenshot looks like a commercial game, not a dashboard" — depth, a horizon,
  a courier with a trail, a rival ahead. This is much easier to hit in 3D.
- Spatial legibility (§6): real depth makes "gold gate ahead / red hazard / the track
  forks / the ghost is 40m up" read at a glance.
- The cosmetic system (§4) — boards, gliders, trails, skins — reads as premium in 3D and
  flat in 2D.

**Cost and the risk to prove in the slice:**
- Bundle size and **60 fps in the Nimiq Pay iOS WebView** is the open risk. Mitigations,
  all mandatory in the slice: flat-shaded materials, **zero textures** on gameplay
  objects (vertex color / gradient only), instanced meshes for repeated geometry
  (gates, hazards, track segments), a hard draw-call and triangle budget measured every
  run, capped pixel ratio, fog to cull the far track cheaply, no post-processing beyond
  one cheap bloom. If the slice can't hold 60 on a real device, that is a gate failure
  and we reconsider — but it is worth the attempt because the legibility payoff is large.
- Three.js becomes a `apps/web` dependency; `pixi.js` stays for any 2D UI/menus.

**Non-negotiable:** the deterministic TypeScript simulation is the canonical gameplay
engine. The renderer reads sim state each frame and may interpolate **for display only**.
The engine is never changed to achieve a graphical effect. Renderer and simulation are
separate packages / modules with a one-way dependency (renderer → sim types only).

---

## 6. Route language — spatially obvious at a glance

A player who has never seen the game must read the track like road signs. Fixed visual
grammar, enforced across every route and region:

| Element | Look | Meaning |
|---|---|---|
| **Normal track** | neutral surface, clear lane edges | safe, just fly it |
| **Gold gates / rings / pads** | warm gold, glowing, on the ideal line | positive — pass through the center for speed / score |
| **Red hazards** | red, hard-edged, often moving (blocks, crossbeams, debris, turbulence spikes) | dangerous — a hit costs speed and your line |
| **Shortcuts / risk routes** | a visibly narrower, steeper, redder branch that rejoins ahead | faster and worth more, but tighter and hazard-dense — a real choice |
| **Boost state** | courier + board ignite, wind streaks, slight FOV push, trail brightens, world edges stretch | you are boosting and heat is climbing — unmistakable |
| **Overheat** | board sputters, sparks, desaturates for ~1s, control softens | you pushed too far; back off |
| **Ghost** | a translucent / desaturated other courier, continuously visible ahead or beside you, with a faint distance tick | where your rival is, always |
| **Finish / handoff** | a large gold gate on the horizon with the next courier visible waiting, growing as you approach | the objective — you can see it coming for the last several seconds |

If any of these needs a legend or a tooltip, the art has failed.

---

## 7. The ghost — a racer, not a number

The previous courier is **rendered as a courier** on the track: their avatar, their
board, their trail, translucent/desaturated, stepping their verified input trace in
lockstep with the sim. You see them take the fork. You see them boost. You see them
overheat. The final seconds to the handoff are a visible side-by-side.

**Matchmaking — never demoralize a new player:**
- **Onboarding ghost:** a first-timer's first race is against a deliberately beatable
  ghost — roughly 85% of a median run, playing a clean but un-aggressive line. Winning
  your first race by simply trying is the hook.
- **Skill-band matching (production):** after a few runs, the ghost is drawn from the
  player's own recent median or a leaderboard skill bucket, so every race is close.
- **Never** default a new player against a ghost scoring 10-13× higher (the V2 failure —
  "ghost won by 40,155" against a player who scored 3,080).

---

## 8. First-run tutorial — through level design, not text

The first run is a hand-authored route (fixed for a new player) that teaches one thing at
a time through track shape and feedback. Zero instruction text beyond a single
one-second "DRAG TO STEER" motion hint that fades.

| Time | Track | Teaches | How |
|---|---|---|---|
| 0–3 s | the opening — baton arcs in, you're already gliding | you are moving, you are a courier | cinematic, near-zero input |
| 3–10 s | a wide, gentle S of gold gates, no hazards, no boost | **drag to steer**; gold is good | the S forces a left then a right; passing gates feels good and speeds you slightly |
| 10–18 s | a long straight, a glowing boost pad, the heat gauge fades in with a "HOLD" pip | **hold to boost, release to cool** | the pad is irresistible; boosting through it is a rush; the gauge shows heat climb then drain |
| 18–26 s | one single obvious red crossbeam with clear space around it, a tiny slow-mo on the near-miss | **red = avoid** | it's unmissable and unhittable if you're paying any attention; hitting it once teaches the cost |
| 26–34 s | the track visibly splits — left wide/gold/safe, right narrow/faster/one hazard — and **the ghost takes one side** | **there's a choice, and someone is racing you** | you commit by steering; the ghost's choice is visible a beat before yours |
| 34 s–finish | full track: gates + hazards + one turbulence stretch + one live/beat stretch, ghost pulls even, then the handoff gate grows on the horizon | it's a race now; the handoff is the finish | everything learned, in anger, with the rival beside you |

Every subsequent route is seeded/authored (§11) and drops the hand-holding — but the
grammar is the same, so the player is never re-taught.

---

## 9. HUD — four things, maximum, at launch

```
┌─────────────────────────────────────────────┐
│  0:24.8                          ▓▓▓░░  ← boost/heat
│                                             │
│                                             │
│                      (game)                 │
│                                             │
│  ●━━━━━━━━◐━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶   │  ← run progress; ◐ = ghost, ● = you
│                          +0.4s vs ghost     │
└─────────────────────────────────────────────┘
```

1. **Time** — elapsed run time, the score.
2. **Progress** — a bar from start to handoff, with a marker for you and a marker for the
   ghost, so "am I ahead" is always answerable.
3. **Ghost lead/deficit** — `+0.4s` / `-1.1s`, colored (cyan ahead, red behind).
4. **Boost / heat** — the one gauge.

Nothing else on the HUD until the player has played several runs. Combo counts, gate
tallies, multipliers — all deferred to the results screen or a later "advanced HUD"
toggle.

---

## 10. Results screen — player language only

No `stabilizeCorridor`, `pulseSync`, `slingMultiplierPct`, `greedyTicks`, `blowouts`, or
any internal identifier ever renders in production UI. The mapping:

```
        TIME
      42.18s              ← headline: the race result

       GHOST
Beat Mariana by 0.37s     ← the rival result, by name, in seconds

  PERFECT GATES            RISK ROUTES
     14 / 18                    2         ← clean gate passes; shortcuts taken

  BOOST CONTROL           RELAY SCORE
      87%                   3,140         ← heat-management efficiency; the XP number

  [ Run again ]   [ Watch replay ]   [ Handoff → ]
```

- "PERFECT GATES 14 / 18" = `centerHits / totalGates`.
- "RISK ROUTES 2" = shortcut branches taken.
- "BOOST CONTROL 87%" = a derived efficiency: boost-distance covered without overheating
  ÷ boost-distance attempted.
- "RELAY SCORE" = the internal composite score, shown as a secondary XP-style number, not
  the headline.
- The player must be able to answer **"why did I lose?"** ("Mariana took the right fork
  and I overheated on the straight after") and **"how do I improve?"** ("hold the boost
  longer before the turbulence, take the risk route once I can hit the gates") from this
  screen and the replay.

---

## 11. Relay Station — the space between runs (architect for it, don't build it)

The race is one screen. The product is a **Relay Station**: the persistent hub a player
returns to. V3 must not build it before the race is validated, but the information
architecture and data model must account for it now so the race isn't a dead end.

```
Relay Station (home after login)
├── Live Relays        the flagship world relay + any you're in, advancing in real time
├── Challenges         pending friend / ghost challenges waiting for your run
├── Daily Route        one seeded route, global leaderboard, resets every 24h
├── Crews              your crew, crew relay, crew leaderboard
├── Rival Events       scheduled head-to-head events
├── Your Batons        the shelf of batons you've carried — each rendered with its lineage cosmetics
├── Profile / Customize  courier, board, trail, skins, crew colors, season set
└── Spectate           watch a live relay leg in progress
```

Bottom nav (PRD §20.2): **Home · Live · Race · Batons · Profile**. The V3 race slice
launches from a single "Race" / "Race the Daily" / "Practice" entry; everything else is a
stub that routes nowhere yet but exists in the nav so the shape is real.

---

## 12. Engine mapping — deterministic truth is the one thing that fully carries over

| Carries over unchanged | New for V3 |
|---|---|
| `packages/game-engine` **v1** + its 200-case corpus (frozen, `DECISIONS.md` D-008) | A **new deterministic sim** `packages/game-engine/src/relay-race/` at **engine/challenge version 3** |
| The deterministic-sim contract: pure `createState` / `step`, integer + Q16.16 only, seeded integer PRNG, **no `Math.random` / `Date` / libm (`sin`/`cos`/`pow`) / DOM / IO**, a full-final-state SHA-256 `resultHash` | A **race-first** state model: forward speed + lateral position + heat, an authored track of typed segments, gates/hazards/forks/turbulence/beat-stretches/handoff-ramp as data |
| HMAC challenge issuance (`/api/runs/issue`, PRD §7.8) and server replay + scoring (`/api/runs/submit`, §7.7) | `/api/runs` extends to carry `relay-race` v3 configs; server calls the v3 `replayRaceRun()` |
| The V2 input-format learning: **quantized analog steer + a boost channel + forced keyframes + bounded trace + typed validator** (V2 `relay-run/input.ts` is a good template) | A v3 trace: `[tickΔ, steerQ, boost]` — steer quantized to a fixed grid, `boost` 0/1, keyframed, capped |
| `verify-transaction.ts`, `nimiq-verify.ts`, `tx-data.ts`, the two-stage Sling/handoff model (V2 §2.6) | — |
| Worker / Supabase / auth / `game_runs` (+ `input_trace` jsonb from migration 0003) | — |

**V2's `relay-run` (engine v2) is frozen on `experimental/relay-run-v2`.** It is not
deleted (regression reference) but is not extended. V3 is a clean sim informed by V2's
mistakes, not a patch on V2.

---

## 13. The V3 vertical slice — exact contents

Build **only after this doc is approved**. Isolated lab route
(`/lab/relay-race-v3`), placeholder handoff completion, production relay protocol
untouched.

- **one premium courier / avatar** — low-poly, on a board, carrying the baton, with a
  trail; animated lean into turns and a boost pose.
- **one visually authored route / world** — one region, one seeded+authored track that
  *is* the tutorial route from §8 (opening → steer → boost → hazard → fork → race →
  handoff).
- **one visible competitive ghost** — rendered as a different courier/board/trail,
  the beatable onboarding ghost (~85% of median), stepping a verified trace.
- **obvious gold gates + red hazards** — per the §6 grammar.
- **one safe/risky route fork** — wide/gold/safe vs narrow/faster/hazard-dense, ghost
  visibly commits first.
- **one coherent boost / heat system** — hold-to-boost, one HUD gauge, overheat
  consequence, "BOOST CONTROL %" in results.
- **one integrated live/beat stretch** — a section that pulses with the music where
  on-beat gates/pads give extra speed; no separate UI.
- **one finish / handoff gate** — the courier launches the baton to the waiting next
  courier; wallet stages 2-3 are a labelled lab placeholder.
- **a clean result screen** — the §10 layout, player language, no internal ids.
- **deterministic replay + server verification** — the client asserts its live sim
  matched `replayRaceRun()` of its own trace; a committed v3 corpus byte-identical in
  Node **and** isolated `workerd`; mutation-tested.
- **instrumentation** (dev panel + JSON, not player-facing): frame-time distribution +
  draw calls + triangle count, input latency, restart / completion / voluntary-replay
  rates, fork choice, boost/overheat usage, ghost lead changes, finish-time
  distribution.

---

## 14. HUMAN QUALITY GATE FOR V3

The slice does not pass — and full production / Phase 5 does not begin — until **all** of
these are true, verified with a real person and a real device.

| # | Criterion | Verified by |
|---|---|---|
| 1 | A player understands the **objective** within 5 seconds. | Hand them the link, say nothing, watch. Ask "what are you trying to do?" at 5 s. |
| 2 | The player can **describe the controls** after seeing them once. | Ask after run 1. "Drag to steer, hold to go fast." |
| 3 | A **silent screenshot** looks like a commercial game, not a dashboard. | Show a stranger one frame. "Game or app?" |
| 4 | A **silent 10-second recording** clearly shows a player, a world, movement, danger, and an objective. | Show a stranger. They narrate it correctly with no prompting. |
| 5 | The **ghost is visibly another competitor.** | The tester refers to it as "the other guy / racer," not "the line." |
| 6 | The player understands **why they lost.** | They can name it: "he took the shortcut," "I overheated." |
| 7 | The player understands **how to improve.** | They can name a concrete change before run 2. |
| 8 | The game contains a **meaningful safe-vs-risk decision.** | The tester weighs the fork differently on different runs and can say why. |
| 9 | The player **voluntarily presses Run Again.** | Unprompted, at least once. |
| 10 | **Five runs create observable skill improvement.** | Finish time / clean gates trend up across 5 runs, and the tester feels it. |
| 11 | The game is **fun with all Nimiq / blockchain UI removed.** | A build with wallet/NIM/handoff chrome stripped is still a race worth replaying. |
| 12 | **Deterministic replay still passes.** | v3 corpus byte-identical Node + `workerd`; live sim == `replayRaceRun()`; mutation tests catch drift. |

The standard is not "better than V2." Assume NimJump and Nimiq Space re-enter this cycle
unchanged. Build something that belongs **beside them or above them**.

---

## 15. Out of scope for the V3 slice

- The full Relay Station (only the nav shell + one Race entry).
- Crews / Rival / Daily / Creator modes, real matchmaking, the cosmetic unlock economy.
- The production art pass (the slice must look like a game, but final art is later).
- Real-time multiplayer (the ghost is asynchronous by design — PRD §8).
- Multiple regions / the full authored-segment library (one route in the slice).

## 16. Preserved — do not touch without a measured reason

`packages/game-engine` v1 + corpus; `packages/relay-protocol`; `apps/worker/src/auth/*`;
`apps/worker/src/runs/*`; the Supabase schema + migrations; the deployed auth + `/api/runs`
surface; the two-stage handoff model. `experimental/relay-run-v2` stays as the V2
regression reference.
