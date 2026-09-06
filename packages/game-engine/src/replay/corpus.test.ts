import { describe, expect, it } from 'vitest'
import cases from '../../tests/corpus/cases.json'
import expected from '../../tests/corpus/expected.json'
import { CHALLENGE_IDS, createState, step, totalTicks } from '../simulation'
import { inputAtTick, validateInputTrace } from '../input'
import { scoreState } from '../scoring'
import { replay, resultForState } from './index'

export function corpusConfig(entry: typeof cases[number]) {
  const challenge = CHALLENGE_IDS.find(id => id === entry.challenge)
  const trace = validateInputTrace(entry.inputTrace, entry.durationMs)
  if (!challenge || !trace.ok) throw new Error(`Invalid corpus fixture ${entry.id}`)
  return { engineVersion: entry.engineVersion, challenge, challengeVersion: entry.challengeVersion,
    seed: entry.seed, difficulty: entry.difficulty, durationMs: entry.durationMs, inputTrace: trace.trace }
}

describe('immutable v1 determinism corpus', () => {
  it('covers every challenge, varied seeds, durations, difficulties and input patterns', () => {
    expect(cases).toHaveLength(200)
    expect(expected).toHaveLength(200)
    for (const id of CHALLENGE_IDS) expect(cases.filter(entry => entry.challenge === id)).toHaveLength(40)
    expect(new Set(cases.map(entry => entry.seed)).size).toBe(200)
    expect(new Set(cases.map(entry => entry.durationMs)).size).toBe(4)
    expect(new Set(cases.map(entry => entry.difficulty)).size).toBe(10)
  })
  for (const [index, entry] of cases.entries()) {
    it(`${entry.id}: exact score, breakdown and result hash, repeated and incrementally stepped`, () => {
      const args = corpusConfig(entry)
      const snapshot = expected[index]
      if (!snapshot) throw new Error(`Missing snapshot ${entry.id}`)
      const baseline = JSON.stringify({ score: snapshot.score, breakdown: snapshot.breakdown, resultHash: snapshot.resultHash, rulesHash: snapshot.rulesHash })
      const result = replay(args)
      expect(JSON.stringify(result)).toBe(baseline)
      expect(JSON.stringify(replay(args))).toBe(baseline)
      let state = createState(args)
      for (let tick = 0; tick < totalTicks(args); tick++) state = step(state, inputAtTick(args.inputTrace, tick), tick)
      expect(scoreState(state)).toEqual({ score: result.score, breakdown: result.breakdown })
      expect(resultForState(state, args.inputTrace)).toEqual(result)
      expect(Object.values(state.metrics).every(Number.isSafeInteger)).toBe(true)
      expect(Number.isSafeInteger(state.position)).toBe(true)
      expect(state.tick).toBe(totalTicks(args))
    })
  }
})
