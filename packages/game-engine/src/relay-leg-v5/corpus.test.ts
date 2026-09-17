import { describe, expect, it } from 'vitest'
import { CORPUS_SIZE, corpusCase, corpusPolicy, type GoldenEntry } from './corpus-cases'
import { finalize, replay } from './result'
import { playLeg } from './test-bots'
import golden from './golden.json'

const entries: readonly GoldenEntry[] = golden

describe('relay leg v5 200-leg replay corpus', () => {
  it('pins one golden result per corpus leg', () => {
    expect(entries).toHaveLength(CORPUS_SIZE)
  })

  for (let index = 0; index < CORPUS_SIZE; index++) {
    const entry = corpusCase(index)
    it(`leg ${index}: ${entry.config.world} t${entry.config.tier} ${entry.style}`, () => {
      // #given a leg played live by a scripted courier
      const live = playLeg(entry.config, corpusPolicy(entry))
      // #when the server replays the recorded trace
      const verified = replay({ ...entry.config, inputTrace: live.trace })
      // #then the replay matches the live finish and the pinned golden result
      expect(verified).toEqual(finalize(live.state, live.trace))
      expect({ resultHash: verified.resultHash, ticks: verified.ticks, score: verified.score }).toEqual(entries[index])
      expect(verified.completed).toBe(true)
      expect(verified.ticks).toBeGreaterThan(30 * 60)
      expect(verified.ticks).toBeLessThan(75 * 60)
    })
  }
})
