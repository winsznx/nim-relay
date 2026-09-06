# Phase 4 (slice 1) — server-verified game runs

First slice of the relay protocol: the Worker issues a signed challenge config
the client cannot alter, and re-derives the canonical score by replaying the
submitted input trace with the same engine (PRD §7.7–7.9). The relay state
machine, the Durable Object, chain verification and the handoff flow are later
slices.

## API (`/api/runs`, all behind `requireSession`)

```
POST /api/runs/issue   { challenge }              -> IssuedChallenge (runId, seed, difficulty,
                                                     durationMs, rulesHash, startBefore, mac)
POST /api/runs/submit   IssuedChallenge + inputTrace + clientResultHash?
                                                  -> { runId, score, success, breakdown,
                                                       serverResultHash, clientMatchesServer, created }
GET  /api/runs/:runId                              -> stored run (owner only)
```

- `mac` = HMAC-SHA256(`RUN_CHALLENGE_SECRET`, canonical `key=value\n…` of every
  covered field). The client cannot change the seed, difficulty, duration or
  rules and still submit a valid run.
- `submit` re-checks the MAC, rejects a stale `rulesHash` (409) or a fully
  elapsed start window (410), replays the trace with `@nim-relay/game-engine`'s
  `replay()`, and persists to `game_runs` (id = the issued `runId`, so a repeated
  submit is idempotent and returns `created: false`).
- `clientResultHash` (optional) is stored and compared — `clientMatchesServer`
  surfaces drift without ever letting the client's number affect the stored
  score.
- Migration `0003_game_run_trace.sql` adds `game_runs.input_trace jsonb` (traces
  are ≤4096 events / ≤32 KB; they move to R2 `artifact_key` when R2 is enabled).

## Tests

- `packages/relay-protocol/src/challenge.test.ts` — 5 tests: MAC message is
  stable and field-order-fixed, changes on any covered field, `isChallengeStartable`
  boundary, `isWellFormedChallenge` accepts/rejects.
- `apps/worker/src/runs/routes.test.ts` — 11 tests in real `workerd` (`SELF.fetch`,
  real login): issue is MAC-signed and server-chosen, submit score equals a
  direct `replay()`, idempotent on runId, honest/lying `clientResultHash`,
  tampered MAC → 401, changed seed → 401, malformed trace → 400 with the
  validator code, a validly-signed but fully-expired challenge → 410, GET is
  owner-scoped.
- Full workspace gate green: game-engine 240, worker 44, relay-protocol 39,
  shared 3.

## Live smoke — deployed Worker + live Supabase

`pnpm verify:runs https://nim-relay.timjosh507.workers.dev <same>`:

```
login -> ok
issue -> run b5f9291e-… seed aeb374ed27ebd43eaca5f4913619d5d6
submit -> score 0, matches local replay, created=true
get -> 200 same run and score
resubmit -> idempotent (created=false)
tampered seed -> 401 as expected
RUNS_E2E_PASS
```

The `game_runs` row landed with `challenge_type`, `score`, `success`,
`server_result_hash` and the 6-event `input_trace` jsonb. (Score 0 because the
synthetic 6-transition trace is deliberately bad Stabilize play — the point is
server/local agreement and the flow.) Test rows deleted afterward.

## Not in this slice

Relay/leg tables and state machine, `RelayRoom` coordination, handoff intents,
`verifyHandoffTransaction` + RPC confirmation loop, IndexedDB recovery, reroute,
stranded, concurrency tests, the end-to-end TestAlbatross handoff (the Phase 4
gate). `/play` still runs fully client-side and is not wired to `/api/runs` yet.
