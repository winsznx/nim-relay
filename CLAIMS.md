# Claim Ledger

Every public-facing claim NIM Relay makes, with a status and a pointer to the code or evidence file that backs it.

- `VERIFIED` — checked against the running system or the source, with evidence in `evidence/`
- `TARGET` — a goal, not asserted as current fact
- `LIMITATION` — an explicit boundary the product will not claim past
- `NOT_CLAIMED` — something deliberately not asserted, called out to prevent implicit overclaiming

## Grant/treasury payouts are never counted as handoffs

This is load-bearing for every metric below, so it gets stated once, plainly, with citations:

**A treasury-funded starter grant never produces a handoff record.** `createStarterBaton` (`apps/worker/src/station/network/grants/starter-baton.ts`) creates a brand-new baton directly — it does not call the handoff path at all. Its own comment states this outcome exactly:

> "The grant is recorded on the baton only; it adds no handoff, so no handoff count, transacting wallet, relay metric, Atlas statistic, ghost, crew or rivalry sees it."

Every network metric (`apps/worker/src/station/network/metrics.ts`) is computed from `state.handoffs.filter(handoff => handoff.qualified)` — it reads the handoffs array, filtered to `qualified` entries, for handoff counts, the transacting-wallet set, and the controlled-evidence figures. Since a grant-created baton never appends to `state.handoffs`, no grant, of any milestone, at any point, shows up as a handoff, a transacting wallet, an Atlas statistic, a ghost, a crew credit, or a rivalry event. This was confirmed by reading both files directly, not inferred.

## Ledger

| Claim | Status | Notes |
|---|---|---|
| "Every handoff is a real Nimiq transaction" | VERIFIED | `confirmHandoff` only marks a handoff canonical after `verifyHandoffTransaction` (`packages/relay-protocol/src/verify-transaction.ts`) independently confirms the on-chain transaction's recipient, value, network, commitment and execution result against the intent issued before the wallet prompt. See `SECURITY.md` § Wallet and handoff threats. |
| "Nimiq-account login is signature-verified" | VERIFIED | `verifyNimiqSignedMessage` (`packages/relay-protocol/src/nimiq-verify.ts`) is cross-checked against a golden vector generated with the real `@nimiq/core@2.21.0` library, not just derived from reading Rust source. See `evidence/testnet/phase2-nimiq-signature-vector.md`. |
| "Server-verified skill / scores" | VERIFIED | `POST /api/runs/submit` (`apps/worker/src/runs/routes.ts`) derives the canonical score by replaying the client's submitted input trace with the same deterministic game engine server-side; the client-reported score is never trusted for qualification, leaderboards or XP. See `evidence/testnet/phase4-runs.md`. |
| "Handoffs are never counted twice, and grants aren't counted as handoffs" | VERIFIED | See the grant/handoff section above. |
| Test suite passes at the current production commit | VERIFIED | `evidence/production/rebuild-2026-09-17.md`: typecheck, lint and build pass; 904 game-engine tests (including a 200-leg golden corpus reproduced byte-identical under workerd), 178 Worker tests, 44 relay-protocol tests, 5 shared tests, 212 web unit tests, and 17+ browser/E2E specs, all logged as passing for commit `5444734`. |
| Production and testnet are live deployments | VERIFIED | `evidence/production/rebuild-2026-09-17.md` records both Worker URLs and versions, plus a post-deploy `/api/health` check on both. |
| "How far can one NIM travel?" | NOT_CLAIMED (as literal fact) | Consumer framing for a fixed 1-NIM relay value passed across an ordered lineage of real Nimiq transactions. NIM is fungible; no unique coin-unit identity is tracked or claimed. |
| "Same NIM" | NOT_CLAIMED | Never asserted. NIM is fungible; the product tracks a value passed hand-to-hand, not a traceable coin. |
| "X wallets" / "X users" | NOT_CLAIMED | No public copy currently states a wallet or user count. If one is published later, it must split linked / transacting / controlled-test wallets, and must never call a distinct wallet a distinct human (see `SECURITY.md` on Sybil resistance — there is none beyond a device-hash signal). |
| "X countries" | NOT_CLAIMED | No public copy currently states a country count. `evidence/production/network-release.md` confirms routes use only consented, coarse network-observed countries, with unknown countries left unknown — but no count is published or verified here. |
| "No repeated wallet prompts" | VERIFIED for returning sessions | Session cookies (`apps/worker/src/auth/session.ts`) persist login for up to 30 days; a real Nimiq wallet approval is still required for every actual NIM transfer — the session removes repeated *app-login* prompts, not transfer approvals. |
| "Rescue" (recovering NIM from a holder who won't pass it on) | LIMITATION | The Worker holds no key that can move NIM out of a current holder's wallet. Handoff recovery (`apps/worker/src/station/network/handoff-recovery.ts`) can recover a lost transaction hash for an intent the holder already signed; it cannot compel or substitute a signature the holder never gave. |
| "Relay Grants are Sybil-resistant" | NOT_CLAIMED | See `SECURITY.md` § Grants and treasury. Eligibility checks a player's own relay history, not identity uniqueness; a new Nimiq keypair plus a fresh session can re-qualify for the starter grant. Damage is bounded by hard caps (per-transaction, per-participant, daily, global) and a kill switch, not by identity verification. |
| Supabase service-role key never reaches the browser | VERIFIED | `SUPABASE_SERVICE_ROLE_KEY` is read only in `apps/worker/src/env.ts`'s `Env` interface (Worker-bound), never a `VITE_*` variable; the frontend has no direct Supabase client. Checked by reading `apps/worker/src/env.ts` and the auth store. |
| Security review / penetration test performed | NOT_CLAIMED | No third-party audit or dedicated pen test has been run. Security-relevant behaviour is covered by the normal Worker test suites rather than a dedicated security pass. |

## Status

This ledger reflects the codebase and evidence on `production-relay` as of 2026-09-18. It is updated when a claim's backing code or evidence changes, not on a fixed schedule. No claim above is published to users unless it appears here as `VERIFIED`.
