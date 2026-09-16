# Production Station v4 verification

- Preserved engines v1/v2/v3; new namespace stationRace v4.
- Engine: 620 passing cases, including 200 committed station golden traces; agent ran 204 station checks under workerd with identical hashes.
- Shared: 3 tests. Protocol: 40 tests. Worker: 48 tests, including authenticated station, owner-bound issuance, tampering rejection, idempotent XP, crew challenges, pending and verified custody transfer.
- Install with frozen lockfile, workspace typecheck, ESLint, production build and Wrangler deployment dry-run passed.
- Playwright mobile: station, departure, boost/jump, pause/resume, complete ride, return; zero runtime errors.
- Original courier GLB and 11 named animation clips generated with scripts/assets/build-courier.mjs; source/license in public/assets/manifest.json.
- Supabase migration 0004_station_races.sql applied using the existing project database connection. Canonical archival retries through the Durable Object alarm.
- Native SDK's getNetwork returns provider family `nimiq`, not chain identity. Native approval must show the intended TestAlbatross network; independent server RPC verification enforces network, recipient, sender, amount, commitment, execution and confirmations.
- Live real-wallet approval and physical iPhone frame profiling have not been performed by automation.

Browser screenshots: /tmp/nim-relay-production. Deployed version dd887da5-95a3-4364-a4e3-6ff2b551bed5 at https://nim-relay.timjosh507.workers.dev. Live health and public station endpoints passed; live mobile browser completed departure, 15 seconds of touch-controlled racing, and pause with zero runtime errors. Screenshots and recording copied alongside this report. All five world browser checks passed. Controller tests: 2 passing.
