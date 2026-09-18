# Security

What NIM Relay actually defends against today, and what it doesn't. This describes the code on `production-relay` as of the September 2026 rebuild, not a plan.

Report a vulnerability by opening a private security advisory on GitHub, or contact the maintainer directly. Don't file exploit details in a public issue.

## Wallet and handoff threats

A handoff moves one baton's worth of NIM from the current holder to the next runner. The flow:

1. `prepareHandoff` (`apps/worker/src/station/network/handoff.ts`) locks the pass to one recipient, note and next-route before the wallet prompt ever opens. This produces a `HandoffIntent` with a commitment (`handoffCommitment`, HMAC'd with `RUN_CHALLENGE_SECRET`) that binds the batonId, leg number, sender, recipient, throw and route together. Preparing again for the same run/recipient/note/route returns the same open intent instead of creating a new one; anything that disagrees with the open intent is rejected (409).
2. The holder signs and broadcasts a real Nimiq transfer through native Nimiq Pay. The Worker never signs on the holder's behalf and holds no key that could move their NIM.
3. `confirmHandoff` looks the transaction up by hash via plain JSON-RPC and only accepts it after `verifyHandoffTransaction` (`packages/relay-protocol/src/verify-transaction.ts`) checks, independently of anything the client claims: sender, recipient, value, network, that sender and recipient differ (no self-pass), that the transaction's data field decodes to the exact commitment from step 1, that the transaction executed rather than reverted, and that it has at least `MIN_CONFIRMATIONS` confirmations. A handoff is never canonical on a client's say-so.

This defends against: recipient substitution, wrong amount, wrong network, replaying an old commitment against a new transaction, self-pass, and a client just lying about having sent something.

It does not defend against: a holder who decides not to pass at all, or a holder whose device is compromised at the OS/wallet level. The server can't move NIM out of a wallet it doesn't control — there is no rescue path, and none is claimed.

**Handoff recovery** (`apps/worker/src/station/network/handoff-recovery.ts`): if the wallet prompt is declined or the browser closes mid-flow, the client can retry the same immutable intent, or the app has to reconstruct what happened by checking wallet activity and recovering the transaction hash. It never re-sends with a different recipient or amount, and it never fabricates a second transfer.

## Auth threats

Login is Nimiq-account signature auth (`apps/worker/src/auth/`):

- `POST /api/auth/nonce` issues a single-use nonce with a 5-minute TTL (`nonce.ts`), consumed exactly once by `store.consumeNonce`.
- The client signs `"NIM Relay login\norigin: <APP_ORIGIN>\nnonce: <nonce>"` with its Nimiq account key. Origin-bound, so a signature captured for one deployment can't be replayed against another; nonce-bound, so it can't be replayed across login attempts on the same origin.
- `verifyNimiqSignedMessage` (`packages/relay-protocol/src/nimiq-verify.ts`) verifies the Ed25519 signature over `SHA-256(0x16 ++ "Nimiq Signed Message:\n" ++ len(message) ++ message)`, matching the Rust wallet implementation. This was independently cross-checked against a golden vector generated with the real `@nimiq/core` Node build (`evidence/testnet/phase2-nimiq-signature-vector.md`), not just derived from reading the Rust source.
- The wallet address is derived from the verified public key (`deriveNimiqAddress`, first 20 bytes of Blake2b-256), so the session is bound to a key that actually signed, not a client-asserted address.
- The session token is an HMAC (`SESSION_SECRET`) over `sessionId.playerId`, set as an `HttpOnly`, `Secure`, `SameSite=Lax` cookie with a 30-day max age (`apps/worker/src/auth/session.ts`). The database session row is the source of truth for revocation; the HMAC just lets the Worker check the token without a DB round-trip on every request.
- Nimiq Pay's device identifier is never persisted raw — only `HMAC-SHA256(DEVICE_HASH_SECRET, rawDeviceId)` is stored (`apps/worker/src/auth/device-hash.ts`), as an abuse/session signal, not an identity claim.

What this doesn't defend against: it authenticates a device holding a given Nimiq key, not a unique human. Anyone can generate as many Nimiq accounts as they want and log in as each one. There's no KYC, no proof-of-personhood, no CAPTCHA on `/api/auth/nonce` or `/api/auth/verify`. See "Grants and treasury" below for where that matters.

## Game / anti-cheat threats

`apps/worker/src/runs/routes.ts`: the Worker issues a signed challenge (`signChallenge`, HMAC over the canonical challenge fields with `RUN_CHALLENGE_SECRET`) before a run starts, covering engine version, seed, difficulty, duration and a rules hash. On submit, the Worker verifies the MAC, rejects a stale rules hash or an expired window, then deterministically replays the client's submitted input trace through the same game engine server-side (`replay()` from `@nim-relay/game-engine`) to derive the canonical score. The client-reported score is not read for anything that matters — qualification, leaderboards, XP and handoff eligibility all come from the server-derived `result`, not from what the client claims.

This defends against: a forged score, a tampered seed or difficulty, replaying someone else's run as your own (the challenge is single-issue, MAC'd, and tied to a `startBefore` window), and an engine-version mismatch silently changing the physics.

