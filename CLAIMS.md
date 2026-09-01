# Claim Ledger

Every public-facing claim NIM Relay makes, with a status. Per PRD §44.8 / §45:

- `VERIFIED` — independently checked against the running system, with evidence in `evidence/`
- `TARGET` — a goal, not yet true, always labeled as a target in public copy
- `LIMITATION` — an explicit boundary the product will not claim past
- `NOT_CLAIMED` — something the product deliberately does not assert, called out to prevent implicit overclaiming

| Claim | Status | Notes |
|---|---|---|
| "How far can one NIM travel?" | NOT_CLAIMED (as literal fact) | Consumer metaphor. Technical reality: a fixed 1 NIM relay value passed across an ordered lineage of real Nimiq transactions. NIM is fungible — no unique coin-unit identity is claimed. |
| "Every handoff is a real Nimiq transaction" | TARGET → VERIFIED once Phase 4/10 land | Will be `VERIFIED` only for qualified handoffs with independent chain verification (`DECISIONS.md` D-001); still `TARGET` at Phase 0/1. |
| "Server-verified skill" | TARGET → VERIFIED once Phase 3 lands | Will be `VERIFIED` only once canonical score is reproduced server-side from the submitted input trace. |
| "X wallets" | NOT_CLAIMED yet | Once populated, always split into linked / transacting / controlled-test — never conflated. |
| "X users" | NOT_CLAIMED yet | Will only ever count actual product accounts under a defined metric; distinct wallets are never called distinct humans. |
| "X countries" | NOT_CLAIMED yet | Defined metric when populated: distinct network-observed country codes among consenting qualified handoffs. |
| "Same NIM" | NOT_CLAIMED | Never asserted — NIM is fungible; no atomic coin identity exists or is claimed. |
| "No repeated wallet prompts" | TARGET → VERIFIED once Phase 2 lands | Allowed phrasing once true: "Returning sessions avoid repeated app-login wallet prompts. Every real NIM transfer still requires native Nimiq Pay approval." |
| "Rescue" | LIMITATION | The server can never move NIM out of an absent current holder's wallet — no rescue claim implies otherwise. See PRD §10.3, §45.9. |

## Status
This ledger is empty of `VERIFIED` product claims at Phase 0/1 because no product surface exists yet to verify against. It will be updated at the close of every phase that makes a claim true, and the public README/proof page will only ever assert what this ledger marks `VERIFIED`.
