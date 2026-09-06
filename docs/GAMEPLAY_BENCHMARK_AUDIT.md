# Gameplay Benchmark Audit — NimJump & Nimiq Space

Purpose: measure NIM Relay's playable layer against the two Nimiq Mini App / ecosystem
projects that set the bar. Sources: full source reads of
`github.com/nimjump/game` (Godot client + Go backend + Next.js admin) and
`github.com/harlski/nspace` (TS client + Node microservices), 2026-09-06. Not just
READMEs — game scripts, backend models, admin components, ops docs, commit history.

This is the reference for `docs/RELAY_GAME_V2.md` and the V2 quality gate. Do not
start Phase 5 until the gate in RELAY_GAME_V2.md passes.

---

## 1. NimJump — architecture and gameplay decomposition

**Genre.** Doodle-Jump-style vertical infinite platformer. Godot 4.7, GL Compatibility
(WebGL2), 600×800 fixed virtual resolution, portrait, `run/max_fps=60`, `low_processor_mode`
off. One `Main.tscn`, ~25 `.gd` scripts.

**Client architecture.**
- `GameConstants.gd` — single source of truth for VW/VH (600/800) and, notably, a
  hand-written deterministic `sin`/`cos`/`acos` (Taylor polynomial, 5 factorial constants)
  because IEEE-754 does not require libm trig to be bit-identical between Emscripten/WASM
  (client) and native glibc (server replay).
- `Player.gd` / `EnemyBase.gd` / `Item.gd` / `Platform.gd` — every actor advances only in
  `simulate_tick()` with a constant `delta = 1/60`. Every gameplay-relevant position is
  `snappedf(x, 0.01)` at end of tick (self-correcting float-drift quantization).
- `GameManager.gd` — platform/enemy/item spawning, all from a `RandomNumberGenerator`
  seeded from `game_seed`; separate `_visual_rng` / `_shake_rng` streams so cosmetic
  randomness can never consume a value gameplay logic expected next.
- `NimiqBridge.gd` / `NimiqJS.gd` — wallet-signed auth (single-use server challenge),
  Nimiq Pay device identifier, streak status.
- Full input log + periodic checkpoints (`{t,s,x,y,vy,rng}`) recorded client-side and
  submitted with the run.
- Tap **or** gyro controls (recorded which, shown in admin).

**Backend architecture (Go + BadgerDB).**
- `handlers/appsig.go` — every `/backend/*` request carries `app_ts` + `app_sig` =
  HMAC(path+ts, key baked into both client and server). Unsigned request never reaches a
  handler. Explicitly acknowledged as "stops bots and casual scripts, not a dedicated
  attacker."
- `game/replay.go` + `replay_worker.go` — parallel pool of **headless native Godot**
  processes (`min(20, max(4, CPU*2))`) that re-simulate every submitted input log and
  must produce a **byte-identical** score (zero tolerance). Also parses `[QUEST_RESULT]`
  and `[CKPT]` stdout lines; logs checkpoint divergence for diagnostics.
- `game/seed_batch.go` — server issues small (10) HMAC-signed offline seed batches
  (`sig = HMAC(seed+player_id+expiry, server-only key)`); client can only ever submit a
  seed the server handed it. Stateless at issuance (the signature *is* the proof).
  Documents honestly that this shrinks seed-shopping from "unlimited and invisible" to
  "small and detectable" (issued-vs-used gap flagged for review), not eliminated.
- `game/golden_replay.go` + `determinism_lint.go` — pinned reference replays re-checked
  on every binary; static `.gd` lint for non-deterministic patterns with `# determinism-ok`
  escape hatches.
- `game/streak.go` / `streak_reward.go` — daily login streak, claim-based NIM reward
  (base + per-day + max, all admin-tunable), per-IP multi-account claim cap.
- `game/quest.go` + `models/quest.go` — **25+ daily quest types**.
- `game/vsroom.go` + `models/vsroom.go` — async 1v1 with a **14-state** lifecycle.
- `game/cosmetics.go`, `nickname.go`, `profile.go`, `leaderboard.go` (daily + weekly),
  `daily_earn_cap.go`, `ip_reward_guard.go`, `failed_replay_store.go`, `nimiq.go` +
  `nimiq_keygen.go` (app wallet), `client_log_store.go` (client error aggregation).

