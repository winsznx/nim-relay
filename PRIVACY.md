# Privacy

NIM Relay's data-collection contract, matching the table required by PRD §33. This is the same table shown in-app at `/privacy`.

| Information | Stored? | Public? | Notes |
|---|---:|---:|---|
| Nimiq wallet address | Yes, after wallet link | Partly | Chain addresses are inherently public; UI truncates by default |
| Raw wallet private key | No | No | Never available to the app — Nimiq Pay holds it |
| Login signature | Not retained long-term | No | Verified once; only proof metadata/hash retained if needed |
| Raw Nimiq device identifier | No | No | HMAC-SHA256 with a server-only pepper before any storage |
| Derived device hash | Yes | No | Abuse/session signal only, never identity |
| Raw IP | No, by application code | No | Cloudflare's edge may process network traffic transiently; the application database never persists it |
| Network country code | Opt-in | Aggregate/public | Approximate, `network_observed` source, VPN/proxy-sensitive, user can opt out (handoff still qualifies, shown as "Unknown region") |
| Profile city | Optional | User-controlled | Self-selected, explicitly never presented as verified |
| Game input replay | Yes | Selectively public | Contains game inputs only — no device ID, IP, wallet signature, or session token |
| Score | Yes | Yes, where leaderboard is public | Always server-derived, never client-trusted |
| NIM transaction | Onchain | Yes | Public blockchain data by nature |
| Session token | Hashed/opaque | No | HttpOnly cookie |
| Email/phone | No | No | Not collected — not required for the product |

## User controls (target: implemented by Phase 7-8)
- Export offchain profile data
- Delete offchain profile
- Opt out of country display (handoff still qualifies; region marked "Unknown region")
- Block another player
- Report a handle/content

Onchain transactions cannot be deleted — this is disclosed explicitly, not hidden behind general privacy language.

## Status
This document describes the data contract the product is built to. Section-by-section implementation status is tracked in `run-state.json` per phase; this file is not itself a completeness claim ahead of the phases that implement each control.
