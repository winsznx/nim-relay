# Privacy

NIM Relay's data-collection contract, matching the table required by PRD §33. This is the same table shown in-app at `/privacy`.

| Information | Stored? | Public? | Notes |
|---|---:|---:|---|
| Nimiq wallet address | Yes, after wallet link | Partly | Chain addresses are inherently public; UI truncates by default |
| Raw wallet private key | No | No | Never available to the app — Nimiq Pay holds it |
| Login signature | Not retained long-term | No | Verified once; only proof metadata/hash retained if needed |
| Raw Nimiq device identifier | No | No | HMAC-SHA256 with a server-only pepper before any storage |
| Derived device hash | Yes | No | Abuse/session signal only, never identity |
| Relay Grant record | Yes, when a grant is claimed | Partly | Milestone, amount, recipient wallet, treasury transfer (public on chain), device hash for per-device limits. The public summary holds totals only |
| Grant abuse log | Yes, last 100 entries | No, operators only | Refusal reason with the first 12 hex characters of a salted SHA-256 of the wallet and device hash; never the address, the device hash or the raw identifier |
| Raw IP | No, by application code | No | Cloudflare's edge may process network traffic transiently; the application database never persists it |
| Network country code | Opt-in | Aggregate/public | Approximate, `network_observed` source, VPN/proxy-sensitive, user can opt out (handoff still qualifies, shown as "Unknown region") |
| Relay Atlas stations and routes | Not personal | Public | Game-world destinations a baton's legs raced between. Never a runner's physical or network location, and never derived from one |
| Profile city | Optional | User-controlled | Self-selected, explicitly never presented as verified |
| Game input replay | Yes | Selectively public | Contains game inputs only — no device ID, IP, wallet signature, or session token |
| Score | Yes | Yes, where leaderboard is public | Always server-derived, never client-trusted |
| NIM transaction | Onchain | Yes | Public blockchain data by nature |
| Session token | Hashed/opaque | No | HttpOnly cookie |
| Email/phone | No | No | Not collected — not required for the product |
| Guided tour progress | Yes, on the device; per runner when signed in | No | Started, completed or skipped per tour version, so another device doesn't offer a tour again |
| Guided tour events | Daily aggregate counts only | No | Tour, step and the first path segment of the entry page; per-runner or per-device caps reset daily and no wallet, device identifier or IP is sent |

## Relay Grants and the device signal
Relay Grants (docs/grants.md) are capped NIM transfers from NIM Relay's treasury wallet. A claim needs a device signal: Nimiq Pay's device identifier, shared with the runner's approval at sign-in or when claiming, and stored only as HMAC-SHA256 with the server-only `DEVICE_HASH_SECRET`. Every grant is charged against both the wallet and that device hash, so changing either one alone does not reset the 5 NIM cap. The treasury private key is a Worker secret only; it never reaches the database, logs, Supabase or the client.

## User controls (target: implemented by Phase 7-8)
- Export offchain profile data
- Delete offchain profile
- Opt out of country display (handoff still qualifies; region marked "Unknown region")
- Block another player
- Report a handle/content

Onchain transactions cannot be deleted — this is disclosed explicitly, not hidden behind general privacy language.

## Status
This document describes the data contract the product is built to. Section-by-section implementation status is tracked in `run-state.json` per phase; this file is not itself a completeness claim ahead of the phases that implement each control.