It does not defend against: input-level cheats that still produce a legal trace (e.g., a bot that plays the game correctly, just not with a human's timing) — nothing here does behavioral/rate analysis of the input trace beyond what the deterministic replay itself checks (trace well-formedness, decoded via `ReplayError`). There's no CAPTCHA or device-attestation layer on top of the replay.

There is no separate rate-limiting or WAF-style module in this codebase; whatever protection exists against abuse is the specific per-domain logic described in this document (nonce single-use, commitment binding, replay verification, grant caps), not a generic layer.

## Web threats

- Every API input is validated with Zod schemas at the route boundary (`z.object(...).safeParse`/`.parse`, used throughout `apps/worker/src/auth/routes.ts`, `apps/worker/src/runs/routes.ts`, `apps/worker/src/station/network/handoff.ts` and the grants desk) — malformed input is rejected with 400 before it reaches any business logic.
- Sessions are same-origin cookies (`SameSite=Lax`, `Secure`, `HttpOnly`); the login message itself is origin-bound, which is the actual CSRF-relevant control for the one state-changing unauthenticated endpoint (`/api/auth/verify`) — a signature produced for `APP_ORIGIN` can't be replayed against another origin.
- There is no `Content-Security-Policy` header set anywhere in this codebase today (checked across `apps/worker/src` and `apps/web`). The old pre-rebuild SECURITY.md described a CSP as planned; it was never built. This is a real gap: there's no defense-in-depth XSS mitigation at the HTTP-header level, only the standard React escaping the frontend framework gives for free.
- There's no dedicated rate-limiting middleware on any Worker route. Abuse resistance on the routes that need it comes from domain-specific limits instead — e.g. the grants desk's per-player daily claim-attempt counter (`countClaimAttempt` in `grants/ledger.ts`) and its treasury caps — not from a general request-rate limiter.
- Deep-link routes (`/r/*`, `/invite/*`, `/proof/*`) are served the plain app shell by the Worker (`apps/worker/src/index.ts`); there's no server-side redirect logic that takes an arbitrary target from user input, so there's nothing here for an open-redirect check to catch, by construction rather than by an explicit allowlist.

## Database threats

The Supabase `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`) is a Worker-only secret, set with `wrangler secret put`, never a `VITE_*` variable and never sent to the browser. The frontend never talks to Supabase directly; all reads and writes go through Worker routes that validate input first. This means the actual authorization boundary is "can this Zod-validated route be reached with a valid session", not Postgres row-level security — RLS is not the enforcement layer here, the Worker is. If Supabase RLS policies exist on the project, they are a defense-in-depth backstop behind that, not verified against in this document because the Worker's own code path is what actually gates access.

## Grants and treasury (Relay Grants)

Relay Grants is an opt-in treasury that pays small starter/milestone grants in real NIM. It's off by default (`TREASURY_ENABLED` unset or anything other than the literal string `"true"`) and requires a dedicated low-balance wallet's private key (`TREASURY_PRIVATE_KEY`, `apps/worker/src/env.ts`).

**Is it Sybil-resistant? No — say so plainly.** Eligibility (`apps/worker/src/station/network/grants/eligibility.ts`) checks a player's own relay history: sent a qualified handoff, completed distinct Atlas routes, has a return handoff on a later day, or has a crew/referral connection. None of that is a uniqueness check across humans. A player is just a Nimiq keypair plus a session; nothing stops someone from generating a new keypair, logging in fresh, and claiming the `starter` grant again from a different account. The only per-identity friction is a hashed device signal (`deviceHash`) used as one of two charge keys alongside wallet address (`ledger.ts`'s `walletChargeKey`/`deviceChargeKey`) — this raises the cost of farming from the same physical device slightly, but a different device (or a cleared one) resets it. Treat Relay Grants as an incentive with real-money exposure bounded by hard caps, not as a mechanism that verifies distinct people.

