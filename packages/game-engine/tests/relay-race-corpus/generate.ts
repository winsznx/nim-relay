import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relayRace } from '../../src/index'
import type { RaceInputTrace, RaceReplayConfig } from '../../src/relay-race'

// Hand-built bot traces (not engine-PRNG generated) across seeds and play styles.
function bot(seed: string, style: number): RaceInputTrace {
  const track = relayRace.buildTrack(seed)
  const gates = [...track.gates].sort((a, b) => a.dist - b.dist)
  let st = relayRace.createRaceState({ engineVersion: '3', challenge: 'relay-race', challengeVersion: '3', seed })
  const out: [number, number, 0 | 1][] = [[0, 0, 0]]
  let last = 0
  let steer = 0
  let boost: 0 | 1 = 0
  let gi = 0
  while (st.finished === 0) {
    const tick = st.tick
    while (gi < gates.length && gates[gi]!.dist < st.dist) gi++
    let tx = gates[gi] ? gates[gi]!.x / 65536 : 0
    if (st.dist > track.forkDist && st.dist < track.forkRejoin) tx = (style % 2 === 0 ? -1 : 1) * track.shortcutSide * 0.5
    if (style === 3) tx += 0.15 // sloppy line
    const sq = Math.max(-64, Math.min(64, Math.round(tx * 64)))
    const cap = style === 1 ? 55000 : style === 2 ? 30000 : 40000
    const b: 0 | 1 = st.heat < cap ? 1 : 0
    if (sq !== steer || b !== boost || tick - last >= 24) {
      if (tick > 0) out.push([tick - last, sq, b])
      else out[0] = [0, sq, b]
      last = tick
      steer = sq
      boost = b
    }
    st = relayRace.stepRace(st, { steer: sq, boost: b }, tick)
  }
  return out
}

const cases = Array.from({ length: 64 }, (_, i) => {
  const seed = `race-corpus-${(i * 2246822519) >>> 0}`
  const config: RaceReplayConfig = { engineVersion: '3', challenge: 'relay-race', challengeVersion: '3', seed, inputTrace: [] }
  return { id: `rc-${String(i).padStart(2, '0')}`, ...config, inputTrace: bot(seed, i % 4) }
})

const expected = cases.map(({ id, ...args }) => {
  const r = relayRace.replayRaceRun(args)
  return { id, timeMs: r.timeMs, timeSeconds: r.timeSeconds, perfectGates: r.perfectGates, totalGates: r.totalGates, shortcuts: r.shortcuts, boostControlPct: r.boostControlPct, relayScore: r.relayScore, resultHash: r.resultHash, ticks: r.ticks }
})

writeFileSync(fileURLToPath(new URL('./cases.json', import.meta.url)), `${JSON.stringify(cases)}\n`)
writeFileSync(fileURLToPath(new URL('./expected.json', import.meta.url)), `${JSON.stringify(expected, null, 2)}\n`)
console.log(`Generated ${cases.length} relay-race corpus cases.`)
