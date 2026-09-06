# Tasks

Live phase tracker. See `run-state.json` for the machine-readable version and `docs/phases/` for per-phase summaries once each phase closes.

- [x] Phase 0 — Source-of-truth verification (`docs/PHASE_0_VERIFICATION.md`)
- [x] Phase 1 — Repository and infrastructure foundation (all 5 gate items pass; migrations applied to the live Supabase project 2026-09-03)
- [~] Phase 2 — Nimiq bridge and session (auth end-to-end on a real phone; `SupabaseAuthStore` live. Remaining: NQ-address binding, deep-link test. See `docs/phases/PHASE_2_SUMMARY.md`)
- [~] Phase 3 — Baton Physics deterministic engine (engine `1.0.0` + all 5 challenges + playable `/play` client, delegated build reviewed and merged 2026-09-06; 200-case corpus verified across Node/workerd/Chromium/WebKit. Remaining: human playtest + tuning, iOS WebView fps. See `docs/phases/PHASE_3_SUMMARY.md`)
- [~] Phase 4 — Relay protocol (**PAUSED 2026-09-06** for the game redesign. Slice 1 committed + preserved: `/api/runs` server-issued challenges + server-verified replay + `game_runs`. Resumes after the V2 gameplay gate, targeting the relay-run composite. `evidence/testnet/phase4-runs.md`)
- [!] **Game redesign** — the 5 one-axis challenges are not competitive. `docs/GAMEPLAY_BENCHMARK_AUDIT.md` (NimJump + Nimiq Space) + `docs/RELAY_GAME_V2.md` (one cohesive Relay Run + 10-point Gameplay Quality Gate) written. **This is the top blocker.**
- [ ] Phase 5 — Flagship Global and Quick Relay (**BLOCKED** until the RELAY_GAME_V2 gate passes)
- [ ] Phase 6 — Crew, Rival, Daily, Creator Relay
- [ ] Phase 7 — Inbox, season, achievements, rankings, rescue
- [ ] Phase 8 — Premium UI polish
- [ ] Phase 9 — Security, privacy, load, clean-room
- [ ] Phase 10 — MainAlbatross production deployment
- [ ] Phase 11 — Early access and evidence collection
- [ ] Phase 12 — Submission release freeze
