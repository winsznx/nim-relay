import { relayRace } from '@nim-relay/game-engine'

type RaceInputTrace = relayRace.RaceInputTrace
type RaceReplayConfig = relayRace.RaceReplayConfig

/**
 * Onboarding ghost — a deliberately beatable clean line: conservative boost,
 * safe fork, slightly loose steering. Deterministic, client-only, labelled a
 * reference run. A verified previous-runner trace replaces it in production.
 */
export function onboardingGhost(config: RaceReplayConfig): { trace: RaceInputTrace; name: string } {
  const track = relayRace.buildTrack(config.seed)
  const gates = [...track.gates].sort((a, b) => a.dist - b.dist)
  let st = relayRace.createRaceState(config)
  const out: [number, number, 0 | 1][] = [[0, 0, 0]]
  let last = 0
  let steer = 0
  let boost: 0 | 1 = 0
  let gi = 0
  while (st.finished === 0) {
    const tick = st.tick
    while (gi < gates.length && gates[gi]!.dist < st.dist) gi++
    let tx = gates[gi] ? gates[gi]!.x / 65536 : 0
    if (st.dist > track.forkDist && st.dist < track.forkRejoin) tx = -track.shortcutSide * 0.5 // safe line
    tx += 0.05
    const sq = Math.max(-64, Math.min(64, Math.round(tx * 64)))
    const b: 0 | 1 = st.heat < 26000 ? 1 : 0 // cautious boost
    if (sq !== steer || b !== boost || tick - last >= 24) {
      if (tick > 0) out.push([tick - last, sq, b])
      else out[0] = [0, sq, b]
      last = tick
      steer = sq
      boost = b
    }
    st = relayRace.stepRace(st, { steer: sq, boost: b }, tick)
  }
  return { trace: out, name: 'Mariana' }
}
