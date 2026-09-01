# NIM Relay - Product Requirements Document

**Version:** 1.0  
**Status:** Build-locked for Cycle II  
**Product type:** Asynchronous social skill game inside Nimiq Pay  
**Competition:** Nimiq Mini Apps Competition, Cycle II  
**Primary network:** Nimiq MainAlbatross for the final public judge path  
**Development network:** Nimiq TestAlbatross  
**Primary tagline:** **How far can one NIM travel?**  
**Supporting line:** **Catch it. Beat the ghost. Pass it on. Keep it moving.**  
**Core product invariant:** A real NIM handoff is the game state transition.

---

# 0. Agent Handoff Contract

This PRD is intended to be handed directly to Claude Code or another autonomous implementation agent.

The implementation agent must treat:

1. this PRD as the product, architecture, game design, protocol, security, testing, evidence, deployment, and completion specification
2. any root `DESIGN.md`, brand assets, supplied NIM Relay moodboards, and approved screen references as the visual-system authority
3. current official Nimiq, Nimiq Pay Mini Apps, Cloudflare Workers, Durable Objects, Supabase, PixiJS, and package documentation as the technical source of truth whenever APIs or package behavior have changed
4. the public repository as a judge-facing product surface, not an internal scratch project
5. the competition's published 105-point rubric as the scoring authority

The agent is expected to build the entire product end-to-end. Do not scaffold, stop at a backend, stop at a game prototype, or stop when unit tests pass.

## 0.1 Autonomous execution rules

- Work autonomously from repository inspection through production deployment.
- Do not ask for plan approval, routine confirmations, or permission to continue between phases.
- Stop only for a genuine user-owned blocker such as Cloudflare authentication, Supabase project credentials, Nimiq Pay account actions, MainAlbatross NIM funding, custom-domain ownership, or another external authorization the agent cannot safely create itself.
- If the repository is empty, bootstrap it.
- If the repository already exists, inspect it before changing architecture.
- Stay inside the repository.
- Use repo-relative paths only.
- Never hardcode a developer machine path such as `/Users/...`.
- Never commit a secret, private key, mnemonic, access token, credential export, raw device identifier, or service-role key.
- `.env.example` contains names and comments only.
- Use the authenticated local GitHub identity. Do not add `Co-Authored-By` or AI attribution trailers.
- Work local-first. Run lint, typecheck, tests, security checks, game replay verification, browser tests, Worker preview, and deployment verification locally before depending on CI.
- GitHub Actions mirrors already-passing local checks. CI is not the debugger.
- Commit after each passing phase with a clean working tree.
- Do not reduce scope because of elapsed time or deadline proximity.
- Remove complexity only when it weakens product coherence, sponsor relevance, judge comprehension, security, correctness, performance, evidence quality, or maintainability.
- Do not replace a required live Nimiq path with a mock.
- Do not fabricate users, activity, countries, retention, transactions, screenshots, leaderboards, or metrics in the public judge path.
- Controlled wallets and testnet runs are allowed only when clearly labeled as controlled/test evidence.
- Mainnet adoption metrics must count real usage only.
- Do not add architecture theater.
- Do not add a third-party service when Cloudflare, Supabase, Nimiq, or browser-native capabilities already solve the requirement cleanly.
- Do not add random monetary prizes, betting, staking, wagers, or games of chance.
- All money-adjacent game outcomes are skill/social outcomes only. The NIM baton is a turn object, not a wager or prize pool.
- Keep every public claim falsifiable and backed by proof.
- If a core technical assumption is falsified by current Nimiq behavior, document the evidence in `DECISIONS.md`, preserve the product invariant where possible, and choose the closest truthful implementation rather than silently faking the promised behavior.

## 0.2 Required project control files

Create and maintain:

```text
README.md
ARCHITECTURE.md
SECURITY.md
PRIVACY.md
SETUP.md
CONTRIBUTIONS.md
DECISIONS.md
CLAIMS.md
TASKS.md
BENCHMARKS.md
EVIDENCE.md
DEMO.md
HANDOFF.md
run-state.json
```

Also maintain:

```text
evidence/
  README.md
  local/
  testnet/
  mainnet/
  replays/
  handoffs/
  load/
  performance/
  security/
  clean-room/
  screenshots/
  submission/
```

`run-state.json` must include the current phase, status, last passing commit, blockers, deployment URLs, network configuration, and final readiness state.

## 0.3 Phase completion contract

At the end of every build phase, create or update a phase summary containing:

- objective
- files changed
- commands executed
- test counts/results
- adversarial cases executed
- network evidence produced
- deployment evidence where relevant
- security findings
- evidence paths
- known limitations
- claim-ledger changes
- decision changes
- commit SHA
- explicit `PASS` or `FAIL`

Do not proceed from a failing phase without fixing it or documenting a genuine external blocker.

## 0.4 Definition of done

NIM Relay is complete only when all of the following are true:

- a new user can open the app inside Nimiq Pay and understand the product within seconds
- onboarding to usable play fits within the competition's under-60-second expectation
- wallet prompts are limited to meaningful consent or wallet actions
- a returning authenticated user can open the app and browse, spectate, play practice, use the inbox, view profiles, and prepare a handoff without reconnecting the wallet
- every real baton pass uses a real NIM transaction through Nimiq Pay
- the backend independently verifies the Nimiq transaction before a handoff becomes canonical
- the backend independently replays game inputs before a run becomes canonical
- client-reported scores are never trusted
- Global Relay works end-to-end
- Quick Relay works end-to-end
- Crew Relay works end-to-end
- Rival Relay works end-to-end
- Daily Relay works end-to-end
- Creator Relay works end-to-end
- Relay Inbox works
- Ghosts work
- Rescue/reroute works where technically possible
- stranded baton behavior is explicit and honest
- Relay Chronicles work
- player profiles, streaks, ranks, achievements, and leaderboards work
- season progression works
- share links and Nimiq Pay deep links work
- one-origin production deployment works over HTTPS
- production WebSockets use Cloudflare Durable Objects
- Durable Object state survives hibernation/restart
- Supabase holds durable relational product history
- R2 holds replay/share artifacts where appropriate
- browser, API, Durable Object, database, game-engine, and chain states reconcile correctly
- no wallet private key is ever handled by the production backend
- no user location claim is presented as blockchain-verified
- no raw IP or raw Nimiq device identifier is persisted by application code
- the public proof view can show real handoff transaction hashes and replay verification evidence
- deterministic local tests, concurrency tests, browser E2E tests, performance tests, security tests, TestAlbatross proof, and MainAlbatross smoke proof pass
- the app has been tested in the real Nimiq Pay WebView on a physical phone
- a clean-room clone/build/reproduction succeeds
- public repo is MIT licensed
- all public docs, screenshots, metrics, URLs, package versions, and claims agree
- the final repository is in `HACKATHON RELEASE READY - HUMAN VIDEO/SUBMISSION ONLY` state

---

# 1. Competition and Winning Objective

NIM Relay is being built for Nimiq Mini Apps Competition Cycle II.

The competition scores a maximum of 105 points:

```text
Design & UX                 25
Functionality               25
Usefulness & Originality    25
Marketing & Distribution    25
NIM Bonus                    5
Total                       105
```

The product must therefore optimize simultaneously for:

- technical truth
- product truth
- economic/ecosystem truth
- judge comprehension
- repeat use
- real user acquisition
- NIM usage
- visual quality
- reliable first-use experience
- public evidence

The internal planning target is not merely "good enough to submit." The target is an outstanding first-place profile across all four 25-point categories plus the NIM bonus.

## 1.1 Competition requirements that affect architecture

The product must:

- run as a Nimiq Pay Mini App
- use Nimiq Pay wallet/payment infrastructure as a core part of the experience
- support NIM
- be fully functional, not a mockup
- be usable on first try
- have a public GitHub repository
- use the MIT license
- remain live through judging
- avoid hardcoded secrets
- avoid gambling or games primarily determined by chance
- disclose user-data collection clearly and obtain informed consent where required

## 1.2 Rubric mapping

### Design & UX

NIM Relay must earn points through:

- immediate premium first impression
- original, coherent visual language
- mobile-native navigation
- one-handed controls
- onboarding under 60 seconds
- cinematic but responsive motion
- clear game state
- no crypto-dashboard feel
- graceful wallet and network errors

### Functionality

NIM Relay must earn points through:

- real NIM handoffs
- Nimiq Pay as a load-bearing state transition
- deterministic skill game
- independent server replay
- live relay state
- asynchronous multiplayer
- reliable invite/claim/pass flow
- concurrency control
- recovery and reconciliation
- production-quality error handling

### Usefulness & Originality

The product thesis must remain:

> NIM Relay is an asynchronous social game where real NIM acts as the turn. Catch it, beat the previous player's ghost, pass it to someone else, and build living relay chains with friends and the world.

It must not degrade into:

- another arcade game with crypto rewards
- another wallet UI
- another DeFi dashboard
- another leaderboard with token points
- another generic referral app
- another collection of unrelated mini-games

### Marketing & Distribution

Distribution must be built into the product:

- friend challenges
- direct invites
- QR invites
- public spectator links
- Nimiq Pay deep links
- crew recruitment
- rematches
- rivalry
- share cards
- Relay Chronicles
- community events
- rescue moments
- live world progress
- creator relays

### NIM bonus

NIM is the baton.

The game cannot progress from one holder to the next without a real NIM transfer.

---

# 2. Product Summary

NIM Relay is a social skill game inside Nimiq Pay.

A relay has a baton value, with the flagship Global Relay fixed to **1 NIM**.

A player receives custody of the baton through a real Nimiq transaction. The player completes a short deterministic skill challenge, optionally competes against the previous runner's ghost, chooses or invites the next runner, and makes one intentional Nimiq Pay transaction to pass the baton.

The transaction is not decorative payment plumbing. It advances the canonical relay state.

The public story is:

> **How far can one NIM travel?**

The technical story is more precise:

> NIM Relay tracks a continuous 1 NIM value lineage through an ordered chain of verified Nimiq transactions.

NIM is fungible. The protocol does not claim that a uniquely identifiable coin unit exists. The product metaphor is a baton. The technical proof is a continuous transaction lineage of the configured baton value.

---

# 3. Product North Star

The product should feel like a living global game, not a crypto application.

The ideal 30-second experience:

1. a NIM baton is incoming from another player
2. the player catches it
3. the previous runner's ghost appears
4. the player completes a short skill challenge
5. the player sees a meaningful social or world objective
6. the player chooses the next runner
7. the player approves one real NIM handoff
8. the transaction confirms
9. the baton visibly launches to the next person
10. the player's contribution becomes part of the relay's permanent history

The wallet should disappear into the game until a wallet action is actually required.

---

# 4. Core Product Principles

## 4.1 Another person is the primary retention mechanism

The strongest reason to return should usually be:

- someone challenged you
- someone beat your ghost
- your crew needs you
- your rival team moved ahead
- your baton is at risk
- a relay you follow entered your region
- your turn is waiting
- someone wants a rematch

XP and streaks support this loop. They do not replace it.

## 4.2 One coherent game language

