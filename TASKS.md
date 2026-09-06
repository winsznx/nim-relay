# Tasks

Live phase tracker. See `run-state.json` for the machine-readable version and `docs/phases/` for per-phase summaries once each phase closes.

- [x] Phase 0 — Source-of-truth verification (`docs/PHASE_0_VERIFICATION.md`)
- [x] Phase 1 — Repository and infrastructure foundation (all 5 gate items pass; migrations applied to the live Supabase project 2026-09-03)
- [~] Phase 2 — Nimiq bridge and session (auth end-to-end on a real phone; `SupabaseAuthStore` live. Remaining: NQ-address binding, deep-link test. See `docs/phases/PHASE_2_SUMMARY.md`)
- [~] Phase 3 — Baton Physics deterministic engine (engine `1.0.0` + all 5 challenges + playable `/play` client, delegated build reviewed and merged 2026-09-06; 200-case corpus verified across Node/workerd/Chromium/WebKit. Remaining: human playtest + tuning, iOS WebView fps. See `docs/phases/PHASE_3_SUMMARY.md`)
- [ ] Phase 4 — Relay protocol
- [ ] Phase 5 — Flagship Global and Quick Relay
- [ ] Phase 6 — Crew, Rival, Daily, Creator Relay
- [ ] Phase 7 — Inbox, season, achievements, rankings, rescue
- [ ] Phase 8 — Premium UI polish
- [ ] Phase 9 — Security, privacy, load, clean-room
- [ ] Phase 10 — MainAlbatross production deployment
- [ ] Phase 11 — Early access and evidence collection
- [ ] Phase 12 — Submission release freeze
