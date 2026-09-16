# Relay network release — 2026-09-13

## Implemented

- Network-separated persistent batons with origin, holder, sequential transaction lineage, immutable recipient/value/data intents, pending reconciliation and incoming notifications.
- Interactive Natural Earth globe. Routes use only consented coarse network countries; unknown countries remain unknown. Full canonical route available for each baton.
- Best-of-three/five alternating friend matches, rematches, crew qualification/streak accounting, independent rival batons, one official Daily issuance per wallet/day, practice, and inbox.
- Canonical ghost continuation and historic trace playback. Practice cannot earn official profile records or XP.
- Native handoff recovery in IndexedDB. Explicit wallet declines can retry the same immutable intent. Ambiguous requests require checking wallet activity and recovering the transaction hash; they never automatically send again or change recipient.
- Hashed invitation tokens, public proof and shared journey routes, truthful usage metrics. Wallets are not claimed to be unique people.
- Additive Supabase migration 0005 applied successfully. Durable Object network values are segmented below the per-value storage limit.

## Verification

- 620 deterministic engine tests, 43 protocol tests, 3 shared tests, 53 Worker tests, 3 controller tests: 722 total.
- Type checking and lint clean. Production build and Wrangler deployment dry run pass.
- Mobile browser test: Earth loads, journey panel, complete practice ride, pause/resume, return to globe, public proof and invite deep links; no runtime errors.
- Live mainnet RPC decoding verified with public transaction `d95a3935cb527c0d37d0de3eef25fb154a82b50de87a02d2d6b9c3187e029f63`, block 61457379, network ID 24, executed, 16 confirmations at observation. This was an unrelated public transaction, **not** NIM Relay usage or a product handoff.
- Custody tests use controlled RPC fixtures and local test accounts. They demonstrate software invariants, not chain transfers or adoption.

## Remaining evidence gates

- Two real funded wallets must complete the native Nimiq Pay mainnet approval → independent confirmation → incoming ghost flow on actual devices.
- Device-specific native cancellation, insufficient-balance and background/resume behavior requires phone verification.
- Supabase network archive readback with a real handoff remains pending that first transaction.
- No claim of 50 real users, real promotion, or verified retention. Public metrics are computed from recorded activity.
- Desktop/phone performance measurements and the competition submission assets still need final verification.

Live mobile browser verification passed against the mainnet deployment (54 seconds), including a complete practice ride and public deep links. Mainnet health and public network metrics verified; counts were zero.

## Deployment checkpoint

- Mainnet: https://nim-relay.timjosh507.workers.dev — version `fd7ab912-492e-4249-a9ac-3a32df34484c`.
- Testnet: https://nim-relay-testnet.timjosh507.workers.dev — version `9de3c810-6204-46f1-97bb-dc5d72833eac`.
- Both asset uploads and scheduled triggers succeeded. Testnet has a separate Worker, Durable Objects, session secrets and network archive key; it shares the account store but not baton activity.
- User has funded test-NIM wallets and can perform native approvals. Testnet health confirms TestAlbatross. Real mainnet-funded wallet availability is not established.

Testnet lifecycle follow-up deployed successfully as `e8034d4a-b59c-40d2-a57c-6cd776b0428e`: stale invitations cannot reserve a baton after custody changes, and a pending rival transfer cannot reopen a completed competition. Latest browser run status: passed.

Mainnet lifecycle follow-up also deployed successfully: `31e2d5f3-a4bc-459a-8b27-6e6ef21eb3e1`. Both scheduled triggers confirmed. Testnet public snapshot remains empty before user testing.
