# Security

Threat model and mitigations, organized per PRD §32. Updated every phase as controls land; a control listed here as "planned" is not yet implemented — check `run-state.json` for current phase status before relying on this document as a completeness claim.

## Wallet threats
Malicious recipient substitution, stale recipient, wrong amount/network, repeated-prompt abuse, tx replay, compromised session, wallet account change.
**Mitigation (planned, Phase 2/4):** server-signed handoff intent created before the wallet prompt opens; recipient/amount/network locked to that intent; independent chain verification (see `DECISIONS.md` D-001) required before any handoff is canonical; no backend signing authority ever exists.

## Handoff threats
Duplicate tx hash, stale/superseded intent, self-pass, concurrent runner claims, double finalization, reroute-vs-payment race, browser closing mid-flow.
**Mitigation (planned, Phase 4):** Durable Object serialization of claims per relay, database-level uniqueness on `(relay_id, leg_number, tx_hash)`, explicit intent state machine, IndexedDB-based client-side tx-hash recovery, server reconciliation sweep.

## Auth threats
Nonce replay, forged signature, stolen session, raw device-ID leak, wallet/account mismatch.
**Mitigation (planned, Phase 2):** single-use expiring login nonce, origin-bound signed message, Ed25519 verification against the address-derivation of the signing public key (see `DECISIONS.md` D-002 for the empirical verification approach), HttpOnly/Secure same-origin session cookie, session rotation on relink, HMAC-peppered device-hash storage (raw device identifier never persisted — see `PRIVACY.md`).

## Game threats (anti-cheat)
Fake score, edited seed/difficulty, replayed foreign run, impossible input rate, engine tampering, unplayed "success" claims.
**Mitigation (planned, Phase 3):** server-issued signed run config (HMAC), deterministic Worker-side replay of the submitted input trace, engine-version binding, timestamp/order/rate validation, artifact hashing, duplicate detection. Client-reported scores are never trusted, structurally — the score field a client submits is not read for anything competitive.

## Web threats
XSS, CSRF, injection, open redirect, malicious invite token, upload abuse, WebSocket auth bypass, CSP drift.
**Mitigation (planned, Phase 1/9):** strict CSP, Zod schema validation on every API boundary, same-origin session cookies, CSRF protection on cookie-authenticated writes, allowlisted redirect targets, MIME/size-validated uploads, explicit WebSocket auth/authorization on connect.

## Database threats
Service-role leak, mass assignment, missing row-ownership checks, inconsistent relay state.
**Mitigation:** Supabase service-role key is a Worker-only secret (`wrangler secret put`), never a `VITE_*` variable, never sent to the browser. The frontend never talks to Supabase directly — all writes go through Worker-validated API routes.

## Privacy threats
See `PRIVACY.md` for the full data table. Summary: no raw IP persisted by application code, no raw Nimiq device identifier persisted (HMAC-SHA256 with a server pepper before storage), no unnecessary retention of wallet signatures, location claims never described as blockchain-verified.

## Status

This file will carry a per-phase "Security findings" append as Phase 2 (auth), Phase 4 (handoff protocol), and Phase 9 (dedicated security/load/clean-room pass) land. No secrets are committed to this repository or its git history at any point — verified by pre-commit review of every diff, not just intention.