**Admin (`admin/`, Next.js, ~19 components).** Overview (live sessions, replay queue
health, RAM/disk), Analytics (DAU/WAU, playtime, NIM distributed, wallet balance),
Sessions browser → per-session replay analysis view (incl. tap vs gyro), Leaderboard,
Players (stats/quests/rewards/IP history), Streaks (+ editable reward formula), Client
Logs, System (leaderboard switches, **game update lock**, hot-swap replay binary,
"remove all replays"), Database (BadgerDB key counts + clear + failed-replay archive as
downloadable JSON), VS Rooms, Failed Replays. Backend supervises the admin process
(`adminproc.go`); systemd runs the backend with `Restart=always` + reboot-on-crash-loop.

**One-liner.** A tiny arcade loop wrapped in a disproportionately large trust,
progression, competition and operations system.

---

## 2. Nimiq Space — architecture and gameplay decomposition

**Genre.** Persistent isometric multiplayer **social world**, not a skill game. Three.js
client, Node microservices (main server + `nim-chart-service` + `payment-intent-service` +
`analytics-service` + `payout-service`), Docker/Compose, Caddy.

**What it is.** A shared hub + Commons you walk around as a wallet-signed avatar; you see
who else is online right now as living presence on the map; chat/whisper; portal between
rooms. Three durable activities:
- **Pixel** — a persistent 500×500 collaborative paint floor. Your tile stays for the next
  visitor. Also served as a live `/pixels.png`.
- **Build** — blocks, floors, gates, signposts, billboards, teleporters; syncs to everyone
  in the room; own a room, invite friends into a private Play Space, leave a landmark.
- **Play** — seasonal soccer: a shared Free Play Field plus 1v1 Matches (raise a Challenge
  above your head → nearby player taps to accept → private ephemeral Match Pitch, 3-min +
  golden goal), Goalies, Spectating (a "vs" portal appears in the origin room, onlookers
  drop into the stands), plus a `Mosquito Tag` room mini-game.

**Client structure (`client/src/`).** `game/` (60+ modules: grid, fogOfWar,
interestChunks, meshResidency, pathPlayback, billboards, pixelFloor, roomLayouts…), plus
`achievements/`, `cosmetics/` (wardrobe + shop), `tutorial/`, `unlockPad/`, `telescope/`,
`ambientCast/`, `mosquitoTag/`, `worldcup/`, `pay/`, `invite/`, `i18n/`, `patchnotes/`.

**UX system.** A canonical domain glossary (`CONTEXT.md`) — the **Action Wheel**
(hexagonal self-action menu, right-click / long-press yourself; six Sectors, sub-wheels
for Emotes / Items / Home / Games / 1v1), the **Player Menu** (bottom-right identicon for
app navigation), the **Other Player Menu** (drill-in on another avatar). Every term has an
`_Avoid_` list. Country flag identity (chosen, not geolocated) reused across World Cup and
as a Flag Emote.

**Nimiq-native.** Wallet-signed players. Block-mining for NIM (stand adjacent to a mine
block, hold time accumulates server-side, payout queued). Goal rewards (0.25 NIM, only
when the field is **Contested** ≥2 distinct players, per-wallet 40/day cap, 500 NIM/day
global budget, deterministic claim id so a goal never pays twice). Payout queue with
retries + dead-letter + history; a dedicated hot wallet; a payout cutover runbook.

**Ops maturity.** `docs/` holds SECURITY-REVIEW, LEARNEDLESSONS, THE-LARGER-SYSTEM,
live-service-implementation, nim-payout-tracing, JWT-SECURITY-ISSUE, localization plan,
per-feature PRDs (`worldcup/PRD.md` + 4 ADRs + ~25 numbered issue files). Feature-flag
discipline: everything new goes under `worldcup/` so the whole feature "stays deletable in
one go." README publishes real 30-day production analytics (253 unique visitors, 141
first sign-ins, 1,120h active play, 202,630 NIM paid out).

**Production wisdom worth stealing (LEARNEDLESSONS).**
- All `@nimiq/core` `Client` use serialized behind one global mutex; keep the mutex scope
  short (build+sign+send once, release between confirmation polls).
