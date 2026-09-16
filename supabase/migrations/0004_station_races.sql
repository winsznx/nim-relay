-- Append-only relational archive; StationRoom serializes live progression/custody.
create table if not exists public.station_races (
  id uuid primary key,
  player_id uuid not null references public.players(id),
  mode text not null,
  config jsonb not null,
  input_trace jsonb not null,
  result jsonb not null,
  verified_at timestamptz not null default now()
);
alter table public.station_races enable row level security;
create index if not exists station_races_player_verified on public.station_races(player_id, verified_at desc);
-- No anonymous policies: only the service-role archive writer can access traces.