What actually bounds the damage a farmed or compromised flow can do, all in `apps/worker/src/station/network/grants/config.ts` and `ledger.ts`:

- **Hard ceilings no Worker variable can raise**: `PARTICIPANT_CEILING_LUNA` (5 NIM) and `TRANSACTION_CEILING_LUNA` (2 NIM) are compile-time constants. `TREASURY_TX_CAP_NIM`, `TREASURY_PARTICIPANT_CAP_NIM`, `TREASURY_DAILY_CAP_NIM` and `TREASURY_GLOBAL_CAP_NIM` can only lower these, never raise them — `capProblem()` fails the whole config closed (grants stay off) if a configured cap exceeds its ceiling, or if per-milestone amounts don't fit under the per-transaction and per-participant caps.
- **Per-player and per-day claim throttling**: `countClaimAttempt` caps how many claim attempts one player can make per UTC day.
- **Kill switch**: the grants desk exposes a `paused` flag (`ledger.paused`, set/cleared through a `pauseBody` endpoint) that immediately stops any further broadcast or rebroadcast of pending grants (`mayBroadcast = config.enabled && ledger.paused === null`), independent of `TREASURY_ENABLED`.
- **Idempotency**: a grant's id is deterministic — `grant:<milestone>:<playerId>` — so the same milestone can't be double-charged for the same player; `holdsReservation` and the wallet/device `ChargeRecord`s make a claim's caps-impact durable the moment it's created, before any chain confirmation.
- **Restart safety**: every grant is a durable record (`GrantRecord`) with an explicit state machine (`prepared` → `broadcast` → `confirmed`/`failed`) persisted in Durable Object storage inside the room's critical section, so a Worker restart or DO eviction mid-claim doesn't lose or double-spend a reservation — `lookUpGrant` (`grants/chain.ts`) re-derives the real chain outcome from the transaction hash rather than trusting in-memory state, and only re-broadcasts a still-open grant's already-signed bytes (the hash never changes) at most once per `REBROADCAST_INTERVAL_MS`.
- **Chain-verified confirmation, not trust**: `judgeTransaction` re-checks the found transaction's sender, recipient, value and network against exactly what the treasury signed before counting it confirmed. A transaction found under the right hash but with different terms is rejected as `CHAIN_MISMATCH`, and that state is never silently released back to the caps.
- **Treasury key handling**: `scripts/treasury/provision.ts` generates the key in memory and pipes it straight into `wrangler secret put` over stdin — never written to disk, logged, or passed as a CLI argument. It's read at request time only where a transfer is signed (`treasuryKey()` in `config.ts`), and thrown errors never include the key value.

**Grant payouts are structurally invisible to product metrics.** A starter grant creates a baton directly (`createStarterBaton` in `grants/starter-baton.ts`) without producing a handoff record — see `CLAIMS.md` for the exact mechanism and why this means grants never inflate the handoff count, Atlas stats, ghosts, crews or rivalries.

## Secrets

Deployed Workers get every secret via `wrangler secret put` (mainnet and testnet environments are separate). Local development reads `apps/worker/.dev.vars` (gitignored; see `apps/worker/.dev.vars.example` for the names, not the values). No secret value appears in this repository, its git history, `wrangler.jsonc`, or any evidence file.

Secret names in use (see `apps/worker/src/env.ts` for the authoritative list): `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `DEVICE_HASH_SECRET`, `RUN_CHALLENGE_SECRET`, `TREASURY_PRIVATE_KEY`. `SUPABASE_URL`, `NIMIQ_NETWORK`, `NIMIQ_RPC_URL`, `APP_ORIGIN`, `OPS_PLAYERS`, `TREASURY_ENABLED` and the `TREASURY_*_CAP_NIM`/`GRANT_*` tuning variables are configuration, not secrets, but are still set as Worker vars/secrets rather than committed.

## What this document is not

This is a description of the mitigations that exist in the code today, not an audit and not a guarantee. There has been no third-party penetration test, no formal audit, and no dedicated fuzzing pass. Treat everything above as "this is what the code does," not "this has been proven safe."
