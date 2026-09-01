# NIM Relay

**How far can one NIM travel?**

Real NIM is the turn. Catch it, beat the ghost, pass it on.

> Build status: **Phase 1 in progress** (Phase 0 verification complete). Not yet live — this README will carry real `[Open Mini App]` / `[Watch Live]` / `[Proof]` links and real proof metrics once a production deployment exists (Phase 10-12). See `run-state.json` for exact current phase.

## What this is

NIM Relay is a Nimiq Pay Mini App: an asynchronous social skill game where a real NIM transfer *is* the turn. A player receives custody of a shared baton through a real Nimiq transaction, plays a short deterministic skill challenge (independently replayed and scored server-side, never trusted from the client), then passes the baton to the next runner with one real Nimiq Pay approval. The chain proves the handoff; the server proves the game run; the social layer is the reason to come back.

Full product/engineering specification: [`NIM_RELAY_PRD_v1.md`](./NIM_RELAY_PRD_v1.md).

## Four authorities

```text
Nimiq chain        → money/handoff truth
Game verifier      → skill truth
Durable Object     → live coordination truth
Supabase           → durable social/product history
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full architecture and [`DECISIONS.md`](./DECISIONS.md) for why the backend verifies Nimiq transactions via plain JSON-RPC rather than the official WASM Web Client (verified empirically, not assumed).

## Repository map

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design, the four authorities, repo layout
- [`SECURITY.md`](./SECURITY.md) — threat model and mitigations
- [`PRIVACY.md`](./PRIVACY.md) — exact data collection/disclosure contract
- [`SETUP.md`](./SETUP.md) — fresh clone to local development
- [`DECISIONS.md`](./DECISIONS.md) — architectural decisions and rejected alternatives
- [`CLAIMS.md`](./CLAIMS.md) — every public claim, labeled VERIFIED / TARGET / LIMITATION / NOT_CLAIMED
- [`TASKS.md`](./TASKS.md) / [`run-state.json`](./run-state.json) — live build progress
- [`docs/PHASE_0_VERIFICATION.md`](./docs/PHASE_0_VERIFICATION.md) — API verification evidence
- [`evidence/`](./evidence/) — raw proof backing every claim in this README

## License

MIT — see [`LICENSE`](./LICENSE).
