import { test, expect } from '@playwright/test'

const artifact = (n: string) => decodeURIComponent(new URL(`../../../artifacts/${n}`, import.meta.url).pathname)

test('relay-race-v3: full race, live sim matches canonical replay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/lab/relay-race-v3')
  await expect(page.getByText('WebGL error')).toBeHidden()
  await page.getByRole('button', { name: 'Race', exact: true }).click()

  const w = 430
  const midY = 450

  const results = page.getByTestId('results')
  const deadline = Date.now() + 70_000
  let f = 0
  await page.mouse.move(w / 2, midY)
  await page.mouse.down()
  while (!(await results.isVisible().catch(() => false)) && Date.now() < deadline) {
    f++
    await page.mouse.move(w * (0.5 + 0.32 * Math.sin(f / 8)), midY)
    await page.waitForTimeout(55)
  }
  await page.mouse.up()

  await expect(results).toBeVisible({ timeout: 6_000 })
  await page.screenshot({ path: artifact('relay-race-v3-results.png') })
  await page.getByText('lab instrumentation', { exact: true }).click()
  const report = JSON.parse(await page.getByTestId('run-report').innerText()) as {
    completed: boolean
    timeSeconds: number
    frameMs: { mean: number; frames: number }
    triangles: number
    drawCalls: number
    ghostResult: string
  }
  expect(report.completed).toBe(true)
  expect(report.frameMs.frames).toBeGreaterThan(200)
  await expect(page.locator('.rc-results')).not.toContainText('replay divergence')
  await expect(page.locator('.rc-results details p')).toContainText('matched')

  // eslint-disable-next-line no-console
  console.log('RELAY_RACE_REPORT', JSON.stringify(report))
  expect(errors).toEqual([])
})
