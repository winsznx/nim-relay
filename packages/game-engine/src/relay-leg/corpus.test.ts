import { describe, expect, it } from 'vitest'
import { CORPUS_SIZE, corpusCase, corpusConfig, corpusPolicy, type GoldenEntry } from './corpus-cases'
import { finalize, replay } from './result'
import { playLeg } from './test-bots'
import { MAX_TICKS } from './types'
import golden from './golden.json'

const entries: readonly GoldenEntry[] = golden

describe('relay leg v6 200-leg replay corpus', () => {
  it('pins one golden result per corpus leg', () => {
    expect(entries).toHaveLength(CORPUS_SIZE)
  })

  for (let index = 0; index < CORPUS_SIZE; index++) {
    const entry = corpusCase(index)
    const label = `${entry.base.world} t${entry.base.tier} ${entry.style} ghost:${entry.ghost} tether:${entry.base.tetherSaves}`
    it(`leg ${index}: ${label}`, () => {
      // #given a leg played live by a scripted courier
      const config = corpusConfig(entry)
      const live = playLeg(config, corpusPolicy(entry))
      // #when the server replays the recorded trace
      const verified = replay({ ...config, inputTrace: live.trace })
      // #then the replay matches the live finish and the pinned golden result
      expect(verified).toEqual(finalize(live.state, live.trace))
      expect({ resultHash: verified.resultHash, ticks: verified.ticks, score: verified.score }).toEqual(entries[index])
      expect(verified.ticks).toBeLessThanOrEqual(MAX_TICKS)
      if (entry.style !== 'sloppy' && entry.style !== 'idle') expect(verified.completed).toBe(true)
      else expect(verified.completed || verified.failed).toBe(true)
    })
  }
})