Do not build unrelated mini-games.

NIM Relay has one core object, one control vocabulary, and one deterministic Baton Physics engine.

Different challenge variants manipulate the same baton.

## 4.3 One meaningful wallet approval per pass

Do not create transaction farming.

No transaction for:

- opening a chest
- claiming XP
- liking a player
- reading a profile
- spectating
- receiving a badge
- changing a cosmetic
- opening the inbox

A NIM transaction occurs when custody of the baton changes.

## 4.4 The chain is not the whole product

The chain proves the handoff.

The server proves the game run.

The social layer creates the reason to return.

The live world creates spectacle.

The UI makes the mechanism understandable.

## 4.5 Skill outcomes do not determine money

Skill scores affect:

- XP
- ranks
- streaks
- badges
- ghost wins
- crew contribution
- event scoring

Skill scores do not decide who receives a prize pool.

There is no wager.

There is no random payout.

There is no opponent stake.

The baton value is a turn object.

## 4.6 Fail honestly

If the current holder refuses to pass the baton, the server cannot move their NIM.

Do not fake rescue.

Do not mint fake continuity.

A baton can become stranded.

That failure is part of the trust model and should become a visible game state.

---

# 5. Target Users

## 5.1 Social player

Wants quick competitive play with friends.

Primary surfaces:

- Quick Relay
- rematches
- ghost battles
- inbox
- profile/rank

## 5.2 Crew player

Wants a persistent shared streak.

Primary surfaces:

- Crew Relay
- crew streak
- crew mission
- crew history
- rescue/reroute

## 5.3 Spectator

May not currently hold a baton.

Primary surfaces:

- live global map
- current runner
- current leg
- relay history
- leaderboards
- follow/share

## 5.4 Competitive player

Cares about mastery.

Primary surfaces:

- Daily Relay
- ghost scores
- season rank
- achievements
- Rival Relay

## 5.5 Creator/community operator

Wants to start a relay around a community or goal.

Primary surfaces:

- Creator Relay
- public share link
- QR
- aggregate analytics
- Relay Chronicle

## 5.6 Judge/reviewer

Needs to verify:

- Nimiq is load-bearing
- transactions are real
- scoring is not client-trusted
- app works in Nimiq Pay
- app is polished and complete
- retention/distribution are designed into the product
- public claims are backed by evidence
- security and privacy limits are explicit

---

# 6. Product Modes

The modes below are part of the build-locked product.

## 6.1 Global Relay

The flagship public relay.

Core properties:

- configured baton value: exactly 1 NIM
- one active holder at a time
- public live map
- public history
- public handoff count
- visible relay age
- current runner
- current objective
- season contribution
- shareable Chronicle
- reroute if next runner fails to claim before transfer
- stranded if current holder disappears or refuses to pass

Core headline:

> One NIM. One world. Keep it moving.

## 6.2 Quick Relay

Asynchronous 1v1 friend battle.

Flow:

```text
Player A creates match
→ Player B accepts
→ A plays
→ A passes baton to B
→ B sees A's ghost
→ B plays
→ B passes baton back
→ repeat for configured rounds
→ final baton returns to match initiator
```

Rules:

- match result is non-monetary
- score comes from deterministic replay
- no stake
- no prize pool
- baton amount remains the turn token
- recommended match length: best of 5
- rematch is one tap
- match can expire
- current holder can strand the match by refusing to pass

Retention message:

> Mariana beat your ghost. Your turn.

## 6.3 Crew Relay

Persistent social group.

Recommended crew size:

```text
2 to 5 players
```

Core loop:

- one baton belongs to the crew relay
- crew attempts at least one qualified handoff per day
- streak survives if requirement is met
- crew mission provides additional optional goals
- no member is forced to transact
- no financial penalty for a broken streak

Crew screen must show:

- current holder
- current streak
- today's requirement
- today's progress
- crew history
- top contributor
- current mission
- reroute/rescue status
- share/invite

## 6.4 Rival Relay

Two independent batons compete under identical public rules.

Examples:

- first to 20 qualified handoffs
- first to reach 5 network-observed countries
- longest survival within a fixed window
- most verified skill points within a fixed number of legs

Rules:

- each side has its own real baton
- race outcome grants non-monetary season points/badges
- no pooled wager
- no random winner
- both paths visible live
- scoring formula published before start
- event state stored and auditable

## 6.5 Daily Relay

A daily deterministic skill challenge.

Purpose:

- gives every player a reason to return even when no baton is waiting
- produces a shared daily comparison point
- does not require a transaction
- does not award money

Rules:

- one official scored attempt per player/device/wallet combination
- unlimited unranked practice after the official attempt
- same engine version and seed for all official players that day
- leaderboard uses server-replayed score
- share card available
- score can contribute to season progression

## 6.6 Creator Relay

User-created relay with whitelisted safe objectives.

Creator may configure:

- title
- short description
- visual badge
- allowed participant mode: open, invite-only, crew
- target number of handoffs
- duration target
- no-repeat-country mode
- target-country route
- survival duration
- handoff cadence

Creator may not configure:

- gambling
- random payouts
- pooled bets
- monetary winner conditions
- arbitrary scripts
- arbitrary transaction amounts above the product cap
- deceptive or illegal content

Competition build default baton cap:

```text
1 NIM
```

The creator starts as initial holder unless another explicitly linked wallet seeds the first handoff.

---

# 7. Baton Physics Engine

## 7.1 Engine goal

The game engine must create short, replayable, skill-based challenges that feel like variations of one premium game.

The engine must be deterministic and reusable in both:

- browser/client
- Cloudflare Worker server verification

Renderer and simulation must be separate.

Recommended architecture:

```text
packages/game-engine/
  src/
    simulation/
    challenges/
    scoring/
    replay/
    input/
    prng/
    fixed-point/
    versions/
```

No DOM, PixiJS, audio, or browser APIs inside the deterministic simulation package.

## 7.2 Fixed timestep

Use a fixed simulation timestep.

Target:

```text
60 ticks/second
```

Avoid cross-runtime floating-point ambiguity where it could affect score.

Prefer integer or fixed-point arithmetic for canonical score inputs.

If floating point is used anywhere canonical, prove deterministic parity between supported client and Worker runtimes with a large seeded test corpus.

## 7.3 Versioning

Every run is bound to:

```text
engine_version
challenge_type
challenge_version
seed
difficulty
duration_ms
rules_hash
```

A leaderboard entry never changes behavior after a new engine release.

Old replays remain replayable by their recorded version.

## 7.4 Challenge types

### Stabilize

Player keeps baton energy inside a moving target corridor.

Score inputs:

- time inside safe zone
- time inside perfect zone
- integrated control error
- boundary strikes
- recovery time

### Slipstream

Player guides the baton through moving route gates.

Score inputs:

- gate hits
- center accuracy
- misses
- completion time
- path deviation

### Pulse Sync

Player matches the baton to a changing signal.

Score inputs:

- timing error
- perfect sync count
- consecutive sync combo
- missed pulses

### Sling

Player charges direction and power before release.

Score inputs:

- angle error
- power error
- timing accuracy
- streak/combo

### Redline

Harder recovery challenge for endangered relays.

Score inputs:

- recovery time
- stability gain
- strikes
- final stability

### Ghost Run

A presentation layer over any base challenge.

The current player's replay is rendered against the previous canonical ghost.

The ghost never changes physics.

## 7.5 Run duration

Target:

```text
15 to 25 seconds
```

Hard maximum for ranked/relay challenges:

```text
30 seconds
```

The challenge should be replayable quickly and feel satisfying in one hand.

## 7.6 Input trace

Store input transitions rather than frame-by-frame screen state.

Canonical trace example:

```json
{
  "engineVersion": "1.0.0",
  "challenge": "stabilize",
  "seed": "...",
  "inputs": [
    [112, 1],
    [386, 0],
    [501, 1],
    [914, 0]
  ]
}
```

Requirements:

- timestamps relative to run start
- integer millisecond or tick representation
- canonical ordering
- bounded input count
- bounded artifact size
- reject impossible timestamps
- reject out-of-order events
- reject events after run end

## 7.7 Server replay

The server must not accept:

```text
score = clientScore
```

Canonical flow:

```text
client receives signed challenge config
→ client plays locally
→ client submits input trace
→ Worker replays trace with same engine
→ Worker derives score/result
→ Worker compares result hash
→ canonical run stored
```

Only the server-derived result can affect:

- relay qualification
- ghost status
- leaderboard
- XP
- achievements
- crew score
- rival score
- daily score

## 7.8 Challenge issuance

Server issues:

```text
run_id
relay_id or daily_id
player_id
leg_number
engine_version
challenge_type
seed
difficulty
start_before
duration_ms
rules_hash
ghost_artifact_id
challenge_mac
```

Use a server-side HMAC or equivalent integrity mechanism.

Client cannot change seed/rules and still submit a valid run.

## 7.9 Replay artifact

For each canonical run store:

```text
run metadata in Supabase
input artifact in R2 when non-trivial
SHA-256 artifact hash in Supabase
canonical score
server replay hash
engine version
verification status
```

Top leaderboard and judge proof entries must be independently replayable from committed/public-safe artifacts when possible.

---

# 8. Ghost System

Ghosts are a core social primitive.

## 8.1 Default ghost

The next runner sees the previous runner's verified trace.

Display:

- ghost name/handle
- prior score
- live relative position
- final score delta

## 8.2 Ghost win

A ghost win is non-monetary.

It can affect:

- XP
- streak
- profile stat
- badge
- social notification

## 8.3 Ghost streak

Track:

```text
consecutive next-runners who failed to beat this ghost
```

Do not create an unbounded incentive to self-pass or farm.

Qualified ghost comparisons require:

- different player
- different wallet
- no self-pass
- anti-abuse pass
- canonical run

## 8.4 Replay privacy

Ghost artifact contains game inputs only.

Never include:

- raw device ID
- IP
- private account data
- wallet signature
- session token

---

# 9. Relay State Model

## 9.1 Relay states

Recommended enum:

```text
DRAFT
READY
ACTIVE
WAITING_FOR_RUN
RUN_VERIFIED
INVITING
RUNNER_CLAIMED
PASS_INTENT_READY
PASS_ATTEMPTING
TX_SUBMITTED
TX_CONFIRMED
HANDOFF_FINALIZING
COMPLETED
STRANDED
EXPIRED
CANCELLED
```

Exact naming may vary, but every asynchronous boundary must be represented.

## 9.2 Canonical holder

At any moment an active relay has:

```text
current_holder_player_id
current_holder_wallet
current_leg_number
baton_amount_luna
```

The current holder changes only after a verified chain transaction.

## 9.3 Qualified handoff

A handoff is `QUALIFIED` only when all are true:

1. relay is active
2. sender equals canonical current holder wallet
3. recipient equals current claimed runner wallet
4. sender and recipient differ
5. amount equals relay baton amount
6. transaction data commitment matches the active handoff intent
7. transaction is included in the canonical Nimiq chain state accepted by the verifier
8. the current holder has a canonical verified game run for the leg
9. transaction has not been used before
10. leg has not already finalized
11. intent has not been superseded
12. anti-abuse validation has not marked the handoff invalid for competitive metrics

