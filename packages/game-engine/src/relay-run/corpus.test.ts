import { describe, expect, it } from 'vitest'
import cases from '../../tests/relay-corpus/cases.json'
import expected from '../../tests/relay-corpus/expected.json'
import { replayRelayRun, type RelayInputTrace, type RelayReplayConfig } from './index'

// Immutable relay-run (engine v2) determinism corpus. Runs in Node and, via
// tests/parity/vitest.config.mts, inside isolated workerd. Exact score /
// breakdown / resultHash snapshots; a sim, route or scoring change must break
// these.
describe('relay-run v2 determinism corpus', () => {
  it('covers varied seeds, leg numbers, regions and carry-states', () => {
    expect(cases).toHaveLength(96)
    expect(new Set(cases.map((c) => c.seed)).size).toBe(96)
    expect(cases.some((c) => c.prevLeg === null)).toBe(true)
    expect(cases.some((c) => c.prevLeg !== null)).toBe(true)
  })

  for (const [i, entry] of cases.entries()) {
    it(`${entry.id}: exact score / breakdown / resultHash, repeated`, () => {
      const snapshot = expected[i]
      if (!snapshot) throw new Error(`missing snapshot ${entry.id}`)
      const { id: _id, inputTrace, ...config } = entry
      void _id
      const args = { ...config, inputTrace: inputTrace as unknown as RelayInputTrace } as unknown as RelayReplayConfig
      const a = replayRelayRun(args)
      const b = replayRelayRun(args)
      const baseline = JSON.stringify({
        score: snapshot.score, breakdown: snapshot.breakdown, resultHash: snapshot.resultHash, ticks: snapshot.ticks,
      })
      expect(JSON.stringify({ score: a.score, breakdown: a.breakdown, resultHash: a.resultHash, ticks: a.ticks })).toBe(baseline)
      expect(a.resultHash).toBe(b.resultHash)
    })
  }
})
