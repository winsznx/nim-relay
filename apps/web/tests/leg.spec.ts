import { expect, test, type Page } from '@playwright/test'
import { relayLeg } from '@nim-relay/game-engine'

const SHOTS = '/tmp/nim-relay-leg/shots'
const WORLDS = ['coast', 'metro', 'alpine', 'solar', 'ocean'] as const
const HIGH_TIER_CALL_BUDGET = 150
const LOW_TIER_CALL_BUDGET = 70
/** One animation frame on the paused clock. */
const FRAME_MS = 17

test.describe.configure({ mode: 'serial' })

interface SceneStats {
  tier: string
  calls: number
}

/** What /dev/leg reports about the courier on the last rendered frame (see LegLab). */
interface LegFrame {
  dist: number
  motion: string
  lane: number
  targetLane: number
  rushTicks: number
  edgeSide: number
  running: boolean
  ghostDelta: number | null
  drafting: boolean
}

function isLegFrame(value: unknown): value is LegFrame {
  return typeof value === 'object' && value !== null && 'motion' in value && typeof value.motion === 'string' && 'targetLane' in value && typeof value.targetLane === 'number'
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

/**
 * Opens a lab leg on a controllable clock. The clock runs in real time until a test pauses it, then
 * advances one frame at a time, so brief moments (a lane change, the first frames of a grind) are
 * captured exactly however slowly software WebGL renders. The dev server's HMR socket is mocked so
 * edits elsewhere in the repo never reload the page mid-leg.
 */
async function openLeg(page: Page, query: string): Promise<void> {
  await page.routeWebSocket(/.*/, () => {})
  await page.clock.install()
  await page.goto(`/dev/leg?${query}`)
}

/** Runs in real time until the lab reports `near`, then pauses the clock. */
async function pauseNear(page: Page, near: string, timeout = 240_000): Promise<void> {
  await page.waitForFunction(`(() => { const f = window.__legFrame; return !!f && (${near}) })()`, null, { timeout, polling: 40 })
  // The page clock keeps running while the pause is requested, so the target can already be past; re-read it and retry
  // further ahead each time, since a slow software-rendered frame can outlast the round trip.
  for (let attempt = 1; ; attempt++) {
    const now = await page.evaluate(() => Date.now())
    try {
      await page.clock.pauseAt(now + FRAME_MS * 2 + attempt * 120)
      return
    } catch (error) {
      if (attempt >= 12 || !String(error).includes('past')) throw error
    }
  }
}

/** Steps single frames on the paused clock until the lab reports `moment`, then `extra` frames more. */
async function stepUntil(page: Page, moment: string, extra = 0, maxFrames = 3000): Promise<LegFrame> {
  for (let frame = 0; frame < maxFrames; frame++) {
    const hit: unknown = await page.evaluate(`(() => { const f = window.__legFrame; return !!f && (${moment}) })()`)
    if (hit === true) break
    if (frame === maxFrames - 1) throw new Error(`No frame matched: ${moment}`)
    await page.clock.runFor(FRAME_MS)
  }
  for (let frame = 0; frame < extra; frame++) await page.clock.runFor(FRAME_MS)
  const value: unknown = await page.evaluate(() => Reflect.get(window, '__legFrame'))
  if (!isLegFrame(value)) throw new Error('The leg lab reported no frame')
  return value
}

for (const world of WORLDS) {
  test(`${world}: bot leg from arrival to leg results`, async ({ page }) => {
    // #given a fresh relay leg with the skilled bot racing a bot ghost
    const problems = collectProblems(page)
    await openLeg(page, `world=${world}&bot=1&ghost=1&quality=high`)

    // #when the opening hands over to the race
    await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible({ timeout: 90_000 })
    const racingAt = Date.now()
    await page.waitForTimeout(3_000)
    await page.screenshot({ path: `${SHOTS}/${world}-03s.png` })
    await page.waitForTimeout(Math.max(0, 15_000 - (Date.now() - racingAt)))
    await page.screenshot({ path: `${SHOTS}/${world}-15s.png` })
    const racingStats = await sceneStats(page)

    // #then the leg completes with verified results, within budget and without errors
    await expect(page.locator('main.leg[data-phase="finished"]')).toBeVisible({ timeout: 240_000 })
    const results = page.getByRole('region', { name: 'Arrival results' })
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results.getByText('LEG COMPLETE', { exact: true })).toBeVisible()
    await expect(page.getByText('RUN COULD NOT BE VERIFIED')).toHaveCount(0)
    await page.waitForTimeout(1_500)
    await page.screenshot({ path: `${SHOTS}/${world}-finish.png` })
    expect(racingStats?.tier).toBe('high')
    expect(racingStats?.calls ?? Number.POSITIVE_INFINITY).toBeLessThan(HIGH_TIER_CALL_BUDGET)
    expect(problems).toEqual([])
  })
}

