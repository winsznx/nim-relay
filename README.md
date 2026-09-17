# NIM Relay

**How far can one NIM travel?**

Real NIM is the turn. Catch it, beat the ghost, pass it on.

[Open NIM Relay](https://nim-relay.timjosh507.workers.dev) · [Testnet for test NIM](https://nim-relay-testnet.timjosh507.workers.dev) · [Public proof](https://nim-relay.timjosh507.workers.dev/proof)

A living relay game where 1 real NIM travels hand to hand. The home is a 3D Earth showing each baton's journey. The holder carries the baton through a short high-speed leg against the verified ghost of the person who passed it to them, then throws it to the next runner and approves a real transfer in Nimiq Pay. Custody changes only after the Worker independently verifies that transaction on chain.

Around the leg: Quick best-of-3/5 matches, crews with daily streaks, two-baton rivalries, one Daily course for everyone, an inbox of turns, a 3D Relay Station, runner profiles with Nimiq identicons, achievements and share cards, Chronicles and a public proof page.

Status, 2026-09-17: the full two-runner lifecycle passes in a local end-to-end test with a mocked Nimiq Pay wallet and mock chain RPC against a real Worker. A real native handoff on physical phones has **not** been verified yet, on testnet or mainnet. Real-user adoption is not established; public metrics show only recorded activity, and testnet activity is excluded from mainnet usage.

## What this is

NIM Relay is a Nimiq Pay Mini App: an asynchronous social skill game where a real NIM transfer *is* the turn. A player receives custody of a shared baton through a real Nimiq transaction, races a short deterministic relay leg against the previous runner's verified ghost (independently replayed and scored server-side, never trusted from the client), then passes the baton to the next runner with one real Nimiq Pay approval. The chain proves the handoff; the server proves the game run; the social layer is the reason to come back.

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
