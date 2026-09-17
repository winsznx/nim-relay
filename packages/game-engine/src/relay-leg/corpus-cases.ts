import { deriveGhostline } from './ghostline'
import { idleBot, playLeg, skilledBot, sloppyBot, type Policy } from './test-bots'
import { MAX_OPENING_FLOW, WORLDS, type Config, type Tier } from './types'

/**
 * The golden replay corpus: 40 legs per world, cycling tiers, opening FLOW, play styles,
 * ghostlines and tether saves, so every world sees every tier and style with and without a
 * ghost. Shared by corpus.test.ts and tests/relay-leg-corpus/generate.ts.
 */

export const CORPUS_SIZE = 200

export type CorpusStyle = 'skilled-safe' | 'skilled-risk' | 'sloppy' | 'idle'
const STYLES: readonly CorpusStyle[] = ['skilled-safe', 'skilled-risk', 'sloppy']

/**
 * rival: a skilled courier who took every risk from full opening FLOW, so it leads early.
 * sloppy: a sloppy courier from zero opening FLOW, usually behind.
 */
export type CorpusGhost = 'none' | 'rival' | 'sloppy'

export interface CorpusCase {
  index: number
  /** The leg without its ghostline; `corpusConfig` derives the ghost. */
  base: Config
  style: CorpusStyle
  ghost: CorpusGhost
}

export interface GoldenEntry {
  resultHash: string
  ticks: number
  score: number
}

export function corpusCase(index: number): CorpusCase {
  const round = Math.trunc(index / WORLDS.length)
  const base: Config = {
    engineVersion: '6',
    challenge: 'relay-leg',
    challengeVersion: '6',
    seed: `relay-leg-golden-${index}`,
    world: WORLDS[index % WORLDS.length]!,
    tier: (round % 3) as Tier,
    openingFlow: (index * 2749) % (MAX_OPENING_FLOW + 1),
    tetherSaves: index % 7 === 3 ? 0 : 1,
    ghostline: null,
  }
  // Every 13th leg is hands-off so the corpus pins the no-input path too.
  const style = index % 13 === 12 ? 'idle' : STYLES[round % STYLES.length]!
  const ghost: CorpusGhost = index % 2 === 0 ? 'none' : round % 2 === 0 ? 'rival' : 'sloppy'
  return { index, base, style, ghost }
}

/** The full leg config, with the ghostline derived from the ghost's own verified run on the same track. */
export function corpusConfig(entry: CorpusCase): Config {
  if (entry.ghost === 'none') return entry.base
  const ghostConfig: Config = entry.ghost === 'rival'
    ? { ...entry.base, openingFlow: MAX_OPENING_FLOW, tetherSaves: 1 }
    : { ...entry.base, openingFlow: 0, tetherSaves: 1 }
  const ghostPolicy = entry.ghost === 'rival' ? skilledBot('risk') : sloppyBot('safe')
  const { trace } = playLeg(ghostConfig, ghostPolicy)
  return { ...entry.base, ghostline: deriveGhostline(ghostConfig, trace) }
}

export function corpusPolicy(entry: CorpusCase): Policy {
  switch (entry.style) {
    case 'skilled-safe':
      return skilledBot('safe')
    case 'skilled-risk':
      return skilledBot('risk')
    case 'sloppy':
      return sloppyBot(entry.index % 2 === 0 ? 'safe' : 'risk')
    case 'idle':
      return idleBot
  }
}