test('metro: mission header, a lane change, drafting the Ghostline, Relay Rush and the pass', async ({ page }) => {
  // #given a relay leg carrying Aurora from Mariana to Yasmine, raced by the bot against Mariana's ghost
  const problems = collectProblems(page)
  await openLeg(page, 'world=metro&bot=1&ghost=1&mission=1&pass=1&quality=high')

  // #when the catch lands, the mission header names the delivery
  await expect(page.getByText('FROM TIM', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('“Keep it gold for Lisbon”')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/v6-arrival-note.png` })
  await expect(page.getByRole('heading', { name: 'DELIVER AURORA TO YASMINE' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/^PREVIOUS RUNNER MARIANA · \d+\.\d{2}s$/)).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/v6-mission-header.png` })

  // #and the courier changes lanes: captured mid-transition
  await pauseNear(page, 'f.dist > 40')
  const shifting = await stepUntil(page, "f.motion === 'riding' && f.targetLane !== f.lane", 4)
  await page.screenshot({ path: `${SHOTS}/v6-lane-change.png` })
  expect(shifting.targetLane).not.toBe(shifting.lane)
  await expect(page.getByRole('progressbar', { name: 'Distance to the handoff gate' })).toContainText('MARIANA')

  // #and it drafts Mariana's line
  const drafting = await stepUntil(page, 'f.drafting', 20, 6000)
  await page.screenshot({ path: `${SHOTS}/v6-drafting.png` })
  expect(drafting.drafting).toBe(true)

  // #and FLOW tops out into Relay Rush
  await page.clock.resume()
  await pauseNear(page, 'f.rushTicks > 0')
  await stepUntil(page, 'f.rushTicks > 0', 40)
  await page.screenshot({ path: `${SHOTS}/v6-relay-rush.png` })
  await expect(page.getByText('RELAY RUSH', { exact: true })).toBeVisible()

  // #then the leg completes with a human verdict and the pass as the one action
  await page.clock.resume()
  const results = page.getByRole('region', { name: 'Arrival results' })
  await expect(results).toBeVisible({ timeout: 240_000 })
  await expect(results.getByText('LEG COMPLETE', { exact: true })).toBeVisible()
  await expect(results.getByText(/^(YOU BEAT MARIANA BY|MARIANA BEAT YOU BY) \d+\.\d{2}s$/)).toBeVisible()
  await expect(results.getByText('PERFECT LINES')).toBeVisible()
  await expect(results.getByText('EDGE SAVES')).toBeVisible()
  const pass = results.getByRole('button', { name: 'PASS AURORA' })
  await expect(pass).toBeVisible()
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: `${SHOTS}/v6-results-complete.png` })
  await pass.click()
  await expect(page.getByRole('region', { name: 'Handoff' })).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: `${SHOTS}/v6-results-pass.png` })
  expect(problems).toEqual([])
})

test('metro: an edge grind leans off the rail and saves', async ({ page }) => {
  // #given a leg whose bot rides into the rail from 120 m
  const problems = collectProblems(page)
  await openLeg(page, 'world=metro&scenario=grind&at=120&quality=high&mode=practice')

  // #when the courier meets the rail
  await pauseNear(page, 'f.dist > 105')
  const grinding = await stepUntil(page, "f.motion === 'grinding'", 8)
  await page.screenshot({ path: `${SHOTS}/v6-edge-grind.png` })

  // #then it grinds on one side and steers off the rail with a save
  expect(grinding.edgeSide).not.toBe(0)
  await stepUntil(page, "f.motion === 'riding'", 10)
  await page.screenshot({ path: `${SHOTS}/v6-edge-save.png` })
  expect(problems).toEqual([])
})

