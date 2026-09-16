import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

/** Relay Station lab on fixture data, served by the app at /dev/station. */

const LAB_PATH = process.env.STATION_LAB_PATH ?? '/dev/station'
const SHOTS = '/tmp/nim-relay-station/shots'
const CAMERA_SETTLE_MS = 1_800
const WALK = [
  ['departures', 'Departures'],
  ['rankings', 'Rankings'],
  ['world', 'World routes'],
  ['live', 'Live relay'],
  ['vault', 'Baton vault'],
  ['courier', 'Your courier'],
  ['chronicle', 'Chronicle'],
] as const

async function openLab(page: Page, fixture: 'busy' | 'signed-out' | 'empty'): Promise<Locator> {
  const separator = LAB_PATH.includes('?') ? '&' : '?'
  await page.goto(`${LAB_PATH}${separator}fixture=${fixture}&chrome=0&quality=high`)
  const registered = await page
    .locator('[data-station-lab]')
    .waitFor({ state: 'attached', timeout: 15_000 })
    .then(
      () => true,
      () => false,
    )
  test.skip(!registered, `${LAB_PATH} renders the default app, not the Station lab.`)
  const scene = page.locator('.relay-station-scene')
  await expect(scene).toHaveAttribute('data-station-ready', 'true', { timeout: 60_000 })
  await expect(scene).toHaveAttribute('data-draw-calls', /^\d+$/, { timeout: 60_000 })
  return scene
}

async function tapSurface(page: Page, scene: Locator, id: string): Promise<void> {
  const anchors: unknown = JSON.parse((await scene.getAttribute('data-anchors')) ?? '{}')
  const anchor: unknown = typeof anchors === 'object' && anchors !== null ? Reflect.get(anchors, id) : undefined
  if (!Array.isArray(anchor) || typeof anchor[0] !== 'number' || typeof anchor[1] !== 'number') throw new Error(`No screen anchor for ${id}`)
  await page.mouse.click(anchor[0], anchor[1])
}

async function openFromIndex(page: Page, title: string): Promise<void> {
  await page.locator('.relay-station-index').getByRole('button', { name: title, exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.locator('.relay-station-card').getByRole('heading', { name: title }).waitFor()
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
}

function cardFacts(page: Page): Locator {
  return page.locator('.relay-station-card .relay-station-fact')
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('a phone sees the whole station, taps the board, and walks every surface', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  // #given a signed-in courier with something waiting on every surface
  const scene = await openLab(page, 'busy')
  await page.waitForTimeout(2_500)
  expect(Number(await scene.getAttribute('data-draw-calls'))).toBeLessThan(90)
  await page.screenshot({ path: `${SHOTS}/overview.png` })

  // #when the player taps the departure board in the scene
  await tapSurface(page, scene, 'departures')

  // #then the camera settles on it and the card offers their leg
  const card = page.locator('.relay-station-card')
  await expect(card.getByRole('heading', { name: 'Departures' })).toBeVisible()
  await expect(cardFacts(page).first()).toHaveText('Your leg of Sunrise Run is ready.')
  await page.waitForTimeout(CAMERA_SETTLE_MS)
  await page.screenshot({ path: `${SHOTS}/departures.png` })
  await card.getByRole('button', { name: 'Run your leg' }).click()
  await expect(page.locator('[data-station-lab]')).toHaveAttribute('data-last-route', '/leg/SUNRISE')

  // #when walking the station with Next
  for (const [id, title] of WALK.slice(1)) {
    await card.getByRole('button', { name: `Next: ${title}` }).click()
    await expect(card.getByRole('heading', { name: title })).toBeVisible()
    await page.waitForTimeout(CAMERA_SETTLE_MS)
    await page.screenshot({ path: `${SHOTS}/${id}.png` })
  }

  // #then Escape returns to the overview
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(page.getByText('Tap anything lit to look closer')).toBeVisible()

  // #when the player drags to look around and zooms with the wheel
  await page.mouse.move(215, 520)
  await page.mouse.down()
  await page.mouse.move(320, 560, { steps: 10 })
  await page.mouse.up()
  await page.mouse.wheel(0, 360)

  // #then looking around never opens a surface
  await page.waitForTimeout(600)
  await expect(card).toBeHidden()
  expect(errors).toEqual([])
})

test('an empty network says so plainly instead of inventing activity', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  // #given no relays, rivals, crews or Daily rides, signed out
  await openLab(page, 'empty')
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: `${SHOTS}/empty-overview.png` })

  // #when the surfaces are opened from the keyboard index
  await openFromIndex(page, 'World routes')

  // #then each card reports the empty state and points at a real next step
  await expect(cardFacts(page).first()).toHaveText('No active relays yet.')
  await expect(page.locator('.relay-station-card').getByRole('button', { name: 'Start a relay' })).toBeVisible()
  await page.waitForTimeout(CAMERA_SETTLE_MS)
  await page.screenshot({ path: `${SHOTS}/empty-world.png` })

  await page.locator('.relay-station-card').getByRole('button', { name: 'Next: Live relay' }).click()
  await expect(cardFacts(page).first()).toHaveText('No Global Relay is live right now.')
  await page.waitForTimeout(CAMERA_SETTLE_MS)
  await page.screenshot({ path: `${SHOTS}/empty-live.png` })
  expect(errors).toEqual([])
})

test('a signed-out visitor is asked to set up a courier, not shown someone else’s', async ({ page }) => {
  // #given the public network, signed out, on a device that prefers reduced motion
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openLab(page, 'signed-out')

  // #when the courier bay is opened
  await openFromIndex(page, 'Your courier')

  // #then the card leads to courier setup
  const card = page.locator('.relay-station-card')
  await expect(cardFacts(page)).toHaveText(['Set up a courier to receive and pass batons.'])
  await page.waitForTimeout(CAMERA_SETTLE_MS)
  await page.screenshot({ path: `${SHOTS}/signed-out-courier.png` })
  await card.getByRole('button', { name: 'Set up your courier' }).click()
  await expect(page.locator('[data-station-lab]')).toHaveAttribute('data-last-route', '/profile')

  // #then back at the overview, the plate offers the same step
  await card.getByRole('button', { name: 'Back to the station' }).click()
  await expect(page.locator('.relay-station-plate').getByRole('button', { name: 'Set up your courier' })).toBeVisible()
})
