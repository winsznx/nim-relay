import { expect, type Locator, type Page } from '@playwright/test'
import { APP_ORIGIN } from './env'
import { shot, type Runner } from './harness'

/** A baton leg is a real-time race of about 40 seconds; SwiftShader adds loading time on both ends. */
const RACE_MS = 240_000
const LEG_LOAD_MS = 90_000

export const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Main' })
export const journeyPath = (code: string): string => `/relay/${code}`
export const journeyStats = (page: Page): Locator => page.getByRole('group', { name: 'Journey statistics' })
export const ceremonyHeading = (page: Page, name: string | RegExp): Locator => page.getByRole('dialog').getByRole('heading', { name })

/** A stat tile's value, e.g. "1" over "verified handoffs". */
export function statValue(scope: Locator, label: string): Locator {
  return scope.locator('.nr-stat').filter({ has: scope.page().getByText(label, { exact: true }) }).locator('.nr-stat__value')
}

/** The one sign-in ceremony, from the world's top bar, with the fair-play device signal switched on. */
export async function signIn(runner: Runner): Promise<void> {
  const { page } = runner
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Set up your runner' })
  await sheet.getByRole('checkbox').check()
  await sheet.getByRole('button', { name: 'Sign in with Nimiq Pay' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('link', { name: /^Your profile/ })).toBeVisible()
  expect(runner.wallet.signedMessages.at(-1)?.split('\n').slice(0, 2)).toEqual(['NIM Relay login', `origin: ${APP_ORIGIN}`])
}

/** Sets the runner's courier name on their profile. */
export async function nameCourier(runner: Runner): Promise<void> {
  const { page, name } = runner
  await mainNav(page).getByRole('link', { name: /^Profile/ }).click()
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  await page.getByLabel('Runner name').fill(name)
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('heading', { name, level: 2, exact: true })).toBeVisible()
}

export async function joinNetwork(runner: Runner): Promise<void> {
  await signIn(runner)
  await nameCourier(runner)
}

