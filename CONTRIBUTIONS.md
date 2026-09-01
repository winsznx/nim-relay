# Contributions

## To this repository
Standard flow: branch, PR, CI green (lint/typecheck/test), review. No secrets in diffs — checked before every commit.

## To the wider Nimiq ecosystem
Per PRD §44.6, this project aims for 1-3 maintainer-quality upstream contributions to real Nimiq ecosystem repositories where a genuine gap was found while building NIM Relay (for example, if a Workers-runtime compatibility issue in an official package is confirmed reproducible — see `DECISIONS.md` D-001 for a candidate: `@nimiq/core` failing to instantiate its WASM module under `workerd`).

Before opening any such PR:
- Verify against the current `main` branch of the target repo
- Search for existing/duplicate issues first
- Reproduce the issue with a minimal, sharable repro
- Add a regression test where practical
- Run the target repo's own native checks before submitting

No low-value or drive-by PRs. Status: none opened yet — this section will be updated with real links if/when a genuine contribution is made.
