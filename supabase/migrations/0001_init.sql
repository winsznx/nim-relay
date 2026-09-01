-- NIM Relay initial schema. Mirrors PRD section 15 exactly.
-- Supabase Postgres is the durable relational authority (ARCHITECTURE.md
-- "four authorities") - never the source of truth for money or live
-- coordination, both of which belong to the Nimiq chain and RelayRoom
-- Durable Objects respectively.

create extension if not exists "pgcrypto";

-- Enums -----------------------------------------------------------------

create type player_status as enum ('active', 'suspended', 'deleted');

create type relay_mode as enum ('global', 'quick', 'crew', 'rival', 'daily', 'creator');

create type relay_state as enum (
  'DRAFT','READY','ACTIVE','WAITING_FOR_RUN','RUN_VERIFIED','INVITING',
  'RUNNER_CLAIMED','PASS_INTENT_READY','PASS_ATTEMPTING','TX_SUBMITTED',
  'TX_CONFIRMED','HANDOFF_FINALIZING','COMPLETED','STRANDED','EXPIRED','CANCELLED'
);

create type relay_leg_status as enum (
  'AWAITING_RUN','RUN_VERIFIED','AWAITING_RUNNER','RUNNER_CLAIMED',
  'PASS_ATTEMPTING','TX_SUBMITTED','TX_CONFIRMED','FINALIZED','STRANDED','EXPIRED'
);

create type handoff_intent_state as enum (
  'CREATED','PASS_ATTEMPTING','TX_SUBMITTED','TX_CONFIRMED','FINALIZED','SUPERSEDED','EXPIRED'
);

create type quick_match_state as enum ('ACTIVE','COMPLETED','STRANDED','EXPIRED');

create type rival_event_state as enum ('SCHEDULED','ACTIVE','COMPLETED','CANCELLED');

create type invite_kind as enum ('friend', 'open', 'crew', 'quick', 'creator', 'rescue');

create type invite_state as enum ('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED');

create type friendship_state as enum ('pending', 'accepted', 'blocked');

-- players -----------------------------------------------------------------

create table players (
  id uuid primary key default gen_random_uuid(),
  handle text unique not null,
  display_name text not null,
  wallet_address text unique,
  wallet_public_key text,
  avatar_key text,
  profile_city text,
  country_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status player_status not null default 'active'
);

-- devices -------------------------------------------------------------------
-- device_hash is HMAC-SHA256(raw_device_id, DEVICE_HASH_SECRET). Raw device
-- identifier is never persisted (PRIVACY.md, PRD section 11.5).

create table devices (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete set null,
  device_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  risk_flags jsonb not null default '{}'::jsonb,
  unique(device_hash, player_id)
);

-- sessions --------------------------------------------------------------

create table sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- relays ------------------------------------------------------------------

create table relays (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null,
  mode relay_mode not null,
  title text not null,
  description text,
  state relay_state not null default 'DRAFT',
  baton_amount_luna bigint not null check (baton_amount_luna > 0),
  current_leg integer not null default 0,
  current_holder_player_id uuid references players(id),
  current_holder_wallet text,
  creator_player_id uuid not null references players(id),
  crew_id uuid,
  rival_event_id uuid,
  objective_type text,
  objective_config jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  stranded_at timestamptz,
  created_at timestamptz not null default now(),
  engine_version text not null
);

create table relay_members (
  relay_id uuid not null references relays(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  role text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (relay_id, player_id)
);

create table relay_legs (
  id uuid primary key default gen_random_uuid(),
  relay_id uuid not null references relays(id) on delete cascade,
  leg_number integer not null,
  holder_player_id uuid not null references players(id),
  holder_wallet text not null,
  run_id uuid,
  next_player_id uuid references players(id),
  next_wallet text,
  intent_id uuid,
  tx_hash text,
  status relay_leg_status not null default 'AWAITING_RUN',
  country_code text,
  country_source text,
  profile_city text,
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (relay_id, leg_number),
  unique (tx_hash)
);

-- handoff_intents -----------------------------------------------------------
-- Canonical idempotency key downstream: relay_id + leg_number + tx_hash
-- (PRD section 9.8). A transaction hash cannot finalize two legs/relays.

create table handoff_intents (
  id uuid primary key default gen_random_uuid(),
  relay_id uuid not null references relays(id) on delete cascade,
  leg_number integer not null,
  from_player_id uuid not null references players(id),
  from_wallet text not null,
  to_player_id uuid not null references players(id),
  to_wallet text not null,
  baton_amount_luna bigint not null check (baton_amount_luna > 0),
  run_id uuid not null,
  intent_hash text not null,
  tx_data text not null,
  state handoff_intent_state not null default 'CREATED',
  created_at timestamptz not null default now(),
  claim_expires_at timestamptz not null,
  attempt_expires_at timestamptz,
  tx_hash text unique,
  superseded_at timestamptz,
  check (from_wallet <> to_wallet) -- no self-pass at the schema level (PRD 9.3.4)
);

create unique index handoff_intents_one_sendable_per_leg
  on handoff_intents (relay_id, leg_number)
  where state in ('CREATED', 'PASS_ATTEMPTING', 'TX_SUBMITTED');

-- relay_legs.run_id and handoff_intents.run_id reference game_runs, created
-- next; Postgres requires the referenced table to exist first, so those two
-- foreign keys are attached via ALTER TABLE below once game_runs exists.

-- game_runs -----------------------------------------------------------------

create table game_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  relay_id uuid references relays(id),
  leg_number integer,
  daily_challenge_id uuid,
  engine_version text not null,
  challenge_type text not null,
  challenge_version text not null,
  seed text not null,
  difficulty integer not null default 0,
  rules_hash text not null,
  artifact_key text,
  artifact_sha256 text not null,
  client_result_hash text,
  server_result_hash text not null,
  score bigint not null default 0,
  success boolean not null default false,
  perfect_metric integer,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  verification_version text not null
);