The transfer can still exist onchain even if application qualification fails. The product must clearly distinguish:

```text
chain transfer
```

from:

```text
qualified NIM Relay handoff
```

## 9.4 Handoff intent

Before opening Nimiq Pay approval, create a durable server-side intent.

Fields:

```text
intent_id
relay_id
leg_number
from_player_id
from_wallet
to_player_id
to_wallet
baton_amount_luna
challenge_run_id
created_at
claim_expires_at
attempt_expires_at
intent_hash
tx_data_commitment
state
```

Only one sendable intent may exist for one relay leg.

## 9.5 Transaction data commitment

Underlying Nimiq transaction data is limited.

Use a compact ASCII protocol.

Recommended shape:

```text
NR1.<relayCode>.<legCode>.<commitment>
```

Target under 64 UTF-8 bytes.

Recommended:

- `relayCode`: stable short public relay code
- `legCode`: compact base36 leg index
- `commitment`: at least 128 bits of a SHA-256 handoff-intent hash encoded compactly

Before locking the encoding, write tests that prove:

- total byte length
- deterministic encoding
- deterministic parsing
- commitment collision target
- versioning
- malformed rejection

Full intent stays offchain.

The transaction contains a compact commitment that binds it to the full intent.

## 9.6 Transaction verification

The backend must independently retrieve the transaction by hash and verify:

```text
hash
sender
recipient
value
data
network
inclusion state
```

Use the current canonical Nimiq Web Client or current official Nimiq RPC path that is proven compatible with Cloudflare Workers.

Do not assume package compatibility.

Phase 0 must test the chosen verifier inside the actual Worker runtime.

A transaction hash returned by Nimiq Pay is not sufficient proof by itself.

## 9.7 Confirmation policy

Do not mark a handoff canonical at broadcast time.

Use the strongest current chain state exposed by the canonical client that is appropriate for application confirmation.

At minimum require chain inclusion.

If the current Nimiq APIs expose a stronger finalized state, use it.

Document the exact rule in `ARCHITECTURE.md` and `CLAIMS.md`.

## 9.8 Idempotency

Canonical key:

```text
relay_id + leg_number + tx_hash
```

Repeated finalization calls return the already-finalized result.

A transaction hash cannot finalize:

- two legs
- two relays
- two handoffs

## 9.9 Wallet closes after broadcast

Before wallet approval:

1. persist handoff intent
2. mark `PASS_ATTEMPTING`
3. extend the claim reservation
4. invoke Nimiq Pay

After provider returns a hash:

1. persist hash locally in IndexedDB immediately
2. POST hash to backend
3. backend starts verification
4. retry on network failure

If browser closes before POST succeeds:

- client retries from IndexedDB on next open
- server reconciliation can scan expected sender/recipient activity for matching commitment where technically supported

No confirmed transaction should be lost merely because the UI closed.

---

# 10. Rescue, Reroute, and Stranded Batons

This section is intentionally strict because the server has no custody authority.

## 10.1 Reroute before transfer

If a chosen next runner:

- does not accept
- times out
- rejects
- becomes unavailable

and the current holder still controls the baton, the holder may choose another runner.

Invalidate old unattempted intent.

Create a new intent.

## 10.2 Open rescue before transfer

The current holder may open the next slot to an eligible rescue pool.

Another player can claim the slot.

The current holder still must approve the actual NIM transfer.

## 10.3 No fake rescue after holder disappears

If the current holder already received the baton and disappears, the server cannot move their NIM.

State:

```text
STRANDED
```

UI:

> The baton is stranded with the current holder. NIM Relay cannot move funds without that wallet's approval.

## 10.4 Descendant revival

A creator or community may start a new baton linked to a stranded relay.

Call it:

```text
revived descendant
```

Do not present it as the same continuous baton.

The Chronicle should show:

```text
Original relay stranded at handoff #87
Descendant relay started from handoff #87
```

This is an optional continuation mechanic and must preserve claim honesty.

---

# 11. Authentication and Wallet UX

## 11.1 Product goal

Avoid repeated wallet-connect ceremony.

Nimiq Pay still requires native confirmation for sensitive wallet operations. Do not attempt to bypass it.

## 11.2 App startup

On startup:

```text
init Nimiq Mini App SDK
check host/provider availability
restore server session cookie
load public app state
```

`init()` should not itself trigger account approval.

## 11.3 Spectator/practice state

A user may:

- view public relays
- watch the live map
- view leaderboards
- open Relay Chronicles
- play unranked practice

without wallet login where technically possible.

## 11.4 Competitive/player onboarding

One-time player activation:

1. explain fair-play/device consent
2. request Nimiq Pay pseudonymous device identifier
3. request Nimiq account list
4. user chooses account
5. backend creates login nonce
6. request one Nimiq message signature
7. server verifies signature/public key/address relationship using canonical Nimiq crypto primitives
8. create server session
9. store only derived/necessary identity
10. returning sessions restore silently until session expiry

This intentionally spends the two meaningful native prompts once rather than repeating them on every screen.

## 11.5 Device identifier handling

Nimiq Pay device identifier identifies a device, not a human.

Do not claim otherwise.

On backend:

```text
raw_device_id
→ HMAC-SHA256(server pepper)
→ stored_device_hash
```

Never persist raw device ID.

Uses:

- save slot/session continuity
- leaderboard abuse signal
- repeated-account signal
- rate limiting signal

Do not use it as sole Sybil protection.

## 11.6 Session

Recommended:

- HttpOnly
- Secure
- same-origin cookie
- signed opaque session ID
- server-side session record
- rolling expiry
- 30-day maximum without re-authentication
- rotation after wallet relink
- revoke on user logout
- revoke on suspected compromise

Sensitive NIM transfers still require Nimiq Pay regardless of session.

## 11.7 Wallet identity change

Provide explicit:

```text
Switch Nimiq account
```

Do not silently call `listAccounts()` on every launch.

If the user changes wallet in Nimiq Pay outside the app, reconcile at the next wallet-required action.

Never attribute a transaction to a session without verifying the actual onchain sender.

---

# 12. Nimiq Integration

## 12.1 Required packages

Use current canonical versions at implementation time.

Expected:

```text
@nimiq/mini-app-sdk
@nimiq/core
```

Do not blindly pin a stale example version.

Record exact installed versions in `SETUP.md` and `evidence/dependencies.json`.

## 12.2 Provider initialization

Use:

```ts
import { init } from '@nimiq/mini-app-sdk'
```

Use current documented error handling.

## 12.3 Real pass

Use `sendBasicTransactionWithData` for the canonical baton handoff.

Parameters:

```text
recipient = claimed runner wallet
value = relay baton amount in Luna
data = compact NIM Relay commitment
fee = allow Nimiq Pay/current defaults unless evidence requires explicit value
```

A real handoff always triggers the native Nimiq Pay confirmation.

## 12.4 Baton denomination

Flagship Global Relay:

```text
1 NIM = 100,000 Luna
```

Store amounts as integer Luna.

Never use floating point for money.

## 12.5 Test network

Use TestAlbatross for:

- development
- automated chain proof
- controlled wallet campaigns
- destructive/failure testing
- integration testing

## 12.6 Production network

Use MainAlbatross for:

- public competition judge path
- real NIM handoffs
- real user adoption metrics
- final screenshots/proof

Do not put a server-held production private key in the system.

All public user/campaign baton passes should be signed through Nimiq Pay.

## 12.7 Non-custodial invariant

Production backend must never:

- hold user private keys
- sign user NIM transfers
- move a user's baton
- auto-pass funds
- expose a generic signing endpoint

A server-side campaign wallet is not required for the core product.

---

# 13. Location and World Map Truth

The map is central to the product, so location claims must be precise.

## 13.1 Transaction truth

Blockchain verifies:

- sender wallet
- recipient wallet
- amount
- transaction data
- transaction order

Blockchain does not verify:

- human identity
- city
- country
- physical distance

## 13.2 Country

For players who consent, capture only the coarse network country code available at the Cloudflare edge during a qualified handoff.

Rules:

- do not persist raw IP
- store country code only
- mark source as `network_observed`
- document that VPNs/proxies can affect accuracy
- allow user to opt out
- opt-out handoffs still qualify but show `Unknown region`

## 13.3 City

City is optional profile metadata.

If supported:

```text
location_source = user_selected
```

Never display a city as blockchain-verified.

## 13.4 Public copy

Allowed:

> Verified NIM handoff from a player showing Lagos as their profile city.

Avoid:

> Blockchain verified this user was physically in Lagos.

## 13.5 Season country metrics

`countries_reached` means:

```text
distinct consented network-observed country codes among qualified handoffs
```

Document exact definition on the proof page.

---

# 14. Cloudflare Architecture

## 14.1 Deployment model

Use one production origin.

Preferred architecture:

```text
Cloudflare Worker
├── static Vite assets
├── Hono API
├── auth/session
├── share HTML / OG metadata
├── Nimiq transaction verification
├── game replay verification
├── Supabase server client
├── R2 access
└── Durable Object routing
```

Production routes:

```text
/
/api/*
/ws/*
/r/*
/invite/*
/proof/*
/assets/*
```

Do not split frontend and API across unrelated origins unless a proven blocker requires it.

## 14.2 Why one origin

One origin simplifies:

- Nimiq device-identifier scope
- sessions
- CORS
- WebSocket authentication
- deep links
- share links
- CSP
- debugging
- privacy boundaries

## 14.3 Cloudflare Durable Objects

One active relay gets a deterministic object:

```text
RelayRoom(relayId)
```

The Durable Object owns live coordination, not wallet funds.

Responsibilities:

- current live relay state
- serialized runner claims
- spectator WebSockets
- turn deadline
- invite reservation
- pass-intent state
- pending transaction state
- live event broadcast
- reroute/rescue state
- alarm scheduling
- reconciliation retry state
- live participant presence

Use Durable Object persistent storage for canonical live-room state required after hibernation.

Do not rely only on in-memory fields.

## 14.4 WebSocket Hibernation

Use the Cloudflare Hibernation WebSocket API.

Requirements:

- `acceptWebSocket`
- connection attachments for safe session metadata
- reconnect handling
- heartbeat only where needed
- no frame-by-frame gameplay sync
- batch high-frequency logical events where useful
- spectators receive event deltas, not full state every frame

Gameplay itself is local and asynchronous.

The WebSocket broadcasts state changes such as:

```text
runner_claimed
challenge_started
run_verified
pass_attempting
tx_submitted
tx_confirmed
handoff_finalized
relay_stranded
relay_completed
```

## 14.5 Durable Object alarms

Use alarms for:

- claim expiration
- runner timeout
- redline transitions
- pending tx recheck
- reconciliation
- event expiration

Alarm logic must be idempotent because execution is at-least-once.

## 14.6 Cron triggers

Use a small number of Worker Cron jobs for global jobs:

- daily challenge creation/rotation
- season/day aggregation
- orphan/reconciliation sweep

Do not create a Cron job for every relay.

## 14.7 R2

