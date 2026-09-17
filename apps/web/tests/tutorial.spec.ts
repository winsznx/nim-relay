import { expect, test, type Page } from '@playwright/test'

/**
 * The gameplay tutorial on /dev/leg?tutorial=1 at phone size: each coach prompt at the moment it is about, leaving
 * once answered, the race running on underneath, keyboard players reading their keys, and the skip control.
 */

declare global {
  interface Window {
    /** Every coach prompt state the page showed, in order, as `step#showing:status`, and `none` when it cleared. */
    __coachLog?: string[]
  }
}

const SHOTS = '/tmp/nim-relay-tutorial/shots'
/** One animation frame on the paused clock. */
const FRAME_MS = 17

test.describe.configure({ mode: 'serial' })

interface LegFrame {
  tick: number
  dist: number
  targetLane: number
}

function isLegFrame(value: unknown): value is LegFrame {
  return typeof value === 'object' && value !== null && 'tick' in value && typeof value.tick === 'number' && 'targetLane' in value && typeof value.targetLane === 'number'
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
 * Opens a lab leg on a controllable clock with the dev server's HMR socket mocked (see leg.spec.ts), and records
 * every state the coach prompt passes through, so a state lasting a few frames is never missed.
 */
async function openLeg(page: Page, query: string): Promise<void> {
  await page.routeWebSocket(/.*/, () => {})
  await page.clock.install()
  await page.addInitScript(() => {
    const log: string[] = []
    window.__coachLog = log
    const record = () => {
      const card = document.querySelector<HTMLElement>('.leg-coach')
      const entry = card ? `${card.dataset.step}#${card.dataset.showing}:${card.dataset.status}` : 'none'
      if (log.at(-1) !== entry && (log.length > 0 || card)) log.push(entry)
    }
    new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status', 'data-showing'] })
  })
  await page.goto(`/dev/leg?${query}`)
}

async function legFrame(page: Page): Promise<LegFrame> {
  const value: unknown = await page.evaluate(() => Reflect.get(window, '__legFrame'))
  if (!isLegFrame(value)) throw new Error('The leg lab reported no frame')
  return value
}

async function coachLog(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__coachLog ?? [])])
}

