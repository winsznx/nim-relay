import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CORPUS_SIZE, corpusCase, corpusPolicy, type GoldenEntry } from '../../src/relay-leg-v5/corpus-cases'
import { replay } from '../../src/relay-leg-v5/result'
import { playLeg } from '../../src/relay-leg-v5/test-bots'

// Regenerate after an intentional rule or content change:
//   pnpm --filter @nim-relay/game-engine exec tsx tests/relay-leg-v5-corpus/generate.ts
const golden: GoldenEntry[] = Array.from({ length: CORPUS_SIZE }, (_, index) => {
  const entry = corpusCase(index)
  const { trace } = playLeg(entry.config, corpusPolicy(entry))
  const result = replay({ ...entry.config, inputTrace: trace })
  return { resultHash: result.resultHash, ticks: result.ticks, score: result.score }
})

const target = fileURLToPath(new URL('../../src/relay-leg-v5/golden.json', import.meta.url))
writeFileSync(target, `[\n${golden.map(entry => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`)
console.log(`Wrote ${golden.length} relay leg golden results to ${target}`)