Use R2 for:

- compact replay artifacts
- generated Relay Chronicle assets
- share images
- public-safe evidence bundles
- optional avatar uploads

Store artifact hashes and metadata in Postgres.

---

# 15. Supabase Data Model

Supabase Postgres is the durable relational product database.

Frontend does not access privileged database operations directly.

All authoritative writes go through the Worker API.

Recommended schema follows.

## 15.1 players

```text
id uuid pk
handle text unique
display_name text
wallet_address text unique nullable
wallet_public_key text nullable
avatar_key text nullable
profile_city text nullable
country_opt_in boolean
created_at timestamptz
updated_at timestamptz
status enum(active, suspended, deleted)
```

Do not store raw device ID here.

## 15.2 devices

```text
id uuid pk
player_id uuid nullable
device_hash text
first_seen_at timestamptz
last_seen_at timestamptz
risk_flags jsonb
unique(device_hash, player_id)
```

## 15.3 sessions

```text
id uuid pk
player_id uuid
device_id uuid
expires_at timestamptz
revoked_at timestamptz nullable
created_at timestamptz
last_seen_at timestamptz
```

Store only a hash of the opaque session token if sessions are database-backed.

## 15.4 relays

```text
id uuid pk
public_code text unique
mode enum(global, quick, crew, rival, creator)
title text
description text nullable
state enum
baton_amount_luna bigint
current_leg integer
current_holder_player_id uuid nullable
current_holder_wallet text nullable
creator_player_id uuid
crew_id uuid nullable
rival_event_id uuid nullable
objective_type enum nullable
objective_config jsonb
started_at timestamptz nullable
completed_at timestamptz nullable
stranded_at timestamptz nullable
created_at timestamptz
engine_version text
```

## 15.5 relay_members

```text
relay_id uuid
player_id uuid
role text
joined_at timestamptz
left_at timestamptz nullable
primary key(relay_id, player_id)
```

## 15.6 relay_legs

```text
id uuid pk
relay_id uuid
leg_number integer
holder_player_id uuid
holder_wallet text
run_id uuid nullable
next_player_id uuid nullable
next_wallet text nullable
intent_id uuid nullable
tx_hash text nullable
status enum
country_code text nullable
country_source text nullable
profile_city text nullable
started_at timestamptz
finalized_at timestamptz nullable
unique(relay_id, leg_number)
unique(tx_hash) where tx_hash is not null
```

## 15.7 handoff_intents

```text
id uuid pk
relay_id uuid
leg_number integer
from_player_id uuid
from_wallet text
to_player_id uuid
to_wallet text
baton_amount_luna bigint
run_id uuid
intent_hash text
tx_data text
state enum
created_at timestamptz
claim_expires_at timestamptz
attempt_expires_at timestamptz nullable
tx_hash text nullable unique
superseded_at timestamptz nullable
```

## 15.8 game_runs

```text
id uuid pk
player_id uuid
relay_id uuid nullable
leg_number integer nullable
daily_challenge_id uuid nullable
engine_version text
challenge_type text
challenge_version text
seed text
difficulty integer
rules_hash text
artifact_key text nullable
artifact_sha256 text
client_result_hash text nullable
server_result_hash text
score bigint
success boolean
perfect_metric integer nullable
verified_at timestamptz
created_at timestamptz
verification_version text
```

## 15.9 quick_matches

```text
id uuid pk
relay_id uuid unique
player_a uuid
player_b uuid
best_of integer
score_a integer
score_b integer
current_round integer
state enum
winner_player_id uuid nullable
created_at timestamptz
completed_at timestamptz nullable
```

Match winner is non-monetary.

## 15.10 crews

```text
id uuid pk
public_code text unique
name text
owner_player_id uuid
created_at timestamptz
current_streak_days integer
best_streak_days integer
```

## 15.11 crew_members

```text
crew_id uuid
player_id uuid
role text
joined_at timestamptz
primary key(crew_id, player_id)
```

## 15.12 crew_days

```text
crew_id uuid
date date
qualified_handoffs integer
streak_preserved boolean
primary key(crew_id, date)
```

## 15.13 rival_events

```text
id uuid pk
title text
state enum
objective_type text
objective_config jsonb
relay_a_id uuid
relay_b_id uuid
score_a bigint
score_b bigint
starts_at timestamptz
ends_at timestamptz
winner_side text nullable
```

## 15.14 daily_challenges

```text
id uuid pk
date date unique
engine_version text
challenge_type text
seed text
rules_hash text
starts_at timestamptz
ends_at timestamptz
```

## 15.15 daily_results

```text
daily_challenge_id uuid
player_id uuid
run_id uuid
score bigint
rank integer nullable
official boolean
created_at timestamptz
unique(daily_challenge_id, player_id, official)
```

## 15.16 invites

```text
id uuid pk
token_hash text unique
relay_id uuid
inviter_player_id uuid
target_player_id uuid nullable
target_wallet text nullable
kind enum(friend, open, crew, quick, creator, rescue)
state enum
created_at timestamptz
expires_at timestamptz
claimed_by_player_id uuid nullable
claimed_at timestamptz nullable
```

Store only token hash server-side.

## 15.17 friendships

```text
player_a uuid
player_b uuid
state enum(pending, accepted, blocked)
created_at timestamptz
updated_at timestamptz
unique(player_a, player_b)
```

Canonicalize ordering to prevent duplicates.

## 15.18 achievements

```text
id text pk
name text
description text
icon_key text
rules jsonb
version integer
```

## 15.19 player_achievements

```text
player_id uuid
achievement_id text
unlocked_at timestamptz
evidence jsonb
primary key(player_id, achievement_id)
```

## 15.20 seasons

```text
id uuid pk
name text
theme text
starts_at timestamptz
ends_at timestamptz
objective_config jsonb
state enum
```

## 15.21 season_scores

```text
season_id uuid
player_id uuid
xp bigint
rank integer nullable
qualified_handoffs integer
ghost_wins integer
crew_contribution integer
countries_reached integer
primary key(season_id, player_id)
```

## 15.22 notifications

```text
id uuid pk
player_id uuid
type text
payload jsonb
read_at timestamptz nullable
created_at timestamptz
expires_at timestamptz nullable
```

## 15.23 product_events

Privacy-minimized internal analytics.

```text
id bigint pk
player_id uuid nullable
session_id uuid nullable
event_name text
relay_id uuid nullable
properties jsonb
created_at timestamptz
```

Never put raw IP, raw device ID, wallet signatures, or secret values in event properties.

## 15.24 abuse_signals

```text
id uuid pk
player_id uuid nullable
device_id uuid nullable
signal_type text
severity integer
evidence jsonb
created_at timestamptz
resolved_at timestamptz nullable
```

Abuse state must not silently confiscate funds or block a valid onchain transfer.

It may exclude activity from competitive metrics.

---

# 16. API Surface

Use Hono or equivalent minimal Worker-native routing.

All input/output schemas validated with Zod or equivalent.

Recommended endpoints.

## 16.1 Auth

```text
POST /api/auth/device
POST /api/auth/challenge
POST /api/auth/verify
POST /api/auth/logout
GET  /api/auth/session
```

## 16.2 Player

```text
GET   /api/me
PATCH /api/me
GET   /api/players/:handle
POST  /api/friends/request
POST  /api/friends/:id/accept
POST  /api/friends/:id/block
```

## 16.3 Relay

```text
GET  /api/relays
POST /api/relays
GET  /api/relays/:code
POST /api/relays/:code/join
POST /api/relays/:code/run
POST /api/relays/:code/invite
POST /api/relays/:code/claim-runner
POST /api/relays/:code/pass-intent
POST /api/relays/:code/pass-attempt
POST /api/relays/:code/submit-tx
POST /api/relays/:code/reroute
POST /api/relays/:code/open-rescue
GET  /api/relays/:code/chronicle
```

## 16.4 Game

```text
POST /api/runs/issue
POST /api/runs/:id/finish
GET  /api/runs/:id
GET  /api/runs/:id/replay
```

## 16.5 Quick

```text
POST /api/quick
GET  /api/quick/:id
POST /api/quick/:id/rematch
```

## 16.6 Crews

```text
POST /api/crews
GET  /api/crews/:code
POST /api/crews/:code/join
POST /api/crews/:code/invite
GET  /api/crews/:code/history
```

## 16.7 Rival

```text
POST /api/rivals
GET  /api/rivals/:id
```

## 16.8 Daily

```text
GET  /api/daily
POST /api/daily/run
GET  /api/daily/leaderboard
```

## 16.9 Inbox

```text
GET  /api/inbox
POST /api/inbox/:id/read
```

## 16.10 Rankings

```text
GET /api/rankings/season
GET /api/rankings/ghosts
GET /api/rankings/crews
```

## 16.11 Public proof

```text
GET /api/proof/summary
GET /api/proof/handoffs/:txHash
GET /api/proof/runs/:runId
GET /api/proof/relays/:code
GET /api/proof/evidence
```

## 16.12 WebSocket

```text
GET /ws/relays/:code
```

Authentication optional for public spectator events, required for private player events.

---

# 17. Relay Inbox

The Inbox is a primary retention surface.

Do not bury it as generic notifications.

Priority cards include:

```text
YOUR TURN
Mariana beat your ghost
03:42 remaining
```

```text
CREW AT RISK
19-day streak
6h remaining
```

```text
RIVAL RELAY
Gold is behind by 2
Your side needs a runner
```

```text
RESCUE OPEN
Relay #817 needs a next runner
Current holder is ready to pass
```

```text
DAILY
Today's global challenge is live
```

Sort by:

1. direct turn urgency
2. crew risk
3. rival urgency
4. rescue opportunity
5. social result/rematch
6. daily
7. informational

Never falsely show a rescue if the current holder is gone and no transfer can occur.

---

# 18. Season System

## 18.1 Season 1

Working theme:

> **LIGHT THE WORLD**

Community objective:

- illuminate network-observed countries through qualified real handoffs
- show unknown region separately
- never fake coverage

Player contribution:

- qualified handoffs
- distinct network-observed countries
- ghost wins
- crew contribution
- daily scores

## 18.2 XP

XP is offchain game progression.

Example sources:

```text
qualified handoff
verified challenge completion
ghost win
daily official run
crew streak contribution
rival participation
rescue/reroute contribution
first qualified handoff to a new season country
```

Add anti-farming caps/diminishing returns where needed.

Do not award XP for a self-pass.

## 18.3 Rank

Rank is derived from canonical server metrics.

Never trust client rank.

## 18.4 Achievements

Initial set:

- First Pass
- Relay Hero
- Pass Master
- World Traveler
- Ghost Breaker
- Ghost Wall
- Crew Keeper
- Redline Runner
- Rival Runner
- Daily Top 10%
- 10 Handoffs
- 50 Handoffs
- 100 Handoffs
- 5-Day Crew Streak
- 10-Day Crew Streak
- First New Country Contribution

Achievement unlock includes evidence JSON.

---

# 19. Relay Chronicle

Every completed or stranded relay generates a shareable Chronicle.

Chronicle content:

