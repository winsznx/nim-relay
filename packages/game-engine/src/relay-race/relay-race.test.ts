import { describe, expect, it } from 'vitest'
import {
  buildTrack,
  createRaceState,
  RaceInputCursor,
  replayRaceRun,
  stepRace,
  totalTicks,
  validateRaceTrace,
  type RaceInputTrace,
  type RaceReplayConfig,
} from './index'

const cfg: RaceReplayConfig = { engineVersion: '3', challenge: 'relay-race', challengeVersion: '3', seed: 'race-test-1', inputTrace: [] }

/** deterministic bot: steer toward the next gate, boost when cool. */
function botTrace(seed: string, aggressive: boolean): RaceInputTrace {
  const track = buildTrack(seed)
  const gates = [...track.gates].sort((a, b) => a.dist - b.dist)
  let st = createRaceState({ ...cfg, seed })
  const out: [number, number, 0 | 1][] = [[0, 0, 0]]
  let last = 0
  let steer = 0
  let boost: 0 | 1 = 0
  let gi = 0
  while (st.finished === 0) {
    const tick = st.tick
    while (gi < gates.length && gates[gi]!.dist < st.dist) gi++
    let targetX = gates[gi] ? gates[gi]!.x / 65536 : 0
    if (st.dist > track.forkDist && st.dist < track.forkRejoin) {
      targetX = (aggressive ? track.shortcutSide : -track.shortcutSide) * 0.5
    }
    const sq = Math.max(-64, Math.min(64, Math.round(targetX * 64)))
    const b: 0 | 1 = 0
    if (sq !== steer || b !== boost || tick - last >= 24) {
      if (tick > 0) out.push([tick - last, sq, b])
      else out[0] = [0, sq, b]
      last = tick
      steer = sq
      boost = b
    }
    st = stepRace(st, { steer: sq, boost: b }, tick)
  }
  return out
}

describe('relay-race trace validator', () => {
  it('accepts a bot trace and rejects malformed input without throwing', () => {
    const trace = botTrace('race-test-1', false)
    expect(validateRaceTrace(trace, totalTicks()).ok).toBe(true)
    expect(validateRaceTrace('x', totalTicks())).toMatchObject({ ok: false, error: { code: 'shape' } })
    expect(validateRaceTrace([], totalTicks())).toMatchObject({ ok: false, error: { code: 'count' } })
    expect(validateRaceTrace([[3, 0, 0]], totalTicks())).toMatchObject({ ok: false, error: { code: 'first-tick' } })
    expect(validateRaceTrace([[0, 0, 0], [-1, 0, 1]], totalTicks())).toMatchObject({ ok: false, error: { code: 'order' } })
    expect(validateRaceTrace([[0, 200, 0]], totalTicks())).toMatchObject({ ok: false, error: { code: 'steer-range' } })
    expect(validateRaceTrace([[0, 0, 2 as 0]], totalTicks())).toMatchObject({ ok: false, error: { code: 'boost-value' } })
  })
})

describe('relay-race track', () => {
  it('is deterministic per seed and varies by seed', () => {
    expect(JSON.stringify(buildTrack('a'))).toBe(JSON.stringify(buildTrack('a')))
    expect(JSON.stringify(buildTrack('a'))).not.toBe(JSON.stringify(buildTrack('b')))
  })
})

describe('relay-race deterministic replay', () => {
  it('replay() equals an incrementally stepped run and is repeatable', () => {
    const trace = botTrace('race-test-1', false)
    const a = replayRaceRun({ ...cfg, inputTrace: trace })
    const b = replayRaceRun({ ...cfg, inputTrace: trace })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))

    const v = validateRaceTrace(trace, totalTicks())
    if (!v.ok) throw new Error('bad trace')
    const cur = new RaceInputCursor(v.trace)
    let st = createRaceState(cfg)
    while (st.finished === 0) st = stepRace(st, cur.at(st.tick), st.tick)
    expect(st.finishTick).toBe(a.ticks)
    expect(a.finished).toBe(true)
    expect(a.timeSeconds).toBeGreaterThan(8)
    expect(a.timeSeconds).toBeLessThan(70)
  })

  it('a different line produces a different time and hash', () => {
    const safe = replayRaceRun({ ...cfg, inputTrace: botTrace('race-test-1', false) })
    const risk = replayRaceRun({ ...cfg, inputTrace: botTrace('race-test-1', true) })
    expect(risk.resultHash).not.toBe(safe.resultHash)
  })

  it('one changed steer sample changes the result hash', () => {
    const trace = botTrace('race-test-1', false) as [number, number, 0 | 1][]
    const tampered = trace.map((s, i) => (i === 3 ? [s[0], Math.max(-64, s[1] - 5), s[2]] as [number, number, 0 | 1] : s))
    expect(replayRaceRun({ ...cfg, inputTrace: tampered }).resultHash).not.toBe(
      replayRaceRun({ ...cfg, inputTrace: trace }).resultHash,
    )
  })
})
