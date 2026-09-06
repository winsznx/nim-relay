import { relayRun } from '@nim-relay/game-engine'

type RelayInputTrace = relayRun.RelayInputTrace
type RelayReplayConfig = relayRun.RelayReplayConfig

const ONE = 65536

/**
 * A deterministic "par" ghost for the first run of a route — a heuristic bot
 * that steers toward the next gate / corridor centre and plays the wide fork.
 * Client-only, labelled a local reference; a real verified previous-runner
 * trace replaces it once one exists. Not on any trust path.
 */
export function parGhostTrace(config: RelayReplayConfig): RelayInputTrace {
  const ticks = relayRun.totalTicks(config)
  const mods = relayRun.composeRoute(config.seed, config.legNumber, relayRun.deriveCarryState(config.prevLeg ?? null))
  const gates = mods.flatMap((m) => m.gates).sort((a, b) => a.tick - b.tick)

  let state = relayRun.createRelayState(config)
  const out: [number, number, 0 | 1][] = [[0, 0, 0]]
  let lastTick = 0
  let steer = 0
  let pressed: 0 | 1 = 0
  let gi = 0

  for (let t = 0; t < ticks; t++) {
    while (gi < gates.length && gates[gi]!.tick < t) gi++
    const mod = mods.find((m) => t >= m.startTick && t < m.endTick) ?? mods[mods.length - 1]!

    let targetX = 0
    let wantPressed: 0 | 1 = 0
    if (mod.kind === 'catch') {
      // aim centre-ish and tap around 60% into the window
      targetX = 0
      wantPressed = t === mod.startTick + Math.floor((mod.endTick - mod.startTick) * 0.55) ? 1 : 0
    } else if (mod.kind === 'sling') {
      wantPressed = t < mod.endTick - 24 ? 1 : 0 // charge, then release
      targetX = 0
    } else if (mod.kind === 'turbulence') {
      targetX = 0 // hold the corridor centre
    } else {
      const g = gates[gi]
      targetX = g && g.tick - t < 90 ? g.x : Math.floor(state.x * 0.5)
    }

    const steerQ = Math.max(-64, Math.min(64, Math.round((targetX / ONE) * 64)))
    if (steerQ !== steer || wantPressed !== pressed || t - lastTick >= 30) {
      if (t > 0) out.push([t - lastTick, steerQ, wantPressed])
      else { out[0] = [0, steerQ, wantPressed] }
      lastTick = t
      steer = steerQ
      pressed = wantPressed
    }
    state = relayRun.stepRelay(state, { steer: steerQ, pressed: wantPressed }, t)
  }
  return out
}
