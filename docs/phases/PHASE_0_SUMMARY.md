# Phase 0 Summary — Source-of-truth verification

**Objective.** Verify current official APIs (competition, Nimiq Mini Apps, Nimiq Web Client, Cloudflare Workers/DO, Supabase) before any implementation depends on an unverified assumption.

**Files changed.**
- `docs/PHASE_0_VERIFICATION.md` (new)
- `DECISIONS.md` (new — D-001, D-002, D-003)
- `run-state.json` (new)
- `TASKS.md` (new)
- `evidence/dependencies.json` (new)
- `evidence/local/phase0-nimiq-core-workerd-spike.log` (new)
- `evidence/local/phase0-nimiq-core-workerd-spike-result.json` (new)
- Repo scaffold: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `LICENSE`, `.nvmrc`, directory tree per PRD §43.

**Commands executed.**
```text
npm view <pkg> version   (dependency pinning, 16 packages)
git init -b main
mkdir -p <monorepo tree>
npx wrangler dev --port 8799   (spike Worker, local workerd)
curl http://localhost:8799/spike/nimiq-core
curl -X POST https://rpc.nimiqwatch.com  (getBlockNumber, x2)
```

**Test counts/results.** No product tests yet (Phase 1+). One empirical runtime spike executed and recorded (pass/fail below).

**Adversarial cases executed.** N/A this phase — anti-cheat/adversarial testing begins Phase 3-4.

**Network evidence produced.**
- `@nimiq/core` inside `workerd`: **FAIL** (`wasm2.__wbindgen_start is not a function`) — see `evidence/local/phase0-nimiq-core-workerd-spike.log`.
- `rpc.nimiqwatch.com` plain JSON-RPC over HTTPS: **PASS**, live incrementing block number confirmed across two calls.

**Deployment evidence.** None — no deployment this phase.

**Security findings.** None new. Confirmed `@nimiq/core`'s dependency tree pulls native `node-gyp-build` addons (`bufferutil`, `utf-8-validate`), reinforcing that it must never be bundled into the deployed Worker (native modules cannot execute in `workerd`).

**Evidence paths.** `evidence/local/phase0-*`, `evidence/dependencies.json`.

**Known limitations.** Three open verification items carried into Phase 2 (RPC network identity, deep-link path/query passthrough, Nimiq message-signing byte layout) — see `docs/PHASE_0_VERIFICATION.md` §7 and `DECISIONS.md` D-001/D-002. None block Phase 1.

**Claim-ledger changes.** None yet — `CLAIMS.md` not yet populated with product claims (no product surface exists yet).

**Decision changes.** D-001, D-002, D-003 recorded in `DECISIONS.md`.

**Commit SHA.** Recorded after this phase's commit (see `run-state.json`).

**Result: PASS**
