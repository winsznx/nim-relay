import { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho, RelayEchoKind } from '@nim-relay/shared'

/** Metres into the leg where the lab's first echo stands: early enough to capture long before the finish. */
const LAB_ECHO_METRES = 150

const ONE = 65_536

function labEcho(kind: RelayEchoKind, name: string, dist: number | null, extra: Partial<RelayEcho> = {}): RelayEcho {
  return { id: `lab-${kind}`, batonId: 'lab-baton', kind, runner: { id: `lab-${name.toLowerCase()}`, name }, leg: 49, runId: `lab-run-${kind}`, sector: 4, dist, at: 0, ...extra }
}

/**
 * Stand-in Relay Echoes for /dev/leg?echoes=1: a timed ghost record early on the main route, an edge save and a relay
 * cut left by earlier runners (the cut where the last fork opens), a rescue late in the leg, and two echoes that span
 * the leg for the arrival.
 */
export function labEchoes(config: relayLeg.Config): RelayEcho[] {
  const track = relayLeg.buildTrack(config)
  const cutFork = track.forks.find(fork => fork.label === 'relay-cut') ?? track.forks.at(-1)
  return [
    labEcho('ghost-record', 'Tim', LAB_ECHO_METRES * ONE, { timeMs: 38_420 }),
    labEcho('edge-save', 'Mariana', (LAB_ECHO_METRES + 60) * ONE),
    ...(cutFork ? [labEcho('relay-cut', 'Ada', cutFork.from + 40 * ONE)] : []),
    labEcho('rescue', 'Marco', Math.round(track.finishDist * 0.75)),
    labEcho('near-miss-legend', 'Yuki', null),
    labEcho('milestone', 'Lena', null, { leg: 50 }),
  ]
}
