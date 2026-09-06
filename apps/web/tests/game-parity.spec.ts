import { test, expect } from '@playwright/test'

test('committed replay corpus matches exact browser bytes', async ({ page }) => {
  await page.goto('/play')
  const result = await page.evaluate(async (prefix) => {
    const engine: typeof import('../../../packages/game-engine/src/index') = await import(/* @vite-ignore */ `${prefix}src/index.ts`)
    const cases = await (await fetch(`${prefix}tests/corpus/cases.json`)).json() as Array<Parameters<typeof engine.replay>[0] & { id: string }>
    const expected = await (await fetch(`${prefix}tests/corpus/expected.json`)).json() as Array<{ id: string; score: number; breakdown: unknown; resultHash: string; rulesHash: string }>
    const failures: string[] = []
    for (const [index, entry] of cases.entries()) {
      const actual = engine.replay(entry)
      const snapshot = expected[index]
      if (!snapshot || snapshot.id !== entry.id || JSON.stringify(actual) !== JSON.stringify({ score: snapshot.score, breakdown: snapshot.breakdown, resultHash: snapshot.resultHash, rulesHash: snapshot.rulesHash })) failures.push(entry.id)
    }
    return { count: cases.length, failures }
  }, `/@fs${decodeURIComponent(new URL('../../../packages/game-engine/', import.meta.url).pathname)}`)
  expect(result.count).toBeGreaterThanOrEqual(200)
  expect(result.failures).toEqual([])
  console.log(`Browser corpus parity: ${result.count}/${result.count} exact replay results`)
})
