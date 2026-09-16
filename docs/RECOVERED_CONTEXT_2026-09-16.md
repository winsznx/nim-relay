# Nim Relay recovered context — September 16, 2026

Recovered from archived chat **Build deterministic baton engine**, session
`01a07364-fdcc-7812-9d7e-e79a9d9e2f6c`, and checked against the current working
tree, README, and `evidence/production/network-release.md`. This is a continuation
brief, not a fresh test or deployment report. The full original transcript remains
at `/Users/mac/.codex/archived_sessions/rollout-2026-09-05T22-06-33-01a07364-fdcc-7812-9d7e-e79a9d9e2f6c.jsonl`.

## Current product direction

The latest September 13 brief supersedes the original solo-engine scope and
subsequent race-only scope. Build a social relay network: see a baton on Earth,
receive custody, race the previous verified ghost, choose the next runner,
approve a real 1 NIM transfer, independently verify it, and preserve its journey.
The 3D race is one leg of that product. Do not restart the architecture or return
to an isolated gameplay lab.

Preserve deterministic fixed-tick simulation, versioned replay, server-derived
scores, signed challenge issuance, independent chain verification, native wallet
approval, and truthful metrics. No fabricated users or activity, monetary prizes,
or claims that fungible NIM is a uniquely identifiable coin.

## Existing implementation

- Globe-first network client in `apps/web/src/network`; root and public journey
  routes load `NetworkApp` through `apps/web/src/app/App.tsx`.
- Station and race client in `apps/web/src/station`, with the station also available
  at `/station-v4`; deterministic v4 simulation in
  `packages/game-engine/src/station-race`. Five stylized world families: coast,
  alpine, metro, solar, ocean. Earlier engines remain available for old replays.
- Worker station/network implementation in `apps/worker/src/station`, shared
  models in `packages/shared/src/network.ts` and `station.ts`.
- Persistent batons, custody histories, verified ghosts, incoming turns,
  Quick best-of-three/five matches, crews and streak accounting, independent
  rival batons, Daily official attempts and practice, invites, public proof,
  journey sharing and historic replay playback are described in the release
  evidence and represented in the current implementation.
- Immutable transfer intents and IndexedDB recovery: explicit wallet rejection
  can retry the same intent; an ambiguous request needs transaction recovery,
  not an automatic second payment or a changed recipient.
- Migration `0005_relay_network.sql` is recorded as applied in release evidence.

## Last recorded validation and deployments

Release evidence records 722 passing tests: 620 engine, 43 protocol, 3 shared,
53 Worker, and 3 controller tests; clean typecheck/lint/build and mobile browser
practice/deep-link verification. These checks were not rerun during recovery.
Custody tests use controlled RPC fixtures; a separately decoded public mainnet
transaction was not a Nim Relay handoff.

- Mainnet: https://nim-relay.timjosh507.workers.dev
  Latest recorded deployment: `31e2d5f3-a4bc-459a-8b27-6e6ef21eb3e1`.
- Testnet: https://nim-relay-testnet.timjosh507.workers.dev
  Latest recorded deployment: `e8034d4a-b59c-40d2-a57c-6cd776b0428e`.
- Deployments share an account store but separate baton activity, Workers,
  Durable Objects, session secrets and network archive keys.
- URLs and deployment status above are historical records, not fresh uptime checks.

## Exact stopping point

The user confirmed multiple wallets funded with **test NIM**. A separate testnet
deployment was provided. Instructions were: open it inside Nimiq Pay on testnet
on both wallets; set up both couriers; on the first use World → Start a relay →
Quick, choose the second courier, finish the leg, and approve the 1 test NIM pass.
The recipient should receive custody and the previous runner's verified ghost.

The user's last response was “okay on it.” The chat ended asking for the journey
link, transaction hash, or exact error. No resulting wallet test outcome appears
in that chat. Mainnet funding was not established.

## Remaining work and evidence

1. Obtain the outcome of that two-wallet test; trace approval, chain confirmation,
   new holder, recipient inbox/ghost and Supabase archive readback.
2. Verify cancellation, insufficient funds and background/resume on actual phones.
3. Complete an actual mainnet handoff when appropriate wallets are available.
4. Measure target-phone performance and verify the broader product acceptance
   criteria; code presence does not establish production quality or completeness.
5. Finish truthful usage evidence and submission assets. The latest brief targets
   at least 50 legitimate wallets; no such adoption or retention is established.
6. Reconcile old status documents and unfinished checkboxes with current evidence.

## Working-tree cautions

Branch at recovery: `production-relay`; HEAD `e0e6cca` (V3 steering fix).
Substantial later station/network work is modified or untracked. Preserve it;
the committed HEAD alone does not represent the recovered product. No commit,
deployment, dependency change or product-code edit was made during recovery.

`HANDOFF.md`, `CLAIMS.md`, and large portions of `run-state.json` still describe
earlier phases. `task_plan.md` has unfinished checkboxes and a stale deployment
checkpoint. Prefer the latest brief, actual code, and
`evidence/production/network-release.md` when resolving these contradictions.

## Original briefs (local reference)

- Initial engine brief:
  `/Users/mac/.codex/attachments/d1783126-583f-4891-a408-8acb3ba3fe3f/pasted-text.txt`
- Production station/race brief:
  `/Users/mac/.codex/attachments/47ccbf9a-f347-4a93-8a08-32d804ded814/pasted-text.txt`
- Latest complete social network brief:
  `/Users/mac/.codex/attachments/195bc11c-f5b0-45e2-99ce-e018fcc860dd/pasted-text.txt`

The archive and briefs remain available for targeted lookup; this document does
not claim to import every historical tool event into the current chat UI.
