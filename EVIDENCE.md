# Evidence Index

Index into `evidence/`. Updated every phase.

```text
evidence/
  local/          Phase 0-9 local spikes and dev-mode proof (e.g. workerd runtime spikes)
  testnet/        TestAlbatross controlled-wallet campaign evidence (Phase 4, 9)
  mainnet/        MainAlbatross production evidence (Phase 10-11) — real users only, never fabricated
  replays/        Game replay artifacts referenced from game_runs
  handoffs/        Handoff/transaction verification evidence
  load/           Load-test results (Phase 9)
  performance/    Benchmark raw data backing BENCHMARKS.md
  security/       Dependency audit, security test results (Phase 9)
  clean-room/     Fresh-clone/build/reproduction logs (Phase 9)
  screenshots/    Current, dated product screenshots
  submission/     Final packaged submission assets (Phase 12)
```

## Phase 0 evidence
- `evidence/local/phase0-nimiq-core-workerd-spike.log` — raw wrangler dev output for the `@nimiq/core`-in-`workerd` spike (fails to instantiate WASM)
- `evidence/local/phase0-nimiq-core-workerd-spike-result.json` — structured result of the same spike
- `evidence/dependencies.json` — pinned dependency versions as verified at Phase 0

All real-vs-controlled evidence is labeled at the point of collection; `evidence/mainnet/` never mixes controlled test wallets with real user activity (PRD §35.1, §54 items 21-22).
