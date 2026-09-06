import { test, expect } from '@playwright/test'

const artifact = (name: string) => decodeURIComponent(new URL(`../../../artifacts/${name}`, import.meta.url).pathname)

/**
 * Phase 3.6 slice smoke: play a full Relay Run in real time through synthetic
 * input, reach the result screen, and prove the live sim matched the canonical
 * server-side replay (no divergence). Also captures the instrumentation JSON
 * and a screenshot.
 */
test('relay-run-v2 lab plays a full run and the live sim matches canonical replay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/lab/relay-run-v2')
  await page.getByRole('button', { name: 'Start run', exact: true }).click()
  await expect(page.locator('.rr-overlay strong')).toBeVisible() // countdown

  // Drive the run: sweep the steer zone and pulse the action, for the whole run.
  const zone = page.locator('.rr-zone')
  const box = await zone.boundingBox()
  if (!box) throw new Error('no control zone')
  const deadline = Date.now() + 60_000
  let frame = 0
  const results = page.getByTestId('results')
  while (!(await results.isVisible().catch(() => false)) && Date.now() < deadline) {
    frame++
    const t = frame % 40
    const x = box.x + box.width * (0.5 + 0.42 * Math.sin(frame / 6))
    const y = box.y + box.height / 2
    if (t === 0) { await page.mouse.move(x, y); await page.mouse.down() }
    else if (t === 20) await page.mouse.up()
    await page.mouse.move(x, y)
    await page.waitForTimeout(70)
  }

  await expect(results).toBeVisible({ timeout: 5_000 })
  await page.getByText('Instrumentation', { exact: true }).click()
  await expect(page.getByTestId('run-report')).toBeVisible({ timeout: 5_000 })
  const report = JSON.parse(await page.getByTestId('run-report').innerText()) as {
    completed: boolean
    frameMs: { mean: number; p95: number; frames: number }
    inputLatencyMs: { mean: number }
  }
  expect(report.completed).toBe(true)
  expect(report.frameMs.frames).toBeGreaterThan(120)

  // No "DIVERGENCE" marker: the live run and the canonical replayRelayRun() agree.
  await expect(page.locator('.rr-results > p').first()).not.toContainText('DIVERGENCE')
  await expect(page.locator('.rr-note')).toContainText('matched')

  await page.screenshot({ path: artifact('relay-run-v2-lab.png'), fullPage: false })
  // eslint-disable-next-line no-console
  console.log('RELAY_LAB_REPORT', JSON.stringify(report))
  expect(errors).toEqual([])
})
