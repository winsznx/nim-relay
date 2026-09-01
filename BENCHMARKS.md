# Benchmarks

Performance evidence, per PRD §37.4. Populated starting Phase 3 (game performance) and Phase 8/9 (full-stack latency/load). Empty at Phase 0/1 — no runtime to measure yet.

Planned measurements:
- First load, route transition timing
- Game frame timing (60 FPS target, mid-range mobile)
- Replay verification latency (Worker-side)
- API p50/p95 (per endpoint)
- WebSocket reconnect timing
- Nimiq transaction verification latency (RPC round-trip)
- Supabase query latency