- Cache the payout-wallet balance; adjust it in memory after a send instead of
  invalidating (or every claim stalls behind in-flight payouts).
- `@nimiq/core` in Node worker threads needs a browser-shaped env (`fake-indexeddb`,
  `EventTarget`) — historically a `patch-package` patch. (NIM Relay dodges this entirely
  with plain JSON-RPC — see `DECISIONS.md` D-001.)
- Client progress bars vs server accumulation desync is expected; document it or make
  progress server-driven.

**One-liner.** A living place people return to *because it changed while they were gone* —
persistence and presence are the retention engine, not a score.

---

## 3. Their primary 30-second gameplay loops

**NimJump.** Bounce up automatically → read the incoming platform/enemy/item layout →
tilt or tap to line up the next landing → stomp an enemy or grab a spring/jetpack for a
big gain → chain a second stomp for combo → dodge the enemy you can't beat → altitude
number climbs, difficulty ramps. Miss a platform or take a third hit → dead, see score
vs personal best and today's leaderboard, tap to go again. The 30s is *dense* — a
decision every ~1s, escalating.

**Nimiq Space.** Not a 30s loop. The 30s unit is: spawn into the hub → glance at who's
online and where → walk toward a cluster or a room portal → paint a pixel / place a block
/ tap the ball past the goalie / say hi. The reward is social acknowledgement and a
persistent mark, not a score tick.

**NIM Relay today.** Hold or release to push a single scalar toward a moving target for
20s. One decision, repeated. No escalation, no spatial reading, no recovery drama, no
second system layered on top. This is the gap.

---

## 4. Their first-session experience

**NimJump.** Open → wallet connect (Nimiq Pay deep link or extension, single-use
challenge sign) → PLAY → immediate game, no tutorial needed (the genre is universally
legible). Dead in 30–60s → score + "new best?" + leaderboard rank → play again. Quests
and streak surface in the lobby between runs.

**Nimiq Space.** Open → wallet connect → land in the hub with other avatars visibly
present → a `tutorial/` flow + `unlockPad/` gate teaches movement and the Action Wheel →
first pixel painted / first room entered within a minute. The "someone else is here"
signal does the hooking.

**NIM Relay today.** Open `/play` → pick one of 5 near-identical challenges → 3-2-1 →
20s of one gauge → score screen. Legible in seconds (good) but there is nothing to be
curious about after run 1.

---

## 5. Their reasons to keep playing for 5 minutes

**NimJump.** (a) Beat your own last score — the run-to-run delta is visible and small
enough to feel closeable. (b) Quest progress — "2 more mosquito stomps", "reach 1000
with no damage", "speedrun under 90s" reframe the same loop into a fresh objective every
run. (c) Combo mastery — chaining kills is a skill with a visible ceiling. (d) Powerup
routing — jetpack vs spring vs wings changes the optimal line.

**Nimiq Space.** (a) The pixel floor and rooms visibly change as others act. (b) A
Challenge you raised gets accepted. (c) Someone whispers you. (d) A Match you can
spectate starts. (e) Mining a block fills a bar toward a NIM payout.

**NIM Relay today.** Effectively none. The score has no rival, no objective variety, no
second system, no mastery ceiling beyond "hold slightly better."

---

## 6. Their reasons to return tomorrow

**NimJump.** Daily login **streak** with an escalating, claimable NIM reward (miss a day,
streak resets). Fresh **daily quests** (new set every UTC day, each worth ~0.01 NIM).
Daily leaderboard resets; weekly leaderboard is a longer arc.

**Nimiq Space.** The world is different — new pixels, new builds, new landmarks left by
others. Login streak. Seasonal content (World Cup). Your Play Space and friends.

**NIM Relay today.** Nothing. No streak, no daily, no leaderboard, no persistent world
state, no social hook. `/play` scores are `localStorage` only.

---

## 7. Their reasons to invite someone

**NimJump.** Async **1v1 VS rooms**: create a room (optionally with a NIM entry fee),
play your round on a fixed seed, share `?vs=1903`, opponent plays the same seed within
24h, winner takes 95% of the pooled entry (5% house). Forfeit/refund/dispute paths make
it safe to stake.

**Nimiq Space.** Challenge bubbles + Play Spaces (invite friends into your private room)
+ spectate portals + "come see what I built".

