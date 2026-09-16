import { expect, test, type Page } from '@playwright/test'

const SHOTS = '/tmp/nim-relay-leg/shots'
const WORLDS = ['coast', 'metro', 'alpine', 'solar', 'ocean'] as const
const HIGH_TIER_CALL_BUDGET = 150
const LOW_TIER_CALL_BUDGET = 70

test.describe.configure({ mode: 'serial' })

interface SceneStats {
  tier: string
  calls: number
}

function isSceneStats(value: unknown): value is SceneStats {
  return typeof value === 'object' && value !== null && 'calls' in value && typeof value.calls === 'number' && 'tier' in value && typeof value.tier === 'string'
}

async function sceneStats(page: Page): Promise<SceneStats | null> {
  const value: unknown = await page.evaluate(() => Reflect.get(window, '__legStats'))
  return isSceneStats(value) ? value : null
}

function collectProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', error => problems.push(error.message))
  return problems
}

for (const world of WORLDS) {
  test(`${world}: bot leg from arrival to arrival results`, async ({ page }) => {
    // #given a fresh leg with the lookahead bot racing a bot ghost
    const problems = collectProblems(page)
    await page.goto(`/dev/leg?world=${world}&bot=1&ghost=1&quality=high`)

    // #when the opening hands over to the race
    await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible({ timeout: 90_000 })
    const racingAt = Date.now()
    await page.waitForTimeout(3_000)
    await page.screenshot({ path: `${SHOTS}/${world}-03s.png` })
    await page.waitForTimeout(Math.max(0, 15_000 - (Date.now() - racingAt)))
    await page.screenshot({ path: `${SHOTS}/${world}-15s.png` })
    const racingStats = await sceneStats(page)

    // #then the leg finishes with verified arrival results, within budget and without errors
    await expect(page.locator('main.leg[data-phase="finished"]')).toBeVisible({ timeout: 240_000 })
    const results = page.getByRole('region', { name: 'Arrival results' })
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results.getByText('ARRIVAL', { exact: true })).toBeVisible()
    await expect(page.getByText('RUN COULD NOT BE VERIFIED')).toHaveCount(0)
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: `${SHOTS}/${world}-finish.png` })
    expect(racingStats?.tier).toBe('high')
    expect(racingStats?.calls ?? Number.POSITIVE_INFINITY).toBeLessThan(HIGH_TIER_CALL_BUDGET)
    expect(problems).toEqual([])
  })
}

/** Where /dev/leg?echoes=1 stands its first echo, a ghost record, and how far ahead of the courier to capture it. */
const LAB_ECHO_METRES = 150
const ECHO_CAPTURE_AHEAD = 50

for (const world of ['coast', 'metro'] as const) {
  test(`${world}: Relay Echoes stand beside the track and speak in the arrival`, async ({ page }) => {
    // #given a leg on a sector with echoes, raced by the lookahead bot
    const problems = collectProblems(page)
    await page.goto(`/dev/leg?world=${world}&bot=1&ghost=1&quality=high&echoes=1`)

    // #when the arrival plays
    const remembered = page.getByText('THIS SECTOR REMEMBERS: HANDOFF 50, NEAR-MISS LEGEND · YUKI')
    await expect(remembered).toBeVisible({ timeout: 90_000 })
    await page.screenshot({ path: `${SHOTS}/${world}-echo-arrival.png` })

    // #and the courier closes on the ghost record echo
    await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible({ timeout: 90_000 })
    await page.waitForFunction(metres => Number(Reflect.get(window, '__legDist') ?? 0) >= metres, LAB_ECHO_METRES - ECHO_CAPTURE_AHEAD, { timeout: 90_000 })
    await page.screenshot({ path: `${SHOTS}/${world}-echo-ahead.png` })
    const stats = await sceneStats(page)

    // #then the race runs on within the draw-call budget and without errors
    await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible()
    expect(stats?.calls ?? Number.POSITIVE_INFINITY).toBeLessThan(HIGH_TIER_CALL_BUDGET)
    expect(problems).toEqual([])
  })
}

test('low tier stays inside the phone draw-call budget', async ({ page }) => {
  // #given the densest world on the low tier
  const problems = collectProblems(page)
  await page.goto('/dev/leg?world=metro&bot=1&ghost=1&quality=low&mode=practice')

  // #when the race is under way
  await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(8_000)
  const stats = await sceneStats(page)
  await page.screenshot({ path: `${SHOTS}/metro-low-tier.png` })

  // #then it draws in fewer calls than the low-tier budget
  expect(stats?.tier).toBe('low')
  expect(stats?.calls ?? Number.POSITIVE_INFINITY).toBeLessThan(LOW_TIER_CALL_BUDGET)
  expect(problems).toEqual([])
})
