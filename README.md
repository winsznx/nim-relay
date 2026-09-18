# NIM Relay

**How far can one NIM travel?**

Real NIM is the turn. Catch it, beat the ghost, pass it on.

[Open NIM Relay](https://nimrelay.xyz) · [Testnet for test NIM](https://testnet.nimrelay.xyz) · [Public proof](https://nimrelay.xyz/proof)

A living relay game where 1 real NIM travels hand to hand. The home is a 3D Earth showing each baton's journey. The holder carries the baton through a short high-speed leg against the verified ghost of the person who passed it to them, then throws it to the next runner and approves a real transfer in Nimiq Pay. Custody changes only after the Worker independently verifies that transaction on chain.

Around the leg: Quick best-of-3/5 matches, crews with daily streaks, two-baton rivalries, one Daily course for everyone, an inbox of turns, a 3D Relay Station, runner profiles with Nimiq identicons, achievements and share cards, Chronicles and a public proof page.

Status, 2026-09-17: the full two-runner lifecycle passes in a local end-to-end test with a mocked Nimiq Pay wallet and mock chain RPC against a real Worker. A real native handoff on physical phones has **not** been verified yet, on testnet or mainnet. Real-user adoption is not established; public metrics show only recorded activity, and testnet activity is excluded from mainnet usage.

## What this is

NIM Relay is a Nimiq Pay Mini App: an asynchronous social skill game where a real NIM transfer *is* the turn. A player receives custody of a shared baton through a real Nimiq transaction, races a short deterministic relay leg against the previous runner's verified ghost (independently replayed and scored server-side, never trusted from the client), then passes the baton to the next runner with one real Nimiq Pay approval. The chain proves the handoff; the server proves the game run; the social layer is the reason to come back.

Original product/engineering specification (superseded by the shipped product, kept for historical record): [`docs/history/NIM_RELAY_PRD_v1.md`](./docs/history/NIM_RELAY_PRD_v1.md).

## The race engine

The leg runs on a deterministic 60 Hz simulation in `packages/game-engine`, shared verbatim between the browser and the Worker so a replay can never drift between them. `relay-leg` (v6) is the live engine: a lane-based road with real edges, world events, two forks and a pulse section. `relay-leg-v5` is frozen exactly as deployed on 2026-09-17 so previously verified v5 runs keep replaying; no new gameplay work touches it. See [`packages/game-engine/README.md`](./packages/game-engine/README.md).

## Relay Atlas

The globe is the Relay Atlas: a fixed set of Relay Stations and the routes between them. Stations are game-world destinations, never where a player is. Every route is a real relay-leg course, and after a qualified leg the holder picks where the baton goes next. Routes and stations light up only through qualified legs. See [`docs/atlas.md`](./docs/atlas.md).

## Relay Grants

A server-held treasury can fund a starter baton for a new runner whose wallet holds too little NIM to carry a relay, so nobody has to buy NIM before their first pass. Grants are capped, gated behind an explicit `TREASURY_ENABLED` flag, and never counted as a qualified handoff in any metric, Atlas statistic, ghost, crew or rivalry. See [`docs/grants.md`](./docs/grants.md).

## First run

A first-run product tour introduces the globe, the baton and the Atlas, and a short in-race micro-tutorial teaches the leg controls the first time someone actually races.

## Four authorities

```text
Nimiq chain        → money/handoff truth
Game verifier      → skill truth
Durable Object     → live coordination truth
Supabase           → durable social/product history
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full architecture and [`DECISIONS.md`](./DECISIONS.md) for why the backend verifies Nimiq transactions via plain JSON-RPC rather than the official WASM Web Client (verified empirically, not assumed).

## Repository map

Root docs, kept current against the running system:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design, the four authorities, repo layout
- [`SECURITY.md`](./SECURITY.md) — threat model, what's defended against and what isn't
- [`PRIVACY.md`](./PRIVACY.md) — exact data collection/disclosure contract
- [`SETUP.md`](./SETUP.md) — fresh clone to local development
- [`DECISIONS.md`](./DECISIONS.md) — append-only log of architectural decisions and why
- [`CLAIMS.md`](./CLAIMS.md) — every public claim, labeled VERIFIED / TARGET / LIMITATION / NOT_CLAIMED
- [`EVIDENCE.md`](./EVIDENCE.md) — index into `evidence/`, describing what's actually recorded there
- [`HANDOFF.md`](./HANDOFF.md) — narrative state for anyone picking this project up
- [`TASKS.md`](./TASKS.md) / [`run-state.json`](./run-state.json) — live build progress
- [`BENCHMARKS.md`](./BENCHMARKS.md), [`DESIGN.md`](./DESIGN.md), [`DEMO.md`](./DEMO.md), [`CONTRIBUTIONS.md`](./CONTRIBUTIONS.md) — performance targets, visual/design tokens, demo shot list, contribution flow

`docs/`:

- [`docs/atlas.md`](./docs/atlas.md) — Relay Atlas stations and routes
- [`docs/grants.md`](./docs/grants.md) — Relay Grants treasury, caps and eligibility
- [`docs/submission/submission.md`](./docs/submission/submission.md) — competition portal submission draft
- [`docs/history/`](./docs/history/) — superseded phase plans, the original PRD, and earlier game-design drafts, kept for the record, not current

`packages/*/README.md` — the game engine (`packages/game-engine/README.md`) and its two live source trees (`packages/game-engine/src/relay-leg/README.md` for v6, `packages/game-engine/src/relay-leg-v5/README.md` for the frozen v5) document the determinism contract directly next to the code.

[`evidence/`](./evidence/) — raw proof backing every claim in `CLAIMS.md`, indexed in `EVIDENCE.md`.

## License

MIT — see [`LICENSE`](./LICENSE).