```text
relay name
relay code
baton amount
state
handoff count
real transacting wallets
network-observed countries
duration
route
fastest verified leg
best ghost battle
redline moments
stranded point if any
top contributor
final holder
transaction links
```

Share card copy example:

```text
RELAY #024
1 NIM
137 qualified handoffs
31 network-observed countries
26h 18m alive
```

Never show `31 countries` if that data is self-declared or unknown without labeling the source.

Dynamic share pages must include:

- title
- image
- current stats
- open-in-Nimiq-Pay CTA
- public browser-safe view
- Nimiq Pay deeplink

---

# 20. Information Architecture

## 20.1 Core routes

```text
/
/inbox
/live
/relay/:code
/relay/:code/play
/relay/:code/pass
/relay/:code/chronicle
/quick/:id
/crew/:code
/rival/:id
/daily
/rescue
/create
/rankings
/profile/:handle
/me
/settings
/privacy
/proof
```

## 20.2 Bottom navigation

Recommended:

```text
Home
Inbox
Live
Rankings
Profile
```

Inbox badge indicates actionable turns.

## 20.3 Browser outside Nimiq Pay

Do not hard-fail.

Allow public spectator surfaces.

For wallet-required actions show:

> Open NIM Relay in Nimiq Pay

Provide the canonical HTTPS deep link.

---

# 21. Onboarding

Onboarding must be visually premium and operationally short.

## 21.1 First screen

Headline:

> Pass one NIM across the world.

CTA:

> Join the Relay

Secondary:

> Watch live

## 21.2 Explanation

Three steps:

1. Receive the baton
2. Complete your leg
3. Pass it on

## 21.3 Fair-play consent

Explain:

- NIM Relay can request a pseudonymous device ID for fair-play/leaderboards
- approximate country may be stored only with consent
- no exact location required
- no raw IP stored by application code
- wallet remains in Nimiq Pay

## 21.4 Wallet activation

Friendly flow:

```text
Choose Nimiq account
→ verify this player profile once
→ return without repeated reconnect prompts
```

Do not lead with the phrase:

```text
Connect wallet
```

unless provider UX requires it.

Use game language:

> Set up your runner

## 21.5 Display name

Choose handle/display name.

Do not block play on avatar upload or optional profile city.

## 21.6 Returning user

No onboarding carousel.

Restore session and go directly to the most important actionable screen.

If an incoming turn exists, open or foreground it.

---

# 22. Screen Requirements

The supplied moodboard defines the quality bar.

## 22.1 Relay Command Center

Must include:

- flagship Global Relay
- live baton position
- current objective
- handoff count
- real transacting wallets
- network-observed countries
- relay age
- Join/Watch CTA
- Daily card
- Inbox preview
- top relayers
- recent activity

Avoid a generic stat-card wall.

## 22.2 Live World Relay

Must include:

- stylized world map
- glowing baton route
- current leg
- verified transaction state
- recent handoffs
- spectators
- current objective
- share

Map should be proprietary/original visual art, not a generic map SDK unless genuinely needed.

Use an internal SVG/world projection asset to avoid third-party keys.

## 22.3 Your Turn

Must include:

- previous runner
- incoming baton
- relay context
- countdown
- current objective
- ghost status
- clear claim/play CTA
- no wallet reconnection CTA

## 22.4 Game scene

Must feel like a game, not an HTML form.

Requirements:

- PixiJS/WebGL or Canvas rendering
- full-screen safe-area aware layout
- fixed HUD
- touch-first control
- optional haptic/vibration when supported
- optional sound with mute control
- 60 FPS target
- reduced-effects fallback
- reduced-motion mode
- pause only where rules permit
- no accidental navigation during play

## 22.5 Confirm Pass

Must show:

- next runner
- baton amount
- relay code
- leg number
- one clear wallet approval CTA
- explanation that this is the real NIM handoff
- no repeated connect action

## 22.6 Choose Next Runner

Sources:

- accepted friends
- crew members
- recent runners
- active rescue candidates
- invite link
- QR
- Web Share

Recommended runner ranking may consider:

- recent activity
- pass reliability
- current availability
- anti-abuse state

Never show a fake "online" state.

## 22.7 Relay Complete

Must include:

- Chronicle summary
- share
- season contribution
- unlocked achievements
- next relay CTA

## 22.8 Profile

Must include:

- handle
- current season rank
- qualified handoffs
- pass reliability
- ghost wins
- crew streaks
- network-observed countries
- achievements
- recent relay history

## 22.9 Quick Relay Thread

Feels like an asynchronous conversation:

```text
Tim  8,420
↓ pass
Mariana  9,104
↓ pass
Your turn
```

Show:

- score
- round
- ghost delta
- baton state
- rematch

## 22.10 Crew

Show:

- members
- current holder
- streak
- today status
- mission
- history
- invite
- at-risk state

## 22.11 Rival

Show two live paths and score without overwhelming the user.

## 22.12 Rescue Board

Only show actually rescuable relays.

Do not list stranded relays as rescuable.

## 22.13 Proof View

Separate technical/judge surface.

See Section 35.

---

# 23. Visual and Interaction Direction

## 23.1 Art direction

The app should feel like a premium global game studio built a Nimiq-native social experience.

Original visual identity only.

Do not imitate or reuse another game's proprietary visual system.

Core visual language:

- deep midnight navy
- luminous NIM gold
- restrained electric cyan for live/system states
- high-contrast clean type
- cinematic route lines
- the baton as a recognizable hero object
- subtle world illumination
- premium motion
- deliberate glass/translucent panels only where legibility remains strong
- rich but controlled particles
- large, clear primary actions

## 23.2 Avoid

- generic crypto dashboard
- giant wallet address cards
- token price widgets
- fake terminal UI
- random neon cyberpunk
- cluttered analytics grids
- excessive blockchain jargon
- repeated wallet prompts
- fake chain icons
- overlong onboarding copy
- autoplay background video that hurts WebView performance

## 23.3 Motion

Motion should communicate state.

Examples:

- incoming baton
- catch
- ghost reveal
- challenge success
- pass suspended while waiting for native wallet approval
- transaction confirmation launch
- route extension
- streak preserved
- redline warning
- stranded state

Use CSS/Motion for UI transitions and PixiJS for game/cinematic canvas.

Respect `prefers-reduced-motion`.

## 23.4 Audio/haptics

Feature-detect.

Never require audio.

Provide:

```text
Sound
Haptics
Reduced effects
```

settings.

---

# 24. Frontend Stack

Recommended:

```text
React
TypeScript strict
Vite
PixiJS
Motion
Zustand
TanStack Query
Zod
@nimiq/mini-app-sdk
```

Use current compatible versions.

## 24.1 Why Vite

This is a mobile WebView game.

Vite keeps the runtime simple and makes LAN/Nimiq Pay development straightforward.

## 24.2 State boundaries

Zustand:

- ephemeral app state
- game state outside deterministic engine
- UI preferences

TanStack Query:

- server data
- relay state
- inbox
- rankings
- profile
- proof data

Do not duplicate canonical relay state across stores unnecessarily.

## 24.3 Local persistence

Use IndexedDB for:

- unsent tx-hash recovery
- session-safe non-secret preferences
- pending upload/replay retry
- cached public state if useful

Never store:

- wallet private keys
- Nimiq Pay secrets
- raw authentication signatures as reusable credentials

---

# 25. Local Development

Nimiq Pay WebView must be treated as a first-class development target.

## 25.1 Toolchain

Use current Nimiq-supported Node requirement.

As of PRD verification, official Nimiq Mini App tutorial requires Node 22+.

Pin the actual selected Node and package-manager versions in repo config after verifying current docs.

## 25.2 LAN development

The phone must load the development machine over LAN.

Vite:

```text
server.host = true
strictPort = true
```

Set HMR host to the development machine's LAN IP when needed.

Do not configure mobile WebView clients to call `localhost`, because that resolves to the phone.

## 25.3 Same-origin local proxy

Preferred:

```text
phone
→ http://LAN_IP:5173
→ Vite
   ├── app
   ├── /api proxy → local Wrangler Worker
   └── /ws proxy  → local Wrangler Worker
```

This avoids unnecessary CORS drift between local and production.

## 25.4 Worker runtime

Test under real `workerd`/Wrangler preview, not only Node.

A package working in Node does not prove it works in Cloudflare Workers.

---

# 26. Backend Stack

Use:

```text
Cloudflare Workers
Hono
Durable Objects
R2
Worker Cron
Supabase Postgres
```

Do not add Redis, Firebase, Railway, MongoDB, a standalone WebSocket server, or Kubernetes.

## 26.1 Supabase access

Prefer server-side Supabase client/API initially.

Do not expose service-role credentials to browser.

Use migrations under:

```text
supabase/migrations/
```

Only introduce Hyperdrive after measured evidence shows it is useful.

## 26.2 Database authority

Supabase is authoritative for durable relational history.

Durable Object is authoritative for serialized live relay coordination.

Nimiq chain is authoritative for real value transfer.

The game replay engine is authoritative for skill result.

The architecture must never confuse those four truths.

---

# 27. Real-Time Model

NIM Relay is asynchronous.

Do not build frame-synchronized multiplayer.

WebSocket events are product-state events.

Client reconnect flow:

1. connect to relay room
2. send session/auth
3. server returns full canonical snapshot
4. client applies snapshot
5. server sends deltas
6. on reconnect, repeat snapshot

Never assume all events were received.

Every event has:

```text
event_id
relay_version
type
timestamp
payload
```

Client ignores stale versions.

---

# 28. Notifications and Re-engagement

Primary guaranteed channel:

- in-app Relay Inbox
- share links
- Nimiq Pay deep links
- Web Share API
- QR invites

Feature-detect browser notification support.

Do not make closed-app push a launch blocker unless current Nimiq Pay explicitly supports a reliable path.

If unsupported, hide the push toggle rather than faking it.

Re-engagement triggers:

- your turn
- ghost beaten
- rematch
- crew streak risk
- rival lead change
- rescue opportunity
- daily live
- achievement
- relay completed
- followed relay milestone

---

# 29. Deep Links and Sharing

Use current official Nimiq Pay deep-link format.

Public app route example:

```text
https://APP_ORIGIN/invite/<token>
```

Nimiq Pay HTTPS opener should open the full app URL.

Claude must verify query/path preservation in current Nimiq Pay before locking invite encoding.

Share options:

- native share
- copy link
- QR
- share card

Invite token:

- opaque random token
- server stores hash only
- expiration
- one-use or policy-limited
- no wallet address in the URL
- no raw session information in the URL

---

# 30. Anti-Cheat

## 30.1 Threats

- client submits fake score
- client edits seed
- client edits difficulty
- client replays another person's run
- client submits impossible input rate
- client reuses a canonical replay
- client modifies engine
- client reports a successful run without playing

## 30.2 Defenses

- server-issued run config
- challenge integrity MAC
- deterministic replay
- player/session binding
- engine version binding
- timestamp constraints
- artifact hash
- duplicate detection
- input-size limits
- rate limits
- impossible-input rejection
- server score only

## 30.3 Public proof

For selected runs expose:

