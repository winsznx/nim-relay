# Tasks

Live phase tracker. See `run-state.json` for the machine-readable version and `docs/phases/` for per-phase summaries once each phase closes.

- [x] Phase 0 — Source-of-truth verification (`docs/PHASE_0_VERIFICATION.md`)
- [x] Phase 1 — Repository and infrastructure foundation (all 5 gate items pass; migrations applied to the live Supabase project 2026-09-03)
- [~] Phase 2 — Nimiq bridge and session (auth end-to-end on a real phone; `SupabaseAuthStore` live. Remaining: NQ-address binding, deep-link test. See `docs/phases/PHASE_2_SUMMARY.md`)
- [~] Phase 3 — Baton Physics deterministic engine (engine `1.0.0` + all 5 challenges + playable `/play` client, delegated build reviewed and merged 2026-09-06; 200-case corpus verified across Node/workerd/Chromium/WebKit. Remaining: human playtest + tuning, iOS WebView fps. See `docs/phases/PHASE_3_SUMMARY.md`)
- [x] Phase 3.6 — Relay Run V2 slice: FAILED human playability gate 2026-09-06, frozen at experimental/relay-run-v2. Redesign: docs/RELAY_GAME_V3.md (awaiting approval before the V3 slice)
- [~] Phase 4 — Relay protocol (**PAUSED 2026-09-06** for the game redesign. Slice 1 committed + preserved: `/api/runs` server-issued challenges + server-verified replay + `game_runs`. Resumes after the V2 gameplay gate, targeting the relay-run composite. `evidence/testnet/phase4-runs.md`)
- [!] **Game redesign (iteration 3)** — 5 gauge challenges failed, V2 composite failed the human playability gate. `docs/GAMEPLAY_BENCHMARK_AUDIT.md` + `docs/RELAY_GAME_V2.md` (frozen) + **`docs/RELAY_GAME_V3.md`** (Relay Courier race; awaiting approval). **Top blocker.**
- [ ] Phase 5 — Flagship Global and Quick Relay (**BLOCKED** until the RELAY_GAME_V3 human quality gate passes)
- [ ] Phase 6 — Crew, Rival, Daily, Creator Relay
- [ ] Phase 7 — Inbox, season, achievements, rankings, rescue
- [ ] Phase 8 — Premium UI polish
- [ ] Phase 9 — Security, privacy, load, clean-room
- [ ] Phase 10 — MainAlbatross production deployment
- [ ] Phase 11 — Early access and evidence collection
- [ ] Phase 12 — Submission release freeze
