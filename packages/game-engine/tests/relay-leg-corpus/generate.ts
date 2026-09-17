import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CORPUS_SIZE, corpusCase, corpusConfig, corpusPolicy, type GoldenEntry } from '../../src/relay-leg/corpus-cases'
import { replay } from '../../src/relay-leg/result'
import { playLeg } from '../../src/relay-leg/test-bots'

// Regenerate after an intentional rule or content change:
//   pnpm --filter @nim-relay/game-engine exec tsx tests/relay-leg-corpus/generate.ts
const golden: GoldenEntry[] = Array.from({ length: CORPUS_SIZE }, (_, index) => {
  const entry = corpusCase(index)
  const config = corpusConfig(entry)
  const { trace } = playLeg(config, corpusPolicy(entry))
  const result = replay({ ...config, inputTrace: trace })
  return { resultHash: result.resultHash, ticks: result.ticks, score: result.score }
})

const target = fileURLToPath(new URL('../../src/relay-leg/golden.json', import.meta.url))
writeFileSync(target, `[\n${golden.map(entry => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`)
console.log(`Wrote ${golden.length} relay leg golden results to ${target}`)
