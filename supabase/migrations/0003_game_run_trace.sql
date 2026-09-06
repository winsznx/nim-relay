-- game_runs.input_trace -----------------------------------------------------
-- The canonical input trace for a server-verified run (PRD 7.9 "input
-- artifact"). Bounded to <= 4096 events / <= 32 KB by the engine's trace
-- validator, so it lives inline as jsonb until R2 is enabled and large
-- artifacts move to `artifact_key`. Nullable: trivial/empty traces and
-- pre-migration rows carry none.

alter table game_runs add column input_trace jsonb;