- engine version
- seed
- input artifact
- canonical score
- replay command
- server result hash

This is a judge-facing technical moat.

---

# 31. Anti-Abuse and Sybil Resistance

Do not claim one-human-one-account.

Signals:

- linked wallet
- derived device hash
- repeated wallet/device graph
- transaction graph
- self-pass attempts
- repeated counterparties
- impossible run traces
- high-frequency invite farming
- account age
- pass reliability
- rate limits

Competitive exclusions may apply to suspicious activity.

Rules:

- never confiscate NIM
- never block a valid user from seeing their onchain transaction
- separate `transfer happened` from `competitive activity qualified`
- allow appeal/report in admin tooling or manual review notes
- document anti-abuse limits

---

# 32. Security Model

Create `SECURITY.md`.

## 32.1 Wallet threats

- malicious recipient substitution
- stale recipient
- wrong amount
- wrong network
- repeated wallet prompt abuse
- transaction replay
- compromised web session
- wallet account change

Defense:

- server-signed intent
- immutable confirmed recipient during pass attempt
- exact amount validation
- transaction-data commitment
- server chain verification
- native Nimiq Pay approval
- no backend signing authority

## 32.2 Handoff threats

- duplicate tx hash
- stale intent
- superseded intent
- self-pass
- two runners claiming simultaneously
- one leg finalizing twice
- race between reroute and payment
- browser closes after broadcast

Defense:

- Durable Object serialization
- database uniqueness
- idempotency keys
- intent state machine
- local tx-hash recovery
- server reconciliation
- claim reservation

## 32.3 Auth threats

- nonce replay
- forged signature
- stolen session
- raw device ID leak
- wallet/account mismatch

Defense:

- single-use nonce
- expiration
- origin/domain bound message
- canonical public-key/signature verification
- address derivation check
- HttpOnly Secure session
- session rotation
- raw device ID HMAC before persistence

## 32.4 Game threats

See Anti-Cheat.

## 32.5 Web threats

- XSS
- CSRF
- injection
- open redirect
- malicious invite token
- file upload abuse
- WebSocket auth bypass
- CSP drift

Use:

- strict CSP
- output escaping
- schema validation
- same-origin sessions
- CSRF protection for cookie-authenticated writes
- safe redirect allowlist
- upload MIME/size validation
- WebSocket auth and authorization

## 32.6 Database threats

- service-role leak
- mass assignment
- missing row ownership checks
- inconsistent relay state

Frontend never gets privileged credentials.

Worker validates authorization explicitly.

## 32.7 Privacy threats

- logging raw IP
- logging raw device ID
- storing wallet signatures unnecessarily
- location overclaim
- linking social profile to more data than required

Minimize.

---

# 33. Privacy Contract

Create a public `PRIVACY.md` and in-app privacy page.

| Information | Stored? | Public? | Notes |
|---|---:|---:|---|
| Nimiq wallet address | Yes after wallet link | Partly | Chain addresses are public, UI truncates by default |
| Raw wallet private key | No | No | Never available to app |
| Login signature | Avoid long-term storage | No | Verify, then retain only proof metadata/hash if needed |
| Raw Nimiq device identifier | No | No | HMAC before persistence |
| Derived device hash | Yes | No | Abuse/session signal |
| Raw IP | No by app database | No | Cloudflare may process network traffic, application does not persist it |
| Network country code | Opt-in | Aggregate/public | Approximate, VPN-sensitive |
| Profile city | Optional | User-controlled | Self-selected, not verified |
| Game input replay | Yes | Selectively public | Contains game inputs only |
| Score | Yes | Yes where leaderboard public | Server-derived |
| NIM transaction | Onchain | Yes | Public blockchain |
| Session token | Hashed/opaque | No | HttpOnly |
| Email/phone | No | No | Not required |

Provide:

- export offchain profile data
- delete offchain profile
- explain that onchain transactions cannot be deleted
- opt out of country display
- block another player
- report handle/content

---

# 34. Required Error Handling

Every critical action needs:

```text
idle
loading
success
user-cancelled
recoverable-error
final-error
offline
stale-state
```

## 34.1 Nimiq Pay

Handle:

- provider unavailable
- SDK init timeout
- user denies device ID
- user denies account access
- user denies signature
- user denies transaction
- no accounts
- consensus unavailable
- invalid transaction
- insufficient NIM
- transaction hash returned but chain not yet included
- transaction failed/expired
- account changed

User cancellation is normal, not "Something went wrong."

## 34.2 Relay

Handle:

- relay ended
- relay stranded
- not current holder
- run already completed
- invite expired
- runner already claimed
- runner claim lost race
- intent superseded
- pass already submitted
- current holder changed
- amount mismatch
- wrong recipient
- wrong sender
- invalid tx data
- duplicate tx
- chain verifier temporarily unavailable
- reconciliation pending

## 34.3 Game

Handle:

- challenge expired
- engine version missing
- asset failed
- WebGL unavailable
- reduced-effects fallback
- input artifact too large
- replay mismatch
- server verification timeout
- retry without losing trace

## 34.4 Infrastructure

Handle:

- Supabase unavailable
- R2 unavailable
- Durable Object unavailable
- WebSocket disconnect
- stale cached state
- Cloudflare route failure

Degrade public browsing where safe.

Do not fabricate state.

---

# 35. Judge Proof View

`/proof` is a public, read-only technical surface.

## 35.1 Summary

Show actual values:

```text
Production network
App version
Engine version
Total linked Nimiq wallets
Real transacting wallets
Qualified handoffs
Active relays
Completed relays
Network-observed countries
Verified game runs
Server replay pass rate
Latest deployment
```

Separate:

```text
REAL USERS
CONTROLLED TEST WALLETS
TESTNET RUNS
```

Never combine them.

## 35.2 Relay proof

For a selected relay:

```text
Relay code
Baton amount
State
Current holder
Leg count
Chronological handoffs
```

Each handoff:

```text
leg
tx hash
sender
recipient
amount
tx data
chain state
run ID
server replay verified
country source
timestamp
```

Provide explorer/current canonical Nimiq lookup link where available.

## 35.3 Replay proof

Show:

```text
run ID
challenge
engine version
seed
input hash
artifact
server score
server result hash
replay command
```

## 35.4 Failure proof

Show selected negative cases:

- fake score rejected
- stale intent rejected
- wrong recipient rejected
- duplicate tx rejected
- self-pass excluded
- concurrent runner claim loser rejected
- stranded baton state
- WebSocket reconnect recovery
- confirmed tx recovery after client interruption

A strong failure-path demo is mandatory.

---

# 36. Analytics and Product Metrics

No third-party analytics SDK is required.

Use privacy-minimized internal events.

## 36.1 North-star metric

```text
Qualified handoffs per weekly active wallet
```

## 36.2 Retention

Measure:

- D1 return
- D7 return when enough time has elapsed
- returning player after receiving a turn
- rematch rate
- crew streak survival
- average active relay threads/player
- average active session duration
- daily repeat rate

## 36.3 Distribution

Measure:

- invites created
- invite opens
- Nimiq Pay deep-link opens where observable
- invite claims
- invite to linked-wallet conversion
- invite to qualified-handoff conversion
- QR shares
- share actions
- public Chronicle visits

## 36.4 NIM usage

Measure:

- real transacting wallets
- qualified MainAlbatross handoffs
- NIM volume moved through qualified handoffs
- handoffs per transacting wallet
- unique sender-recipient edges

Do not call transacting wallets unique humans.

## 36.5 Game

Measure:

- verified runs
- completion rate
- replay verification failure
- average score
- ghost challenge rate
- ghost win rate
- practice to relay conversion

## 36.6 Session duration

If measuring:

- use Page Visibility API
- count only foreground activity
- low-frequency heartbeat
- bound individual heartbeat contribution to avoid inflating closed-tab time
- no raw IP

---

# 37. Performance Requirements

## 37.1 Mobile

Target tested widths:

```text
320
360
390
430
768
```

Also verify desktop/browser spectator surfaces.

## 37.2 Game performance

Target:

- 60 FPS on modern mid-range phone
- visual degradation before physics degradation
- canonical simulation never changes based on graphics quality
- no long main-thread stalls during active challenge
- preload challenge-critical assets before run
- no network dependency during the 15-25 second skill run

## 37.3 Asset strategy

Use:

- sprite atlases
- WebP/AVIF
- vector where appropriate
- compressed audio
- lazy loading
- cache headers with content hashes

Do not ship giant uncompressed PNGs from the moodboard as production assets.

Moodboards are references, not runtime sprites.

## 37.4 Performance evidence

Measure:

- first load
- route transition
- game frame timing
- memory where available
- replay verify latency
- API p50/p95
- WebSocket reconnect
- transaction verification latency
- Supabase query latency

Record in `BENCHMARKS.md`.

---

# 38. Accessibility

Target WCAG 2.2 AA where practical.

Requirements:

- logical focus order
- keyboard usability outside game
- visible focus
- accessible labels
- no color-only state
- reduced motion
- reduced effects
- screen-reader labels for key game state
- sufficient contrast
- large touch targets
- safe-area insets
- no audio-only information
- haptics never required
- game tutorial accessible without reading long documentation

Provide a practice mode so users can learn controls before a real baton pass.

---

# 39. Testing Strategy

Use deep proof and wide proof.

## 39.1 Unit tests

Cover:

- money conversion NIM/Luna
- tx-data encoding/decoding
- intent hashing
- state transitions
- invite expiration
- runner claim
- idempotency
- rank calculations
- streak calculations
- objective scoring
- country aggregation
- session expiry
- permission checks

## 39.2 Game deterministic tests

Run a large seeded corpus.

Target:

```text
10,000+ deterministic simulation/replay scenarios
```

Label:

> deterministic scenarios, not users.

Test:

- same seed + same inputs = same result
- client package = Worker verifier
- bounds
- empty input
- max input
- out-of-order
- duplicate
- impossible rate
- end-of-run edge
- each challenge type
- multiple engine versions

## 39.3 Durable Object tests

Use current Workers Vitest integration.

Test:

- 100 concurrent runner-claim attempts, only one wins
- reconnect snapshot
- hibernation-safe state
- duplicate message
- stale relay version
- alarm retry
- intent expiration
- pass-attempt lock
- reroute race
- tx finalization race
- strand transition

## 39.4 Database tests

Test:

- uniqueness
- foreign keys
- tx hash uniqueness
- leg uniqueness
- migrations from fresh database
- idempotent upserts
- deletion/privacy behavior

## 39.5 Nimiq verifier tests

Fixtures:

- correct tx
- wrong sender
- wrong recipient
- wrong amount
- wrong data
- pending
- included
- duplicate
- unknown hash
- stale/superseded intent

## 39.6 API tests

- auth challenge replay
- invalid signature
- expired session
- CSRF
- unauthorized relay actions
- malformed payloads
- rate limits
- privilege boundaries

## 39.7 Browser E2E

Playwright:

- public browser spectator path
- Nimiq Pay unavailable state
- onboarding UI
- practice run
- relay screens
- invite flow using fixtures
- Quick Relay
- Crew
- Rival
- Daily
- Creator
- inbox
- proof
- mobile viewports
- reconnect
- offline/retry

