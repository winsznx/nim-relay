import { describe, expect, it } from 'vitest'
import cases from '../../tests/relay-race-corpus/cases.json'
import expected from '../../tests/relay-race-corpus/expected.json'
import { replayRaceRun, type RaceInputTrace, type RaceReplayConfig } from './index'

describe('relay-race v3 determinism corpus', () => {
  it('covers many seeds and play styles', () => {
    expect(cases).toHaveLength(64)
    expect(new Set(cases.map((c) => c.seed)).size).toBe(64)
  })
  for (const [i, entry] of cases.entries()) {
    it(`${entry.id}: exact time / hash, repeated`, () => {
      const snap = expected[i]
      if (!snap) throw new Error('missing snapshot')
      const { id: _id, inputTrace, ...config } = entry
      void _id
      const args = { ...config, inputTrace: inputTrace as unknown as RaceInputTrace } as unknown as RaceReplayConfig
      const a = replayRaceRun(args)
      expect({ timeMs: a.timeMs, resultHash: a.resultHash, ticks: a.ticks, perfectGates: a.perfectGates })
        .toEqual({ timeMs: snap.timeMs, resultHash: snap.resultHash, ticks: snap.ticks, perfectGates: snap.perfectGates })
      expect(replayRaceRun(args).resultHash).toBe(a.resultHash)
    })
  }
})