/** Starts a best-of-three Quick relay from the Play sheet and lands on its journey. Returns the relay code. */
export async function startQuickRelay(runner: Runner, opponent: string): Promise<string> {
  const { page } = runner
  await mainNav(page).getByRole('button', { name: 'Play' }).click()
  await page.getByRole('dialog', { name: 'Play' }).getByRole('button', { name: /Start a relay/ }).click()
  await expect(page.getByRole('heading', { name: 'Start a relay', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Quick', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Your opponent' }).fill(opponent)
  await page.getByRole('button', { name: new RegExp(`^${opponent} @`) }).click()
  await expect(page.getByRole('status').filter({ hasText: `Selected: ${opponent} (@` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Best of 3' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Start relay', exact: true }).click()
  await expect(page).toHaveURL(/\/relay\/[A-Z0-9]+$/)
  return new URL(page.url()).pathname.split('/').at(-1) ?? ''
}

/** From the relay's journey, opens the leg and waits until the race scene is running. */
export async function openLeg(runner: Runner, code: string): Promise<void> {
  const { page } = runner
  await expect(page).toHaveURL(new RegExp(`${journeyPath(code)}$`))
  await page.getByRole('link', { name: 'Carry this leg' }).click()
  await expect(page).toHaveURL(new RegExp(`/leg/${code}$`))
  await expect(page.locator('main.leg')).toHaveAttribute('data-phase', /arrival|catch|racing/, { timeout: LEG_LOAD_MS })
}

/**
 * Lets the dev autopilot ride to the gate, waits for the server's verdict, then presses the pass on the results.
 * Returns the handoff card of the runner waiting for the baton; a Quick relay always has one. With `route`, the pass
 * first offers the Atlas route step and the runner sends the next leg onward from it.
 */
export async function finishLeg(runner: Runner, options: { route?: (page: Page) => Promise<void> } = {}): Promise<Locator> {
  const { page } = runner
  await expect(page.locator('main.leg')).toHaveAttribute('data-phase', 'finished', { timeout: RACE_MS })
  await expect(page.getByRole('region', { name: 'Arrival results' })).toBeVisible()
  const pass = page.getByRole('button', { name: /^PASS / })
  await expect(pass).toBeVisible({ timeout: 30_000 })
  await pass.click()
  if (options.route) await options.route(page)
  else await expect(page.getByRole('dialog', { name: 'Where does it go next?' })).toHaveCount(0)
  const handoff = page.getByRole('dialog', { name: /^Handoff to / })
  await expect(handoff).toBeVisible()
  return handoff
}

export interface ChosenRoute {
  /** The station the leg reached, as the route step names it. */
  from: string
  to: string
}

/**
 * On the Atlas route step, picks the first route leading on to another station rather than repeating the leg's route.
 * Returns the station names of the route chosen.
 */
export async function chooseOnwardRoute(page: Page, shotName?: string): Promise<ChosenRoute> {
  const step = page.getByRole('dialog', { name: 'Where does it go next?' })
  await expect(step).toBeVisible()
  // The eyebrow is set in capitals by CSS; its text content keeps the station's own name.
  const reached = ((await step.locator('.handoff-eyebrow').textContent()) ?? '').replace(/^You reached /, '').trim()
  const onward = step.locator('.handoff-route-option').filter({ hasNotText: /^Again to/ }).first()
  const to = ((await onward.locator('.handoff-route-option__name').textContent()) ?? '').trim()
  if (shotName) await shot(page, shotName)
  await onward.click()
  await expect(page.getByText(`Next leg: ${reached} to ${to}`, { exact: false })).toBeVisible()
  return { from: reached, to }
}

/** Prepares the handoff to the waiting (or already picked) runner without a note, then holds the launch pad, drags up to raise the arc and releases. */
export async function throwBaton(runner: Runner, recipient: string, shotPrefix?: string, options: { picked?: boolean } = {}): Promise<void> {
  const { page } = runner
  if (shotPrefix) await shot(page, `${shotPrefix}-choose`)
  // A runner picked from the handoff zone goes straight to the note; a waiting runner is confirmed first.
  if (!options.picked) await page.getByRole('dialog', { name: `Handoff to ${recipient}` }).getByRole('button', { name: 'Prepare handoff' }).click()
  const note = page.getByRole('dialog', { name: 'Relay note' })
  await expect(note).toBeVisible()
  if (shotPrefix) await shot(page, `${shotPrefix}-note`)
  await note.getByRole('button', { name: 'Pass without a note' }).click()
  await expect(ceremonyHeading(page, new RegExp(`Passing 1 NIM\\s*to ${recipient}`, 'i'))).toBeVisible()
  const pad = page.getByRole('button', { name: 'Hold to charge the throw, release to pass the baton' })
  await pad.scrollIntoViewIfNeeded()
  if (shotPrefix) await shot(page, `${shotPrefix}-launch-pad`)
  const box = await pad.boundingBox()
  if (!box) throw new Error('The launch pad has no layout box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(page.getByText('Release to throw', { exact: true })).toBeVisible()
  await page.mouse.move(x, y - 60, { steps: 6 })
  await page.waitForTimeout(700)
  if (shotPrefix) await shot(page, `${shotPrefix}-charging`)
  await page.mouse.up()
}

/** The departure banner that follows a verified handoff: "<recipient> HAS THE BATON / HANDOFF #n COMPLETE". */
export async function expectDeparture(page: Page, handoff: number, recipient: string, options: { shot?: string; withinMs?: number } = {}): Promise<void> {
  const banner = page.getByRole('status').filter({ hasText: new RegExp(`Handoff #${handoff} complete`, 'i') })
  await expect(banner).toBeVisible({ timeout: options.withinMs ?? 20_000 })
  await expect(banner).toContainText(new RegExp(`${recipient}\\s*has the baton`, 'i'))
  if (options.shot) await shot(page, options.shot)
}

/**
 * Makes another runner's app write to the network every 700 ms, as a busy relay network does. Every write
 * broadcasts a network update that makes all open apps refetch. Returns a function that stops the writes.
 */
export async function keepNetworkBusy(runner: Runner): Promise<() => Promise<void>> {
  const timer = await runner.page.evaluate(() => {
    let consent = false
    return window.setInterval(() => {
      consent = !consent
      void fetch('/api/station/network/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent }) })
    }, 700)
  })
  return () => runner.page.evaluate(id => window.clearInterval(id), timer)
}