**NIM Relay today.** The relay concept *is* an invite mechanic on paper (pass the baton to
a chosen next runner) but it is unbuilt. `/play` has no share, no VS, no ghost from
anyone else.

---

## 8. Their skill / mastery systems

**NimJump.** Deterministic-but-adaptive enemies (behavior/speed/spawn scale with score
via seeded RNG, so "very little is static" — a scripted bot must continuously adapt).
Combo chains. Powerup routing. Style-constraint quests (pacifist, no-hit, jump-only,
mirror-debuff run). Gyro vs tap as a control-skill choice. A skilled player scores
multiples of a new player.

**Nimiq Space.** Soccer aim/timing vs a Goalie; movement pathing; building fluency.
Shallower — social, not competitive, is the point.

**NIM Relay today.** "Hold the button a bit more precisely." No compounding systems. A
player after 20 sessions is marginally better, not materially better.

---

## 9. Their game-feel / juice systems

**NimJump.** Procedurally generated original jump/damage SFX; particle bursts on
stomp/collect (separate `_visual_rng`); screen shake (`_shake_rng`); Kenney CC0 sprite
art with personality; casual background music; combo popups; powerup screen effects;
all visual work gated behind `_is_headless` so it never runs (or perturbs) the server
sim.

**Nimiq Space.** Achievement celebration VFX with staggering + a celebration policy;
camera jitter/rubberband tuning as its own tested module; ambient cast; identicon
textures; wardrobe preview backdrops; fog of war; attention markers. Polish is
systematized, each effect a small tested unit.

**NIM Relay today.** A gold hexagon with a comet trail and a cyan band. Clean, on-brand,
but static — no escalation of feedback, no audio, no haptics, no reactive world.

---

## 10. Their content-variety systems

**NimJump.** One generator, infinite output: `game_seed` → seeded RNG → platform
spacing, enemy types/placement, item drops, difficulty curve. No authored levels. Every
run is legitimately different; the *server* can reproduce any of them exactly.

**Nimiq Space.** Rooms are authored + player-built; billboards/adverts are a catalog;
the pixel floor is pure emergent player content. Seasonal features (World Cup) add
bounded new content behind a flag.

**NIM Relay today.** Seed feeds `deriveConfig` (corridor width, period, acceleration) —
so runs differ numerically, but not *experientially*. Two seeds feel the same because
there is only one axis and one mechanic to vary.

---

## 11. Their progression / persistence systems

**NimJump.** BadgerDB: profiles, nicknames, cosmetics, quest progress, streak state,
reward history, daily/weekly leaderboards, per-IP connection history, VS room history,
session replays (archived, clearable). Profile card is shareable/public.

**Nimiq Space.** Everything placed persists. Achievements. Wardrobe/shop inventory.
Login streak. Last-session-room resume. Country. Play Space ownership.

**NIM Relay today.** Supabase schema *exists* for all of this (25 tables — players,
game_runs, relay_legs, achievements, seasons, crews, …) and `game_runs` server-verified
persistence just shipped (Phase 4 slice 1). But nothing player-visible is persistent yet
and no progression surface exists.

---

## 12. Their social / multiplayer systems

**NimJump.** Async only, by design: VS rooms (shared seed, staked, 24h), leaderboards
(daily/weekly), public profile cards. No real-time multiplayer.

**Nimiq Space.** Real-time: presence, chat/whisper, shared room state, live 1v1 Matches,
spectating, Mosquito Tag, collaborative pixel floor. Interest-chunk / mesh-residency
systems to scale the shared world.

**NIM Relay today.** The DO (`RelayRoom`) exists as a hello/reconnect stub. The ghost
race — the core social primitive per the PRD — is not implemented (the `/play` "ghost" is
your own last local run).

---

## 13. Their Nimiq-native systems

**NimJump.** Wallet-signed auth (single-use challenge, single-flight guard). Nimiq Pay
device identifier. Real NIM payouts: quests, streaks, VS winnings. App wallet + keygen.
Per-IP / daily earn caps. Honest about the app-signing key being extractable from the
downloadable client.

**Nimiq Space.** Wallet-signed players. Block-mining → NIM. Goal rewards with contested
+ per-wallet + global-budget guards + deterministic claim ids. A full payout queue
(retries, dead-letter, history, tracing, cutover runbook). Real 200k+ NIM paid in 30
days.