test('coast: a fall off an open edge, the baton tether and the respawn', async ({ page }) => {
  // #given a leg whose bot rides off the shortcut's open edge from 450 m, with a tether save left
  const problems = collectProblems(page)
  await openLeg(page, 'world=coast&scenario=fall&at=450&quality=high&mode=practice')

  // #when the courier goes over
  await pauseNear(page, 'f.dist > 440')
  await stepUntil(page, "f.motion === 'falling'", 24)
  await page.screenshot({ path: `${SHOTS}/v6-fall.png` })

  // #then the baton's tether catches and hauls the courier back, and the leg goes on
  await stepUntil(page, "f.motion === 'tethering'", 12)
  await page.screenshot({ path: `${SHOTS}/v6-tether.png` })
  const respawned = await stepUntil(page, "f.motion === 'riding'", 8)
  await page.screenshot({ path: `${SHOTS}/v6-respawn.png` })
  expect(respawned.running).toBe(true)
  expect(problems).toEqual([])
})

test('coast: a fall with no tether left fails the leg and keeps the baton', async ({ page }) => {
  // #given the same fall with no tether save left
  const problems = collectProblems(page)
  await openLeg(page, 'world=coast&scenario=failed&at=450&quality=high&mode=practice')

  // #when the courier goes over the edge
  await expect(page.locator('main.leg[data-phase="finished"]')).toBeVisible({ timeout: 240_000 })

  // #then the results say the leg failed, the baton stayed, and offer another run
  const results = page.getByRole('region', { name: 'Leg failed' })
  await expect(results).toBeVisible({ timeout: 15_000 })
  await expect(results.getByText('LEG FAILED', { exact: true })).toBeVisible()
  await expect(results.getByText('The baton is still with you.')).toBeVisible()
  await expect(results.getByRole('button', { name: 'RACE AGAIN' })).toBeVisible()
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: `${SHOTS}/v6-results-failed.png` })
  expect(problems).toEqual([])
})

/** Where /dev/leg?echoes=1 stands its first echo, a ghost record, and how far ahead of the courier to capture it. */
const LAB_ECHO_METRES = 150
const ECHO_CAPTURE_AHEAD = 50

for (const world of ['coast', 'metro'] as const) {
  test(`${world}: Relay Echoes stand beside the track and speak in the arrival`, async ({ page }) => {
    // #given a leg on a sector with echoes, raced by the bot
    const problems = collectProblems(page)
    await openLeg(page, `world=${world}&bot=1&ghost=1&quality=high&echoes=1`)

    // #when the arrival plays
    const remembered = page.getByText('THIS SECTOR REMEMBERS: HANDOFF 50, NEAR-MISS LEGEND · YUKI')
    await expect(remembered).toBeVisible({ timeout: 90_000 })
    await page.screenshot({ path: `${SHOTS}/${world}-echo-arrival.png` })

    // #and the courier closes on the ghost record echo, then on an edge save left by an earlier runner
    await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible({ timeout: 90_000 })
    await page.waitForFunction(metres => Number(Reflect.get(window, '__legDist') ?? 0) >= metres, LAB_ECHO_METRES - ECHO_CAPTURE_AHEAD, { timeout: 90_000 })
    await page.screenshot({ path: `${SHOTS}/${world}-echo-ahead.png` })
    await page.waitForFunction(metres => Number(Reflect.get(window, '__legDist') ?? 0) >= metres, LAB_ECHO_METRES + 60 - ECHO_CAPTURE_AHEAD, { timeout: 90_000 })
    await page.screenshot({ path: `${SHOTS}/${world}-echo-save.png` })
    const stats = await sceneStats(page)

    // #then the race runs on within the draw-call budget and without errors
    await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible()
    expect(stats?.calls ?? Number.POSITIVE_INFINITY).toBeLessThan(HIGH_TIER_CALL_BUDGET)
    expect(problems).toEqual([])
  })
}

/** The lab's default leg: seed dev-leg on tier 1, and a seed whose routes carry lane closures. */
const LAB_SEED = 'dev-leg'
const CLOSURE_SEED = 'closure-b'
/** Metres before a fork's split where the approach capture pauses, with the path signs ahead. */
const FORK_CAPTURE_LEAD = 130

function labTrack(world: relayLeg.World, seed = LAB_SEED): relayLeg.Track {
  return relayLeg.buildTrack({ seed, world, tier: 1 })
}

