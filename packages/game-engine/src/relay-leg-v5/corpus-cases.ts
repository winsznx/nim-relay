import { goodBot, idleBot, sloppyBot, weaveBot, type Policy } from './test-bots'
import { MAX_OPENING_FLOW, WORLDS, type Config, type Tier } from './types'

/**
 * The golden replay corpus: 40 legs per world, cycling tiers, opening FLOW and
 * play styles so every combination of tier and style appears in every world.
 * Shared by corpus.test.ts and tests/relay-leg-corpus/generate.ts.
 */

export const CORPUS_SIZE = 200

export type CorpusStyle = 'good-safe' | 'good-risk' | 'sloppy' | 'weave' | 'idle'
const STYLES: readonly CorpusStyle[] = ['good-safe', 'good-risk', 'sloppy', 'weave']

export interface CorpusCase {
  index: number
  config: Config
  style: CorpusStyle
}

export interface GoldenEntry {
  resultHash: string
  ticks: number
  score: number
}

export function corpusCase(index: number): CorpusCase {
  const round = Math.trunc(index / WORLDS.length)
  const config: Config = {
    engineVersion: '5',
    challenge: 'relay-leg',
    challengeVersion: '5',
    seed: `relay-leg-golden-${index}`,
    world: WORLDS[index % WORLDS.length]!,
    tier: (round % 3) as Tier,
    openingFlow: (index * 2749) % (MAX_OPENING_FLOW + 1),
  }
  // Every 13th leg is hands-off so the corpus pins the no-input path too.
  const style = index % 13 === 12 ? 'idle' : STYLES[round % STYLES.length]!
  return { index, config, style }
}

export function corpusPolicy(entry: CorpusCase): Policy {
  switch (entry.style) {
    case 'good-safe':
      return goodBot('safe')
    case 'good-risk':
      return goodBot('risk')
    case 'sloppy':
      return sloppyBot(entry.index % 2 === 0 ? 'safe' : 'risk')
    case 'weave':
      return weaveBot(entry.index * 7)
    case 'idle':
      return idleBot
  }
}
