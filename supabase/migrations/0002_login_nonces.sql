-- login_nonces --------------------------------------------------------------
-- Single-use, expiring, origin-bound login challenges (PRD 11.4 / 32.3).
-- A row is deleted the moment it is consumed, so a captured signature can
-- never be replayed against a second /api/auth/verify call. `consumed_at`
-- exists only for the (rare) audit case where a delete is deferred.
-- Ephemeral by nature; a periodic sweep removes rows past `expires_at`.

create table login_nonces (
  nonce text primary key,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index login_nonces_expires_at_idx on login_nonces (expires_at);
