import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relayRun } from '../../src/index'
import type { RelayInputTrace, RelayReplayConfig } from '../../src/relay-run'

// Fixtures are hand-built (not engine-PRNG generated) so a sim/route/scoring
// mutation changes results rather than silently regenerating matching output.

const REGIONS = ['aurora', 'desert', 'ocean', 'city', 'mountain', 'canyon']

function synth(ticks: number, mode: number): RelayInputTrace {
  const out: [number, number, 0 | 1][] = [[0, 0, 0]]
  let last = 0
  let steer = 0
  let pressed: 0 | 1 = 0
  for (let t = 1; t < ticks; t++) {
    const s = Math.max(-64, Math.min(64, Math.round(
      mode % 3 === 0 ? 40 * Math.sign(((t * (mode + 1)) % 200) - 100)
      : mode % 3 === 1 ? (((t * 7 + mode * 13) % 129) - 64)
      : 60 * (Math.floor(t / 45) % 2 === 0 ? 1 : -1),
    )))
    const p: 0 | 1 = ((t + mode * 5) % (24 + (mode % 4) * 9) < 7) ? 1 : 0
    if (s !== steer || p !== pressed || t - last >= 30) {
      out.push([t - last, s, p]); last = t; steer = s; pressed = p
    }
  }
  return out
}

const cases = Array.from({ length: 96 }, (_, i) => {
  const config: RelayReplayConfig = {
    engineVersion: '2',
    challenge: 'relay-run',
    challengeVersion: '2',
    seed: `relay-corpus-${(i * 2654435761) >>> 0}`,
    legNumber: 1 + (i % 40),
    sourceRegionId: REGIONS[i % REGIONS.length]!,
    destRegionId: REGIONS[(i + 3) % REGIONS.length]!,
    prevLeg: i % 4 === 0 ? null : {
      cleanGateRatio: (i * 811) % 65536,
      turbulenceScoreNorm: (i * 2179) % 65536,
      slingAccuracy: (i * 5051) % 65536,
      slingAngle: ((i * 7919) % 131072) - 65536,
    },
    inputTrace: [],
  }
  const inputTrace = synth(relayRun.totalTicks(config), i)
  return { id: `rr-${String(i).padStart(2, '0')}`, ...config, inputTrace }
})

const expected = cases.map(({ id, ...args }) => {
  const r = relayRun.replayRelayRun(args)
  return { id, score: r.score, breakdown: r.breakdown, resultHash: r.resultHash, ticks: r.ticks }
})

writeFileSync(fileURLToPath(new URL('./cases.json', import.meta.url)), `${JSON.stringify(cases)}\n`)
writeFileSync(fileURLToPath(new URL('./expected.json', import.meta.url)), `${JSON.stringify(expected, null, 2)}\n`)
console.log(`Generated ${cases.length} relay-run corpus cases.`)