const metres = (q: number): number => Math.round(q / 65536)

async function expectWithinBudget(page: Page, budget: number): Promise<void> {
  const stats = await sceneStats(page)
  expect(stats?.calls ?? Number.POSITIVE_INFINITY).toBeLessThan(budget)
}

for (const world of WORLDS) {
  test(`${world}: the first fork splits into a railed safe path and a narrow risk path`, async ({ page }) => {
    // #given a leg on the lab track, whose first fork is known from the engine
    const problems = collectProblems(page)
    const fork = labTrack(world).forks[0]
    expect(fork).toBeDefined()
    const from = metres(fork!.from)
    await openLeg(page, `world=${world}&bot=1&quality=high&mode=practice`)

    // #when the courier approaches the split and rides into it
    await pauseNear(page, `f.dist > ${from - FORK_CAPTURE_LEAD}`)
    await page.screenshot({ path: `${SHOTS}/${world}-fork-approach.png` })
    await stepUntil(page, `f.dist > ${from + 30}`, 0, 12_000)
    await page.screenshot({ path: `${SHOTS}/${world}-fork-split.png` })

    // #then the world draws within budget and without errors
    await expectWithinBudget(page, HIGH_TIER_CALL_BUDGET)
    expect(problems).toEqual([])
  })
}

test('coast: an open edge, then the bridge break over a real gap', async ({ page }) => {
  // #given the coast lab track at full opening FLOW, so the bot is fast enough to take the relay cut
  const problems = collectProblems(page)
  const track = labTrack('coast')
  const open = track.segments.find(segment => segment.kind !== 'fork' && (segment.leftEdge === 'open' || segment.rightEdge === 'open'))
  const breakEvent = track.events.find(event => event.kind === 'bridge-break')
  const gap = breakEvent ? track.gaps.find(zone => zone.path === breakEvent.path && zone.from >= breakEvent.dist) : undefined
  expect(open).toBeDefined()
  expect(gap).toBeDefined()
  await openLeg(page, 'world=coast&scenario=rush&quality=high&mode=practice')

  // #when the courier rides beside an open edge
  await pauseNear(page, `f.dist > ${metres(open!.from) + 12}`)
  await page.screenshot({ path: `${SHOTS}/coast-open-edge.png` })

  // #and reaches the finale as the bridge breaks, launches and crosses the gap
  await page.clock.resume()
  await pauseNear(page, `f.dist > ${metres(breakEvent!.triggerDist) + 8}`)
  await page.screenshot({ path: `${SHOTS}/coast-bridge-break.png` })
  await stepUntil(page, `f.dist > ${metres(gap!.from) + 6}`, 0, 12_000)
  await page.screenshot({ path: `${SHOTS}/coast-bridge-gap.png` })

  // #then the world draws within budget and without errors
  await expectWithinBudget(page, HIGH_TIER_CALL_BUDGET)
  expect(problems).toEqual([])
})

test('metro: a lane closure telegraphs in amber, then blocks its lanes', async ({ page }) => {
  // #given a metro route with a lane closure
  const problems = collectProblems(page)
  const closure = labTrack('metro', CLOSURE_SEED).events.find(event => event.kind === 'lane-closure')
  expect(closure).toBeDefined()
  await openLeg(page, `world=metro&seed=${CLOSURE_SEED}&bot=1&quality=high&mode=practice`)

  // #when the closure triggers and the barriers slide in
  await pauseNear(page, `f.dist > ${metres(closure!.triggerDist) + 30}`)
  await page.screenshot({ path: `${SHOTS}/metro-lane-closure-telegraph.png` })

  // #and the courier arrives at the closed lanes
  await stepUntil(page, `f.dist > ${metres(closure!.dist) + 6}`, 0, 12_000)
  await page.screenshot({ path: `${SHOTS}/metro-lane-closure.png` })

  // #then the world draws within budget and without errors
  await expectWithinBudget(page, HIGH_TIER_CALL_BUDGET)
  expect(problems).toEqual([])
})

test('low tier stays inside the phone draw-call budget', async ({ page }) => {
  // #given the densest world on the low tier
  const problems = collectProblems(page)
  await openLeg(page, 'world=metro&bot=1&ghost=1&quality=low&mode=practice')

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