alter table relay_legs
  add constraint relay_legs_run_id_fkey foreign key (run_id) references game_runs(id);

alter table handoff_intents
  add constraint handoff_intents_run_id_fkey foreign key (run_id) references game_runs(id);

-- quick_matches ---------------------------------------------------------

create table quick_matches (
  id uuid primary key default gen_random_uuid(),
  relay_id uuid unique not null references relays(id) on delete cascade,
  player_a uuid not null references players(id),
  player_b uuid not null references players(id),
  best_of integer not null default 5,
  score_a integer not null default 0,
  score_b integer not null default 0,
  current_round integer not null default 1,
  state quick_match_state not null default 'ACTIVE',
  winner_player_id uuid references players(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- crews -------------------------------------------------------------------

create table crews (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null,
  name text not null,
  owner_player_id uuid not null references players(id),
  created_at timestamptz not null default now(),
  current_streak_days integer not null default 0,
  best_streak_days integer not null default 0
);

alter table relays add constraint relays_crew_id_fkey foreign key (crew_id) references crews(id);

create table crew_members (
  crew_id uuid not null references crews(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  role text not null,
  joined_at timestamptz not null default now(),
  primary key (crew_id, player_id)
);

create table crew_days (
  crew_id uuid not null references crews(id) on delete cascade,
  date date not null,
  qualified_handoffs integer not null default 0,
  streak_preserved boolean not null default false,
  primary key (crew_id, date)
);

-- rival_events ------------------------------------------------------------

create table rival_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  state rival_event_state not null default 'SCHEDULED',
  objective_type text not null,
  objective_config jsonb not null default '{}'::jsonb,
  relay_a_id uuid not null references relays(id),
  relay_b_id uuid not null references relays(id),
  score_a bigint not null default 0,
  score_b bigint not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  winner_side text
);

alter table relays add constraint relays_rival_event_id_fkey foreign key (rival_event_id) references rival_events(id);

-- daily_challenges / daily_results -----------------------------------------

create table daily_challenges (
  id uuid primary key default gen_random_uuid(),
  date date unique not null,
  engine_version text not null,
  challenge_type text not null,
  seed text not null,
  rules_hash text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);

alter table game_runs
  add constraint game_runs_daily_challenge_id_fkey foreign key (daily_challenge_id) references daily_challenges(id);

create table daily_results (
  daily_challenge_id uuid not null references daily_challenges(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  run_id uuid not null references game_runs(id),
  score bigint not null,
  rank integer,
  official boolean not null default false,
  created_at timestamptz not null default now(),
  unique (daily_challenge_id, player_id, official)
);

-- invites -------------------------------------------------------------------
-- Store only the token hash - the raw token lives in the shared URL, never
-- server-side (PRD section 15.16, section 29).

create table invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  relay_id uuid not null references relays(id) on delete cascade,
  inviter_player_id uuid not null references players(id),
  target_player_id uuid references players(id),
  target_wallet text,
  kind invite_kind not null,
  state invite_state not null default 'PENDING',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by_player_id uuid references players(id),
  claimed_at timestamptz
);

-- friendships ---------------------------------------------------------------

create table friendships (
  player_a uuid not null references players(id) on delete cascade,
  player_b uuid not null references players(id) on delete cascade,
  state friendship_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_a, player_b),
  check (player_a < player_b) -- canonical ordering prevents duplicate pairs
);

-- achievements ----------------------------------------------------------

create table achievements (
  id text primary key,
  name text not null,
  description text not null,
  icon_key text not null,
  rules jsonb not null default '{}'::jsonb,
  version integer not null default 1
);

create table player_achievements (
  player_id uuid not null references players(id) on delete cascade,
  achievement_id text not null references achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb,
  primary key (player_id, achievement_id)
);

-- seasons -------------------------------------------------------------------

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  theme text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  objective_config jsonb not null default '{}'::jsonb,
  state text not null default 'UPCOMING'
);

create table season_scores (
  season_id uuid not null references seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  xp bigint not null default 0,
  rank integer,
  qualified_handoffs integer not null default 0,
  ghost_wins integer not null default 0,
  crew_contribution integer not null default 0,
  countries_reached integer not null default 0,
  primary key (season_id, player_id)
);

-- notifications ---------------------------------------------------------

create table notifications (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- product_events (privacy-minimized internal analytics) ---------------------
-- Never store raw IP, raw device ID, wallet signatures, or secrets here.

create table product_events (
  id bigint generated always as identity primary key,
  player_id uuid references players(id) on delete set null,
  session_id uuid,
  event_name text not null,
  relay_id uuid references relays(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- abuse_signals -----------------------------------------------------------
-- Abuse state excludes activity from competitive metrics; it never
-- confiscates funds or blocks a valid on-chain transfer (PRD section 15.24).

create table abuse_signals (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references players(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  signal_type text not null,
  severity integer not null default 1,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Indexes for hot query paths ------------------------------------------------

create index idx_relays_state on relays (state);
create index idx_relays_mode on relays (mode);
create index idx_relay_legs_relay_id on relay_legs (relay_id);
create index idx_handoff_intents_relay_leg on handoff_intents (relay_id, leg_number);
create index idx_game_runs_player_id on game_runs (player_id);
create index idx_notifications_player_unread on notifications (player_id) where read_at is null;
create index idx_product_events_player_id on product_events (player_id);
create index idx_invites_relay_id on invites (relay_id);
create index idx_sessions_player_id on sessions (player_id);
create index idx_devices_device_hash on devices (device_hash);
