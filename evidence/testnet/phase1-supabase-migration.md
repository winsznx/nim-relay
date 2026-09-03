# Phase 1 — Supabase migration applied to the live project

Closes the last open Phase 1 gate item (`run-state.json` → `databaseMigration`)
and D-003's open item.

## Target

Fresh Supabase project `<project-ref>` (region `aws-0-eu-west-2`),
provided by the user 2026-09-03. Credentials are held in the gitignored `.env`,
never committed.

## Command

```
supabase db push --db-url "postgresql://postgres.<ref>:<pw>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres" --yes
```

```
Connecting to remote database...
Applying migration 0001_init.sql...
NOTICE (42710): extension "pgcrypto" already exists, skipping
Finished supabase db push.
```

The only NOTICE is benign (`pgcrypto` ships enabled on Supabase). No errors; the
full 420-line migration executed.

## Verification (via `pg` over the session pooler)

```
TABLES 24
abuse_signals, achievements, crew_days, crew_members, crews, daily_challenges,
daily_results, devices, friendships, game_runs, handoff_intents, invites,
notifications, player_achievements, players, product_events, quick_matches,
relay_legs, relay_members, relays, rival_events, season_scores, seasons, sessions

ENUMS 10
friendship_state, handoff_intent_state, invite_kind, invite_state, player_status,
quick_match_state, relay_leg_status, relay_mode, relay_state, rival_event_state

INDEXES 46   FOREIGN KEYS 48
MIGRATIONS  [{ version: "0001", name: "init" }]
```

24 tables and 10 enums, matching PRD §15. The migration is tracked in
`supabase_migrations.schema_migrations`, so future `supabase db push` runs are
incremental.

## Finding to carry forward — RLS is on, no policies yet

All 24 `public` tables report `relrowsecurity = true` (Supabase auto-enables RLS
on new `public` tables), but `0001_init.sql` defines **no policies**. Effect:
`anon` and `authenticated` are fully denied; only the `service_role` key can
read or write. That is the intended shape for now — the Worker is the only
client and it will use the service-role key — but explicit RLS policy design is
a PRD Phase 9 security item and must land before any direct browser→Supabase
access is ever added. Tracked in `run-state.json` `openVerificationItems`.

## Consequence for the auth store

The Worker's `SupabaseAuthStore` needs `SUPABASE_SERVICE_ROLE_KEY` (a
`service_role` JWT), not the `sb_publishable_…` key. Until that secret is set,
`getAuthStore()` stays on `InMemoryAuthStore`.

## Migration 0002 — login_nonces

`0002_login_nonces.sql` adds the `login_nonces` table (single-use, expiring
challenges) so `SupabaseAuthStore` has one backend for the whole auth flow.
Applied the same way; `supabase_migrations.schema_migrations` now holds `0001`
and `0002`.

## Schema smoke for the auth flow (via `pg`, transaction rolled back)

```
player insert                             -> ok
device insert (fk player_id)              -> ok
session insert (fk player_id/device_id)   -> ok, revoked_at null by default
login_nonces insert + delete .. returning -> 1 row (single-use consume works)
duplicate wallet_address insert           -> rejected, SQLSTATE 23505
revoke (update .. where revoked_at is null) -> 1 row, then 0 rows (idempotent)
rollback                                  -> players/sessions/devices/login_nonces back to 0
```

Confirms the applied schema supports every operation `SupabaseAuthStore`
performs, before the `service_role` key is available to drive it through
supabase-js.