Wallet-native confirmations need real Nimiq Pay manual/live verification in addition to browser fixtures.

## 39.8 Real Nimiq Pay device tests

Required on physical phone:

- SDK initialization
- device identifier prompt
- account-list prompt
- sign prompt
- session restoration
- deep link
- `sendBasicTransactionWithData`
- user rejection
- insufficient balance
- transaction confirmation
- WebView back/navigation
- keyboard
- share
- QR
- game FPS
- safe areas

Record device/app version in evidence.

## 39.9 TestAlbatross campaign

Use controlled ephemeral test wallets only for protocol/load evidence.

Publish:

- wallet addresses
- tx hashes
- relay codes
- replay IDs
- failure cases
- recovery cases

Never publish private keys.

Label controlled wallets.

## 39.10 MainAlbatross proof

Run a small end-to-end real NIM relay before public launch.

Then collect real user metrics through early access.

Do not synthesize MainAlbatross "user adoption" with agent-generated wallets.

---

# 40. Load and Scalability

Test:

- thousands of public relay reads
- hundreds of spectators in one room where practical
- concurrent invite claims
- replay verification throughput
- leaderboard query
- inbox query
- transaction verification retries

Because gameplay is local, do not stream frame data through WebSockets.

Cloudflare room traffic should remain event-level.

Use WebSocket Hibernation.

Document measured capacity and bottlenecks.

Do not claim unlimited scale.

---

# 41. Deployment

## 41.1 Environments

### Local

```text
Vite LAN
Wrangler dev
local/test Supabase
TestAlbatross
```

### Staging

```text
stable staging Worker URL
staging Supabase
TestAlbatross
```

### Production

```text
stable HTTPS origin
production Worker
production Supabase
R2
Durable Objects
MainAlbatross
```

## 41.2 Production origin

Prefer custom domain if the user supplies it before early access.

Otherwise use a stable `workers.dev` URL and keep it stable throughout judging.

Changing origin resets Nimiq Pay's origin-scoped device identifier consent behavior.

## 41.3 Wrangler

Use current Workers static-assets configuration.

Required bindings:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY secret
SESSION_SECRET secret
DEVICE_HASH_SECRET secret
RUN_CHALLENGE_SECRET secret
REPLAY_BUCKET R2 binding
RELAY_ROOM Durable Object binding
```

Do not put service-role keys into Vite `VITE_*` variables.

## 41.4 Supabase

Use a fresh project unless an existing NIM Relay project is intentionally provided.

Apply migrations.

Create required indexes.

Verify backup/export path.

## 41.5 Deployment verification

After every production deploy:

- fetch public URL
- verify static assets
- verify API health
- verify WebSocket
- verify Supabase access
- verify proof page
- verify Nimiq Pay custom URL load
- run production smoke E2E
- record Worker deployment/version ID
- capture source commit SHA

---

# 42. Secrets and User-Provided Resources

Ask the user only when actually needed.

Likely:

- Cloudflare/Wrangler authentication if not already active
- Supabase project URL/credentials or permission to create/configure the project
- Nimiq Pay access on a physical phone for real wallet testing
- real NIM for the MainAlbatross flagship baton and public campaign
- custom domain credentials only if the user wants a custom domain

The agent can generate:

- session secrets
- HMAC secrets
- local test wallets
- TestAlbatross fixtures
- QR/invite secrets
- all non-user-owned configuration

Generated secrets remain local/Cloudflare secret storage and never appear in chat or Git.

---

# 43. Repository Layout

Recommended:

```text
nim-relay/
  apps/
    web/
      src/
        app/
        components/
        game/
        routes/
        hooks/
        stores/
        nimiq/
        styles/
    worker/
      src/
        api/
        auth/
        durable/
        nimiq/
        game-verifier/
        jobs/
        proof/
        security/
  packages/
    game-engine/
    relay-protocol/
    shared/
    test-utils/
  supabase/
    migrations/
    seed/
  scripts/
    verify/
    evidence/
    load/
    clean-room/
  docs/
  evidence/
  public/
  .github/
    workflows/
```

A simpler structure is acceptable if it improves clarity and preserves boundaries.

---

# 44. Public Documentation

## 44.1 README first screen

Within the first viewport a judge should understand:

```text
NIM Relay
How far can one NIM travel?

Real NIM is the turn.
Catch it, beat the ghost, pass it on.

[Open Mini App]
[Watch Live]
[Proof]
```

Then show actual current proof:

```text
real transacting wallets
qualified handoffs
verified game runs
production network
latest live relay
```

Only real values.

## 44.2 Architecture

Must explain four authorities:

```text
Nimiq chain        → money/handoff truth
Game verifier      → skill truth
Durable Object     → live coordination truth
Supabase           → durable social/product history
```

## 44.3 Security

Threat model and limitations.

## 44.4 Privacy

Exact collection/disclosure contract.

## 44.5 Setup

Fresh clone to local development.

## 44.6 Contributions

Inspect Nimiq ecosystem repos for real upstream contribution opportunities.

Do not create low-value spam.

Before any PR:

- verify current main
- search duplicates
- reproduce issue
- add regression test where useful
- run native repo checks

Target 1-3 maintainer-quality contributions only when justified.

## 44.7 Decisions

Record major architectural changes and rejected alternatives.

## 44.8 Claims

Use statuses:

```text
VERIFIED
TARGET
LIMITATION
NOT_CLAIMED
```

---

# 45. Claim Ledger

At minimum track these.

## 45.1 "How far can one NIM travel?"

**Consumer metaphor.**

Technical explanation:

> A fixed 1 NIM relay value is passed across an ordered lineage of real Nimiq transactions. NIM is fungible, so NIM Relay does not claim a uniquely identifiable coin unit.

## 45.2 "Every handoff is a real Nimiq transaction"

`VERIFIED` only for qualified handoffs with independent chain verification.

## 45.3 "Server-verified skill"

`VERIFIED` only if canonical score is reproduced server-side from input trace.

## 45.4 "X wallets"

Specify:

- linked wallets
- transacting wallets
- controlled test wallets

Never conflate.

## 45.5 "X users"

Use only when counting actual product accounts under the defined metric.

Do not call distinct wallets distinct humans.

## 45.6 "X countries"

Define source.

Preferred public metric:

> distinct network-observed country codes from consenting qualified handoffs

## 45.7 "Same NIM"

Never claim atomic coin identity.

## 45.8 "No repeated wallet prompts"

Allowed claim:

> Returning sessions avoid repeated app-login wallet prompts. Every real NIM transfer still requires native Nimiq Pay approval.

## 45.9 "Rescue"

Do not claim server can rescue funds from an absent current holder.

---

# 46. Retention Design

Retention must exist at multiple time horizons.

| Horizon | Product reason |
|---|---|
| 20-30 seconds | catch, skill, ghost, pass |
| 5-10 minutes | multiple turns, Quick Relay, rematch, rescue |
| tomorrow | Daily, crew streak, pending friend turns |
| week | rival events, crew missions, rank movement |
| season | Light the World, achievements, reputation |
| long-term | creator relays, records, social graph, baton chronicles |

## 46.1 Return loops

Mandatory:

- direct turn
- ghost beaten
- rematch
- crew streak
- Daily
- Rival
- season progress
- followed relay milestone
- creator invite

## 46.2 Longer session design

A player should be able to have multiple simultaneous asynchronous threads.

Home/Inbox can show:

```text
Quick Relay with Mariana
Crew baton waiting
Rival event
Daily challenge
Global relay watch
Rescue opportunity
```

Do not force waiting for one global baton.

---

# 47. Distribution Design

Product-created distribution:

- every Quick Relay invites a second person
- Crew requires recruitment
- Creator Relay creates a share surface
- Rival Relay creates team recruitment
- Chronicles are public/shareable
- rescue moments create urgency
- live map creates spectator content
- Daily creates repeat share cards
- QR supports physical/community events

Attribution:

```text
invite_id
referrer_player_id
campaign_code nullable
source enum
```

No referral payout is required.

---

# 48. Business and Ecosystem Thesis

NIM Relay should remain useful beyond the competition.

Potential long-term business seams:

- sponsored community relays
- branded event relays
- creator/community analytics
- seasonal partnerships
- Nimiq ecosystem campaigns

Do not implement fake enterprise dashboards or monetization unless actual demand emerges.

The product's sponsor value is immediate:

- more reasons to open Nimiq Pay
- more real NIM wallet interactions
- more NIM transfers
- friend-to-friend acquisition
- repeat sessions
- shareable Nimiq-native culture

---

# 49. Evidence Campaign

## 49.1 Deep proof

Produce one fully documented relay:

```text
create
→ authenticate runners
→ verified skill run
→ runner claim
→ pass intent
→ native Nimiq approval
→ chain inclusion
→ backend verification
→ holder update
→ next ghost
→ repeat
→ Chronicle
```

## 49.2 Wide proof

Controlled TestAlbatross:

- many replay runs
- concurrency
- many handoffs
- wrong transaction cases
- reroute
- timeout
- client interruption
- stranded state

MainAlbatross:

- real public handoffs
- real distinct wallets
- real user growth
- real share links

## 49.3 Target metrics

These are targets, not claims:

```text
TARGET: 100+ real linked Nimiq wallets
TARGET: 50+ real transacting wallets
TARGET: 250+ qualified MainAlbatross handoffs
TARGET: 10+ network-observed countries
TARGET: 25+ completed Quick Relay matches/rematches
TARGET: 5+ active crews
TARGET: measurable repeat usage before judging
STRETCH: 1,000 qualified handoffs
```

The public product displays actual values only.

---

# 50. Submission Packaging

Required:

- public MIT GitHub repo
- live HTTPS Mini App
- Nimiq Pay tested
- written description under competition limit
- polished screenshots
- demo video
- public proof page
- README outcome-first
- clear NIM integration
- current actual metrics
- no broken links
- no private developer knowledge required

## 50.1 Demo structure

Target 90-120 seconds.

Suggested:

1. **0-10s** - "How far can one NIM travel?"
2. **10-25s** - live world relay and real metrics
3. **25-45s** - receive baton + ghost + skill challenge
4. **45-65s** - choose runner + one Nimiq Pay approval
5. **65-80s** - transaction confirms, baton launches
6. **80-95s** - Quick/Crew retention loop
7. **95-110s** - proof page: tx + server replay
8. **110-120s** - real users/handovers + final line

## 50.2 Winning screenshot

The primary screenshot should show:

- premium live world route
- glowing baton
- real handoff count
- real wallet count
- real country count with truthful labeling
- active relay
- clear CTA

It must communicate the product without architecture explanation.

---

# 51. Build Phases

Claude executes all phases automatically.

## Phase 0 - Source-of-truth verification

Objective:

- verify current competition rules/scoring
- verify current Nimiq Mini App SDK methods
- verify device identifier behavior
- verify deep links
- verify Nimiq Web Client/RPC transaction lookup
- verify TestAlbatross/MainAlbatross
- verify Cloudflare Workers static assets
- verify Durable Object Hibernation/alarms
- verify current Supabase path
- inspect existing repo if any
- inspect current Nimiq ecosystem issues for upstream opportunity

Deliver:

```text
docs/PHASE_0_VERIFICATION.md
DECISIONS.md
run-state.json
```

Hard gate:

No implementation should depend on an unverified API assumption.

## Phase 1 - Repository and infrastructure foundation

Build:

- monorepo
- TypeScript strict
- lint
- test runner
- Vite app
- Worker
- Hono
- Durable Object
- R2 binding
- Supabase migrations
- local same-origin proxy
- environment schemas
- basic CI
- docs skeleton

Gate:

- local build
- Worker preview
- database migration
- WebSocket hello/reconnect
- mobile app shell

## Phase 2 - Nimiq bridge and session

Build:

- SDK initialization
- device consent
- account selection
- login challenge
- Nimiq signature verification
- session cookie
- returning silent session
- logout/switch
- browser-outside-Nimiq state
- provider error handling
- TestAlbatross send-with-data spike
- backend transaction lookup spike

Gate:

- real Nimiq Pay device evidence

## Phase 3 - Baton Physics

Build:

- deterministic engine
- fixed-step simulation
- challenge variants
- input recorder
- replay
- Worker verifier
- PixiJS renderer
- practice
- performance settings
- ghost rendering

Gate:

- 10,000 deterministic parity scenarios
- no client-score authority
- mobile 60 FPS target evidence

## Phase 4 - Relay protocol

Build:

- relay schema
- RelayRoom Durable Object
- state machine
- runner claim
- invite
- intent
- tx-data codec
- pass attempt
- chain verifier
- idempotency
- IndexedDB recovery
- alarms
- reroute
- stranded

Gate:

- end-to-end TestAlbatross handoff
- concurrency tests
- failure-path tests

## Phase 5 - Flagship Global and Quick Relay

Build complete product surfaces and live state.

Gate:

- Global multiple handoff chain
- Quick best-of-5 flow
- ghost battle
- rematch
- Chronicle

## Phase 6 - Crew, Rival, Daily, Creator

Build full retention network.

Gate:

- each mode end-to-end
- no gambling mechanics
- creator rules enforced server-side

## Phase 7 - Inbox, season, achievements, rankings, rescue

Build retention surfaces and social progression.

Gate:

- incoming turn generates correct inbox item
- streak/rank/achievement calculations deterministic
- rescue labels technically honest

## Phase 8 - Premium UI polish

Use design authority.

Build:

- final visuals
- motion
- sound/haptic feature detection
- accessibility
- responsive layouts
- performance optimization
- share cards
- OG pages
- QR

Gate:

- 320/360/390/430 mobile
- Nimiq Pay physical phone
- reduced motion
- no layout overflow

## Phase 9 - Security, privacy, load, clean-room

Run:

- threat model
- dependency audit
- abuse tests
- load
- replay corpus
- tx verifier negatives
- fresh clone
- fresh database
- fresh local setup
- Worker preview
- staging

Gate:

- all release checks green

## Phase 10 - MainAlbatross production

Deploy production.

Run:

- real NIM flagship smoke relay
- public proof
- share/deep link
- Nimiq Pay mobile
- deployment verification

Do not fake adoption.

## Phase 11 - Early access and evidence

Collect real usage.

Fix:

- onboarding friction
- crash/errors
- relay abandonment UX
- invite conversion
- performance

Keep actual metrics synchronized.

## Phase 12 - Submission release

Freeze:

- README
- proof
- claims
- screenshots
- video assets
- description
- URLs
- repo topics
- license
- final security/evidence review

Set:

```text
HACKATHON RELEASE READY - HUMAN VIDEO/SUBMISSION ONLY
```

---

# 52. Required Commands

Exact scripts may vary, but root must expose equivalents:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:game
pnpm test:worker
pnpm test:e2e
pnpm test:security
pnpm test:replay
pnpm benchmark
pnpm build
pnpm preview:worker
pnpm verify:deployment
pnpm verify:testnet
pnpm verify:mainnet
pnpm clean-room
```