**NIM Relay today.** *Strong here* — this is the one area at or above the bar. Wallet
login verified on a real phone (D-002 resolved), `SupabaseAuthStore` live, HMAC
challenge issuance + server replay shipped, `verify-transaction.ts` (the PRD §9.6 handoff
verifier) written and adversarially tested. The *handoff itself* (real NIM moving a
baton, §9.3/§9.6/§9.8) is the remaining Phase 4 work.

---

## 14. Their production / operational systems

**NimJump.** 19-component admin; game update lock; hot-swap replay binary via admin
upload; client error log aggregation; failed-replay archive (downloadable JSON);
resource monitoring; systemd auto-restart + reboot-on-crash-loop; two-layer process
supervision; determinism lint + golden self-test as shipping gates.

**Nimiq Space.** 5 services; Docker/Compose; Caddy; separate analytics + payout +
payment-intent services; security review doc; learned-lessons doc; ADRs; per-feature
PRDs with numbered issue breakdowns; localization infra; patchnotes system; feature-flag
deletability.

**NIM Relay today.** CI mirrors the local gate; deployed on Workers free plan; secrets
via `wrangler secret`; `run-state.json` / phase summaries / `DECISIONS.md` as a
lightweight ops log; `verify:*` smoke scripts. No admin surface, no analytics, no client
error aggregation, no operational runbook, no feature flags. Adequate for pre-launch,
far below both benchmarks for a live service.

---

## 15. Where NIM Relay currently falls materially below the bar

Ranked by how much it hurts the product.

| # | Gap | Benchmark reality | NIM Relay today |
|---|---|---|---|
| 1 | **No game.** One-axis hold/release gauge ×5. | NimJump: dense spatial arcade loop, decision/second, difficulty ramp, recovery drama, combo + powerup systems. | 20s of pushing one number. No spatial world, no hazards, no routes, no second system. |
| 2 | **No reason to replay.** | Beat-your-best delta + rotating quests + combo ceiling. | Nothing. Score has no rival and no objective variety. |
| 3 | **No reason to return.** | Login streak (staked NIM), daily quests, leaderboard resets, a world that changed. | Nothing persistent, nothing daily, no streak, no leaderboard. |
| 4 | **Ghost race unbuilt.** The PRD's core social primitive. | NimJump VS = shared seed + stakes + 24h. Nimiq Space = live spectating. | `/play` "ghost" is your own last local run. No other player is ever present. |
| 5 | **No content variety that's *felt*.** | One seeded generator → infinite genuinely-different runs. | Seed changes 3 numbers on the same single mechanic. |
| 6 | **No juice escalation, no audio, no haptics.** | Layered SFX/particles/shake/music, systematized and headless-gated. | Static comet trail + one cyan band. Silent. |
| 7 | **No progression surface.** | Profiles, cosmetics, streak badge, quest tracker, leaderboards, public cards. | Schema exists, zero player-visible progression. |
| 8 | **The NIM handoff is an unrelated wallet action**, not an emotional beat. | Nimiq Space's goal-reward and mining moments are woven into play. | Baton pass (unbuilt) would currently be "now do a wallet transaction." |
| 9 | **No operability.** | Admin, analytics, client-log aggregation, update lock, failed-replay archive, runbooks. | None. Fine for now, not for a competition-grade live service. |
| 10 | **Skill ceiling is flat.** | 20-session player scores multiples of a 1-session player. | 20-session player is a few % better at holding a button. |

**What is at or above the bar:** the deterministic engine + server-replay architecture
(NIM Relay's is arguably cleaner — BigInt fixed-point + a full-final-state hash + a
committed 200-case cross-runtime corpus + mutation testing, vs NimJump's snappedf +
hand-rolled trig + golden replays), the wallet/auth integration, and the HMAC challenge
issuance. **The infrastructure is competition-grade. The game is not.**

---

## 16. The one sentence that matters

If NimJump and Nimiq Space re-entered this round unchanged, NIM Relay as it stands today
would not place — not because the engineering is weak, but because a judge would open
`/play`, hold a button for twenty seconds, and close the tab. The redesign in
`RELAY_GAME_V2.md` exists to change that specific outcome.
