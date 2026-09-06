import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHALLENGE_IDS, ENGINE_VERSION, replay } from '../../src/index'
import type { InputTrace, RunConfig } from '../../src/index'

// Corpus inputs must not use the engine PRNG: a PRNG mutation must change results,
// not silently generate a different fixture with matching expected outputs.
const cases = CHALLENGE_IDS.flatMap((challenge, challengeIndex) =>
  Array.from({ length: 40 }, (_, index) => {
    const durationMs = [15000, 20000, 25000, 30000][index % 4] ?? 20000
    const config: RunConfig = {
      engineVersion: ENGINE_VERSION,
      challengeVersion: '1.0.0',
      challenge,
      seed: String(BigInt(index + 1) * 0x9e3779b97f4a7c15n + BigInt(challengeIndex)),
      difficulty: 1 + index % 10,
      durationMs,
    }
    const events: [number, 0 | 1][] = []
    let timestamp = index % 3 === 0 ? 0 : 1 + index * 11
    let value: 0 | 1 = 1
    const mode = index % 8
    if (mode === 1) events.push([0, 1])
    if (mode === 2) events.push([durationMs - 1, 1])
    if (mode >= 3) {
      while (timestamp < durationMs) {
        events.push([timestamp, value])
        value = value === 1 ? 0 : 1
        timestamp += mode === 3 ? 17 : mode === 4 ? 113 : mode === 5 ? 499 : mode === 6 ? 1501 : 71 + ((timestamp * 73 + index * 29) % 521)
      }
    }
    const inputTrace: InputTrace = events
    return { id: `${challenge}-${String(index).padStart(2, '0')}`, ...config, inputTrace }
  }),
)
const expected = cases.map(({ id, ...args }) => ({ id, ...replay(args) }))
writeFileSync(fileURLToPath(new URL('./cases.json', import.meta.url)), `${JSON.stringify(cases)}\n`)
writeFileSync(fileURLToPath(new URL('./expected.json', import.meta.url)), `${JSON.stringify(expected, null, 2)}\n`)
console.log(`Generated ${cases.length} version-bound cases and exact result snapshots.`)
