import { test, expect, type Page } from '@playwright/test'

const artifact = (name: string) => decodeURIComponent(new URL(`../../../artifacts/${name}`, import.meta.url).pathname)

const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
})
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]))

async function start(page: Page, challenge = 'Stabilize', touch = false) {
  await page.goto('/play')
  const choice = page.getByRole('button', { name: challenge, exact: true })
  const startButton = page.getByRole('button', { name: 'Start challenge', exact: true })
  if (touch) { await choice.tap(); await startButton.tap() }
  else { await choice.click(); await startButton.click() }
  await expect(page.getByTestId('countdown')).toBeVisible()
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 6_000 })
}

async function finishWithKeyboard(page: Page) {
  const deadline = Date.now() + 30_000
  while (!(await page.getByTestId('results').isVisible()) && Date.now() < deadline) {
    const field = await page.getByTestId('game-stage').evaluate(element => ({ ...element.dataset }))
    if (['stabilize', 'slipstream', 'redline'].includes(field.challenge ?? '')) {
      const hold = Number(field.position) + Number(field.velocity) * 8 < Number(field.target)
      if (hold) await page.keyboard.down('Space'); else await page.keyboard.up('Space')
      await page.waitForTimeout(80)
    } else {
      await page.keyboard.down('Space')
      await page.waitForTimeout(180)
      await page.keyboard.up('Space')
      await page.waitForTimeout(180)
    }
  }
  await page.keyboard.up('Space')
  await expect(page.getByTestId('results')).toBeVisible()
  await page.getByText('Run trace & performance', { exact: true }).click()
  const trace = JSON.parse(await page.getByTestId('input-trace').innerText()) as { inputTrace: number[][] }
  expect(trace.inputTrace.length).toBeGreaterThan(10)
  expect(trace.inputTrace.some((event) => event[1] === 1)).toBe(true)
  expect(trace.inputTrace.some((event) => event[1] === 0)).toBe(true)
  console.log('Run frame metrics:', await page.getByTestId('frame-metrics').textContent())
  await page.getByText('Run trace & performance', { exact: true }).click()
}

test('desktop plays a real run, pauses, resumes, restarts, and renders a recorded ghost', async ({ page }) => {
  await start(page)
  await page.keyboard.down('Space')
  await expect(page.getByTestId('action-pad')).toHaveAttribute('data-held', 'true')
  await page.keyboard.press('KeyP')
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await expect(page.getByTestId('action-pad')).toHaveAttribute('data-held', 'false')
  const pausedTick = await page.getByTestId('game-stage').getAttribute('data-tick')
  await page.waitForTimeout(400)
  expect(await page.getByTestId('game-stage').getAttribute('data-tick')).toBe(pausedTick)
  await page.keyboard.up('Space')
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.waitForTimeout(400)
  await page.keyboard.down('Space')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await expect(page.getByTestId('action-pad')).toHaveAttribute('data-held', 'false')
  await page.keyboard.up('Space')
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.keyboard.press('KeyR')
  await expect(page.getByTestId('countdown')).toBeVisible()
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 6_000 })
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: artifact('game-stabilize.png') })
  await finishWithKeyboard(page)
  await page.screenshot({ path: artifact('game-results.png'), fullPage: true })
  await page.getByRole('button', { name: 'Play again', exact: true }).click()
  await expect(page.getByTestId('countdown')).toBeHidden({ timeout: 6_000 })
  await expect(page.getByTestId('ghost')).toBeVisible()
  await page.waitForTimeout(2_000)
  await page.keyboard.down('Space')
  await page.waitForTimeout(400)
  await page.keyboard.up('Space')
  await page.screenshot({ path: artifact('game-ghost.png') })
  await finishWithKeyboard(page)
  await expect(page.getByText(/vs previous run/)).toBeVisible()
})

for (const [name, slug] of [['Slipstream', 'slipstream'], ['Pulse Sync', 'pulse-sync'], ['Sling', 'sling'], ['Redline', 'redline']] as const) {
  test(`${name} renders and completes through real keyboard input`, async ({ page }) => {
    await start(page, name)
    await page.keyboard.down('Space')
    await page.waitForTimeout(1_000)
    await page.keyboard.up('Space')
    await page.screenshot({ path: artifact(`game-${slug}.png`) })
    await finishWithKeyboard(page)
  })
}

test('portrait touch run preserves simultaneous fingers and clears cancelled input', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await start(page, 'Stabilize', true)
  const pad = page.getByTestId('action-pad')
  const box = await pad.boundingBox()
  if (!box) throw new Error('Action pad has no layout box')
  const session = await context.newCDPSession(page)
  const first = { x: box.x + box.width / 3, y: box.y + box.height / 2, id: 1 }
  const second = { x: box.x + box.width * 2 / 3, y: box.y + box.height / 2, id: 2 }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] })
  await expect(pad).toHaveAttribute('data-held', 'true')
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] })
  await expect(pad).toHaveAttribute('data-held', 'true')
  await page.waitForTimeout(200)
  await expect(pad).toHaveAttribute('data-held', 'true')
  await expect(page.getByTestId('game-stage')).toHaveAttribute('data-input', '1')
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(pad).toHaveAttribute('data-held', 'false')
  await expect(page.getByTestId('game-stage')).toHaveAttribute('data-input', '0')
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(pad).toHaveAttribute('data-held', 'false')
  await page.screenshot({ path: artifact('game-mobile-portrait.png') })
  const frameMeasurement = page.evaluate(() => new Promise<{ frames: number; meanMs: number; p95Ms: number }>((resolveMeasurement) => {
    const intervals: number[] = []
    let previous = 0
    const sample = (now: number) => {
      if (previous) intervals.push(now - previous)
      previous = now
      if (intervals.length < 180) requestAnimationFrame(sample)
      else {
        const sorted = [...intervals].sort((a, b) => a - b)
        resolveMeasurement({ frames: intervals.length, meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0 })
      }
    }
    requestAnimationFrame(sample)
  }))
  const deadline = Date.now() + 30_000
  while (!(await page.getByTestId('results').isVisible()) && Date.now() < deadline) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] })
    await page.waitForTimeout(200)
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(260)
  }
  await expect(page.getByTestId('results')).toBeVisible()
  await page.getByText('Run trace & performance', { exact: true }).tap()
  const trace = JSON.parse(await page.getByTestId('input-trace').innerText()) as { inputTrace: number[][] }
  expect(trace.inputTrace.length).toBeGreaterThan(20)
  expect(trace.inputTrace.some(event => event[1] === 0)).toBe(true)
  console.log('Touch run frame metrics:', await page.getByTestId('frame-metrics').textContent())
  console.log('Portrait Chromium headless RAF sample (not iOS device FPS):', JSON.stringify(await frameMeasurement))
  expect(errors).toEqual([])
  await context.close()
})