/** Runs in real time until the lab reports `near`, then pauses the clock (see leg.spec.ts). */
async function pauseNear(page: Page, near: string, timeout = 240_000): Promise<void> {
  await page.waitForFunction(`(() => { const f = window.__legFrame; return !!f && (${near}) })()`, null, { timeout, polling: 40 })
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

/** Steps single frames on the paused clock until `moment` holds (it may read `f`, the lab frame, and the DOM). */
async function stepUntil(page: Page, moment: string, maxFrames = 3000): Promise<LegFrame> {
  for (let frame = 0; ; frame++) {
    const hit: unknown = await page.evaluate(`(() => { const f = window.__legFrame; return !!f && (${moment}) })()`)
    if (hit === true) return legFrame(page)
    if (frame >= maxFrames) throw new Error(`No frame matched: ${moment}`)
    await page.clock.runFor(FRAME_MS)
  }
}

async function stepFrames(page: Page, frames: number): Promise<LegFrame> {
  for (let frame = 0; frame < frames; frame++) await page.clock.runFor(FRAME_MS)
  return legFrame(page)
}

const showing = (step: string) => `!!document.querySelector('.leg-coach[data-step="${step}"][data-status="showing"]')`

async function showingNumber(page: Page, step: string): Promise<string> {
  const value = await page.locator(`.leg-coach[data-step="${step}"]`).getAttribute('data-showing')
  if (!value) throw new Error(`No ${step} prompt on screen`)
  return value
}

/**
 * Where each prompt of the capture leg shows, in route metres: the lab's grind bot rides the metro lab route against
 * Mariana's Ghostline. It changes lanes, grinds and saves the left rail, jumps the full-width barrier at 205 m, builds
 * FLOW past the mid tier, slides the risk path's beam at 860 m and drafts the Ghostline after the pulse tunnel. `near`
 * is where the capture starts watching: past any earlier prompt of the same step that the bot answers by steering.
 */
const MOMENTS = [
  { step: 'lane', heading: 'SWIPE LEFT OR RIGHT', near: 40 },
  { step: 'edge', heading: 'STAY OFF THE EDGE', near: 100 },
  { step: 'jump', heading: 'SWIPE UP TO JUMP', near: 136 },
  { step: 'flow', heading: 'FILL YOUR FLOW', near: 300 },
  { step: 'slide', heading: 'SWIPE DOWN TO SLIDE', near: 800 },
  { step: 'ghostline', heading: 'FOLLOW OR BREAK THE GHOSTLINE', near: 950 },
] as const

test('each prompt shows at its moment, leaves once answered, and never holds up the race', async ({ page }) => {
  // #given the lab's capture leg with the tutorial forced on
  const problems = collectProblems(page)
  await openLeg(page, 'world=metro&scenario=grind&at=120&ghost=1&mode=practice&tutorial=1&quality=high')
  const skip = page.getByRole('button', { name: 'Skip gameplay tutorial' })

  for (const moment of MOMENTS) {
    // #when the courier reaches the moment the prompt is about
    await pauseNear(page, `f.dist > ${moment.near}`)
    const shownAt = await stepUntil(page, showing(moment.step))
    const card = page.locator(`.leg-coach[data-step="${moment.step}"]`)
    const number = await showingNumber(page, moment.step)
    await expect(card).toContainText(moment.heading)
    await expect(skip).toBeVisible()

    // #then the race runs on underneath it
    const later = await stepFrames(page, 6)
    expect(later.tick).toBeGreaterThan(shownAt.tick)
    expect(later.dist).toBeGreaterThan(shownAt.dist)
    await expect(card).toHaveAttribute('data-status', 'showing')
    await page.waitForTimeout(450)
    await page.screenshot({ path: `${SHOTS}/tutorial-${moment.step}.png` })

    // #and the prompt leaves once the courier answers it
    await page.clock.resume()
    await page.waitForFunction(entry => window.__coachLog?.includes(entry) === true, `${moment.step}#${number}:done`, { timeout: 60_000 })
    await expect(page.locator(`.leg-coach[data-showing="${number}"]`)).toHaveCount(0)
    expect(await coachLog(page)).not.toContain(`${moment.step}#${number}:dismissed`)
  }
  expect(problems).toEqual([])
})

test('the skip control ends the tutorial for the rest of the run', async ({ page }) => {
  // #given a courier riding by hand with the first prompt on screen
  const problems = collectProblems(page)
  await openLeg(page, 'world=metro&mode=practice&tutorial=1&quality=low')
  await pauseNear(page, 'f.dist > 40')
  await stepUntil(page, showing('lane'))
  const skip = page.getByRole('button', { name: 'Skip gameplay tutorial' })

  // #when they tap Skip gameplay tutorial
  await skip.tap()
  const skippedAt = await stepFrames(page, 2)

  // #then the prompt and the control are gone, and the race runs on past the barrier that would have asked for a jump
  await expect(page.locator('.leg-coach')).toHaveCount(0)
  await expect(skip).toHaveCount(0)
  const logAtSkip = await coachLog(page)
  await page.clock.resume()
  await page.waitForFunction('(window.__legFrame?.dist ?? 0) > 215', null, { timeout: 120_000 })
  expect((await legFrame(page)).tick).toBeGreaterThan(skippedAt.tick)
  expect(await coachLog(page)).toEqual(logAtSkip)
  expect(problems).toEqual([])
})

test.describe('on a keyboard', () => {
  test.use({ hasTouch: false, isMobile: false })

  test('the prompts name the keys, and pressing them answers', async ({ page }) => {
    // #given a courier racing by hand at a desk
    const problems = collectProblems(page)
    await openLeg(page, 'world=metro&mode=practice&tutorial=1&quality=high')

    // #when the lane prompt asks for an arrow key and the player presses one
    await pauseNear(page, 'f.dist > 40')
    const before = await stepUntil(page, showing('lane'))
    const lane = page.locator('.leg-coach[data-step="lane"]')
    await expect(lane).toContainText('PRESS ← OR →')
    await stepFrames(page, 6)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `${SHOTS}/tutorial-keys-lane.png` })
    await page.keyboard.press('ArrowRight')
    const shifted = await stepUntil(page, `f.targetLane !== ${before.targetLane}`, 30)

    // #then the lane prompt is answered
    await stepUntil(page, `document.querySelector('.leg-coach[data-step="lane"]')?.dataset.status === 'done'`, 30)
    expect(shifted.targetLane).toBeGreaterThan(before.targetLane)

    // #and at the full-width barrier the jump prompt asks for the up arrow, and pressing it answers
    await page.clock.resume()
    await pauseNear(page, 'f.dist > 125')
    await stepUntil(page, showing('jump'))
    const jump = page.locator('.leg-coach[data-step="jump"]')
    await expect(jump).toContainText('PRESS ↑ TO JUMP')
    await stepUntil(page, `document.querySelector('.leg-coach[data-step="jump"]')?.dataset.now === 'true'`)
    await page.waitForTimeout(450)
    await page.screenshot({ path: `${SHOTS}/tutorial-keys-jump-now.png` })
    await page.keyboard.press('ArrowUp')
    await stepUntil(page, `document.querySelector('.leg-coach[data-step="jump"]')?.dataset.status === 'done'`, 30)
    expect(problems).toEqual([])
  })
})