No hidden manual step should be required to prove a core claim.

---

# 53. Acceptance Gates

The agent cannot call the build complete unless each is `PASS`.

## Product

- [ ] product understood in 10 seconds
- [ ] onboarding under 60 seconds
- [ ] returning user avoids repeated wallet login prompts
- [ ] Global works
- [ ] Quick works
- [ ] Crew works
- [ ] Rival works
- [ ] Daily works
- [ ] Creator works
- [ ] Inbox works
- [ ] Ghost works
- [ ] Chronicle works
- [ ] season/rank works

## Nimiq

- [ ] `@nimiq/mini-app-sdk` current version verified
- [ ] device ID current behavior verified
- [ ] account access tested
- [ ] message signing tested
- [ ] real send-with-data tested
- [ ] backend independent tx verification tested
- [ ] TestAlbatross proof
- [ ] MainAlbatross proof
- [ ] no production private key in backend

## Game

- [ ] deterministic engine
- [ ] server replay
- [ ] client fake score rejected
- [ ] replay artifacts
- [ ] ghost deterministic
- [ ] performance evidence
- [ ] practice mode

## Protocol

- [ ] one canonical holder
- [ ] one sendable intent per leg
- [ ] concurrent claim safe
- [ ] duplicate tx safe
- [ ] wrong sender rejected
- [ ] wrong recipient rejected
- [ ] wrong amount rejected
- [ ] wrong data rejected
- [ ] tx interruption recovery
- [ ] reroute safe
- [ ] stranded honest

## Infrastructure

- [ ] Worker live
- [ ] Durable Objects live
- [ ] Hibernation WebSockets
- [ ] Supabase migrations fresh
- [ ] R2 artifacts
- [ ] Cron/alarms
- [ ] one production origin
- [ ] deep links
- [ ] HTTPS
- [ ] proof page

## Security

- [ ] no secrets in repo/history
- [ ] CSP
- [ ] auth replay rejected
- [ ] CSRF
- [ ] input validation
- [ ] WebSocket auth
- [ ] no raw device ID
- [ ] no app-level raw IP persistence
- [ ] privacy delete/export
- [ ] dependency audit

## Evidence

- [ ] phase summaries
- [ ] raw replay proof
- [ ] raw handoff proof
- [ ] controlled vs real metrics separated
- [ ] negative evidence
- [ ] benchmarks
- [ ] clean-room
- [ ] current screenshots
- [ ] current deployment metadata

## Submission

- [ ] MIT
- [ ] public repo
- [ ] live demo
- [ ] final 250-word max description
- [ ] polished visual assets
- [ ] demo script
- [ ] no stale copy
- [ ] no broken link
- [ ] all claims verified/target/limitation labeled internally

---

# 54. Hard Product Invariants

These are non-negotiable unless current official Nimiq capability proves one impossible.

1. A qualified baton handoff is a real NIM transaction.
2. No server can move a user's NIM.
3. No fake transaction advances canonical relay state.
4. No client-reported score advances canonical competitive state.
5. The server independently replays the game.
6. The server independently verifies the Nimiq transaction.
7. Only one current holder exists per relay.
8. Only one leg finalizes for one transaction.
9. No self-pass qualifies.
10. NIM amounts use integer Luna.
11. Quick/Rival outcomes do not transfer prize money.
12. No random monetary outcome exists.
13. Returning app sessions do not repeatedly request wallet login.
14. Every real transfer still uses native Nimiq Pay confirmation.
15. A current holder can strand a baton. The server cannot fake recovery.
16. A descendant revival is labeled as a new lineage.
17. Location is never described as blockchain-verified.
18. Device identifier is never described as user identity.
19. Raw device ID is not persisted.
20. Production backend has no user private keys.
21. Mainnet user metrics contain real users only.
22. Test wallets are labeled controlled.
23. Public app state never displays fabricated activity.
24. All social/season rewards are non-custodial offchain progression unless a future explicitly reviewed feature changes this.
25. Nimiq remains load-bearing even if every leaderboard and cosmetic layer is removed.

---

# 55. Known Limitations to Document

Do not hide these.

## 55.1 Fungibility

NIM Relay proves a continuous amount/transaction lineage, not atomic identity of one unique coin unit.

## 55.2 Holder trust

Native NIM basic transfers do not give NIM Relay custody or clawback authority.

A current holder can refuse to continue.

## 55.3 Location

Country is approximate network metadata where consented.

City is profile metadata if enabled.

Neither is blockchain proof.

## 55.4 Device ID

One device can serve multiple humans.

One human can use multiple devices.

It is an abuse signal, not identity proof.

## 55.5 Push notifications

Closed-app push depends on what the Nimiq Pay WebView currently supports.

The guaranteed retention surfaces are Inbox and external share/deep links.

---

# 56. Official Sources to Recheck Before Build Lock

Claude must re-open current official documentation at Phase 0.

Competition:

- https://miniappscompetition.com/rules
- https://miniappscompetition.com/scoring
- https://miniappscompetition.com/faq

Nimiq Mini Apps:

- https://nimiq.dev/mini-apps/
- https://nimiq.dev/mini-apps/faq
- https://nimiq.dev/mini-apps/api-reference/
- https://nimiq.dev/mini-apps/api-reference/nimiq-provider
- https://nimiq.dev/mini-apps/features/device-identifier

Nimiq Web Client:

- https://nimiq.dev/web-client/
- https://nimiq.dev/web-client/getting-started
- https://nimiq.dev/web-client/guides/query-the-blockchain
- https://nimiq.dev/web-client/guides/send-transactions

Cloudflare:

- https://developers.cloudflare.com/workers/
- https://developers.cloudflare.com/durable-objects/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/durable-objects/api/alarms/

Supabase:

- https://supabase.com/docs

Do not infer undocumented behavior from this PRD when official APIs have changed.

---

# 57. Final Claude Instruction

Build NIM Relay as a finished, public, production-quality Nimiq Pay Mini App.

Do not give me a plan and wait.

Do not stop after generating the frontend.

Do not stop after implementing a game.

Do not stop after implementing Nimiq integration.

Do not stop after unit tests.

Implement the complete lifecycle:

```text
premium onboarding
→ persistent player session
→ deterministic skill game
→ server replay
→ social relay
→ runner claim
→ one real NIM handoff
→ independent chain verification
→ canonical holder update
→ ghost propagation
→ inbox/retention
→ multiple relay modes
→ season/rank
→ live world view
→ public Chronicle
→ proof surface
→ security
→ testing
→ clean-room
→ Cloudflare production deployment
→ MainAlbatross proof
→ submission-ready repository
```

Use the supplied NIM Relay visual references as the quality bar.

The final product must feel like a premium game that happens to have Nimiq at its core, not like a crypto demo with a game layer.

The load-bearing sentence is:

> **Real NIM is the turn.**

The user-facing sentence is:

> **How far can one NIM travel?**

The retention sentence is:

> **Your reason to come back is usually another person.**

The release state is:

> **HACKATHON RELEASE READY - HUMAN VIDEO/SUBMISSION ONLY**

Do not claim this state until every acceptance gate above has passed.
