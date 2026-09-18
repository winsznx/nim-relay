# Tasks

Live task tracker, rebuild brief of 2026-09-16. See `HANDOFF.md` for the fuller narrative state and `DECISIONS.md` for why earlier approaches were replaced. Earlier phase-numbered tracking (Phase 0-4, the original engine and the V2/V3 redesigns) is archived under `docs/history/`.

Goal: a living global relay game where a real NIM baton passes human to human; the race is one leg.

## Done (committed)
- [x] Checkpoint of Sept 8/13 station and network work (`1dbac24`)
- [x] Relay Leg v5 deterministic engine: authored world modules, safe/risk fork, earned FLOW, rhythm-intercept pulse gates on a 144 BPM tick grid, 200-leg golden corpus in Node and `workerd`
- [x] Relay Leg v6: lane-based road with real edges, world events, two forks, a pulse section, `deriveGhostline()`; v5 frozen as deployed, new gameplay work goes into v6 only (`DECISIONS.md` D-008)
- [x] Backend: leg issuance and replay, route sectors and ghost lineage, serials, echoes, achievements and artifacts, chronicles, runner profiles, machine reason codes, reservation timeout, crew code privacy
- [x] Handoff ceremony state machine (throw locks intent, Nimiq Pay, verification, decline, insufficient, ambiguous recovery, rejection, duplicates, resume)
- [x] Routed shell, living globe home, journey, Chronicle, proof, social screens
- [x] Relay Station 3D home with diegetic surfaces
- [x] Custom domains (`nimrelay.xyz`, `testnet.nimrelay.xyz`) plus server-rendered Open Graph tags and preview images
- [x] Audio: CC0 music and SFX, race music locked to the sim clock, ceremony score
- [x] Race presentation: courier, ghost courier, five worlds, set pieces, camera and juice
- [x] Identicons, share cards, profile, crew streaks, rivals, Daily ranks
- [x] Leg flow wired end to end; fixed an RPC-client `fetch`-as-method bug under Workers that blocked every handoff verification
- [x] Local two-runner lifecycle E2E with mocked Nimiq Pay and mock RPC
- [x] First-run product tour and gameplay micro-tutorial
- [x] Resolve stuck attempted passes from chain history; fix clipped toast
- [x] Relay Atlas and Relay Grants; Relay Grants turned on for testnet and mainnet

## In progress
- [ ] Ops analytics view with alerts (agent)
- [ ] Testnet deploy of the integrated build, then live smoke
- [x] Real two-wallet handoffs on iPhone in Nimiq Pay, three verified on mainnet (2026-09-18)

## Next
- [ ] Relay Echoes rendered in the race world from issued echoes
- [ ] Live spectating status for an active leg
- [ ] Physical iPhone profiling and adaptive quality tuning from measurements
- [ ] Mainnet deploy after testnet handoff is verified
- [ ] Docs and evidence refresh (README, CLAIMS, evidence/production)
- [ ] Competition submission assets (cycle choice pending from user — see `DECISIONS.md`)
