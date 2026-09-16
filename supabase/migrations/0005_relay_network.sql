-- Additive network archive. Existing station/auth/legacy relay rows remain untouched.
create table if not exists relay_network_snapshots (
  network text primary key check (network in ('TestAlbatross','MainAlbatross')),
  version bigint not null,
  payload jsonb not null,
  updated_at timestamptz not null
);
create table if not exists relay_network_handoffs (
  id uuid primary key,
  network text not null,
  baton_id uuid not null,
  leg integer not null check (leg > 0),
  tx_hash text not null,
  payload jsonb not null,
  unique(network, tx_hash),
  unique(network, baton_id, leg)
);
alter table relay_network_snapshots enable row level security;
alter table relay_network_handoffs enable row level security;
revoke all on relay_network_snapshots, relay_network_handoffs from anon, authenticated;
