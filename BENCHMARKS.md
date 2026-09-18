# Benchmarks

Performance evidence for the shipped product. The root `pnpm benchmark` script exists (`pnpm -r --if-present run benchmark`) but no package currently implements a `benchmark` script, so it is a no-op today. Real device profiling (physical iPhone, Nimiq Pay WebView) is the next planned source of this evidence — see `HANDOFF.md`.

Planned measurements:
- First load, route transition timing
- Game frame timing (60 FPS target, mid-range mobile)
- Replay verification latency (Worker-side)
- API p50/p95 (per endpoint)
- WebSocket reconnect timing
- Nimiq transaction verification latency (RPC round-trip)
- Supabase query latency
