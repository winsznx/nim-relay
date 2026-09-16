import { expect, test, type Page } from '@playwright/test'
import type { NetworkSnapshot } from '@nim-relay/shared'
import { RUNNERS, emptySnapshot, mockRelayApi, populatedNetwork, signedInAs } from './relay-fixtures'

const SHOTS = '/tmp/nim-relay-world/shots'
const GLOBE = '.nr-world__globe'

/** Runtime failures on the page. A signed-out session check and deliberate unknown-code lookups answer 401 or 404 by design. */
function collectProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', error => problems.push(`page error: ${error.message}`))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (/Failed to load resource: the server responded with a status of (401|404)/.test(message.text())) return
    problems.push(`console error: ${message.text()}`)
  })
  return problems
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

test('world home renders the globe and describes an empty network truthfully', async ({ page }) => {
  const problems = collectProblems(page)
  await mockRelayApi(page, { snapshot: emptySnapshot() })
  await page.goto('/')
  await expect(page.locator(`${GLOBE} canvas`)).toBeVisible()
  await expect(page.locator(GLOBE)).toHaveAttribute('data-map-ready', 'true', { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'How far can one NIM travel?' })).toBeVisible()
  await expect(page.getByText('The first baton is waiting')).toBeVisible()
  await expect(page.getByText('No relay is moving on the Nimiq testnet yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Global Relay #001' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practice a relay leg' })).toBeVisible()
  // No relay exists, so nothing may claim handoffs, wallets or a holder.
  await expect(page.getByText('verified handoffs')).toHaveCount(0)
  await expect(page.getByText('Current holder')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/world-empty.png` })
  expect(problems).toEqual([])
})

test('bottom navigation reaches every destination and back', async ({ page }) => {
  const problems = collectProblems(page)
  await mockRelayApi(page, { snapshot: emptySnapshot() })
  await page.goto('/')
  await nav(page).getByRole('link', { name: 'Inbox' }).click()
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your batons arrive here' })).toBeVisible()
  await nav(page).getByRole('link', { name: 'Crew' }).click()
  await expect(page.getByRole('heading', { name: 'Crew', level: 1 })).toBeVisible()
  await nav(page).getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

  await nav(page).getByRole('button', { name: 'Play' }).click()
  const play = page.getByRole('dialog', { name: 'Play' })
  await expect(play.getByRole('button', { name: /Daily Circuit/ })).toBeVisible()
  await expect(play.getByRole('button', { name: /Practice a relay leg/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(play).toBeHidden()

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Crew', level: 1 })).toBeVisible()
  await nav(page).getByRole('link', { name: 'World' }).click()
  await expect(page.getByRole('heading', { name: 'How far can one NIM travel?' })).toBeVisible()
  expect(problems).toEqual([])
})

test('unknown relay, chronicle and invite links say exactly what is missing', async ({ page }) => {
  const problems = collectProblems(page)
  await mockRelayApi(page, { snapshot: emptySnapshot() })
  await page.goto('/relay/NOPE000000')
  await expect(page.getByRole('heading', { name: 'No relay uses this code' })).toBeVisible()
  await expect(page.getByText('Nothing on the network matches “NOPE000000”')).toBeVisible()
  await page.goto('/chronicle/NOPE000000')
  await expect(page.getByRole('heading', { name: 'No Chronicle for this code' })).toBeVisible()
  await page.goto('/invite/missing-token')
  await expect(page.getByRole('heading', { name: 'Invitation not found' })).toBeVisible()
  expect(problems).toEqual([])
})

test('proof defines every metric, separates test evidence and links real explorers', async ({ page }) => {
  const problems = collectProblems(page)
  await mockRelayApi(page, populatedNetwork())
  await page.goto('/proof')
  await expect(page.getByRole('heading', { name: 'Proof of the relay' })).toBeVisible()
  await expect(page.getByText('Qualified handoffs', { exact: true })).toBeVisible()
  await expect(page.getByText('Transfers verified independently on chain and backed by a completed race the server replayed.')).toBeVisible()
  await expect(page.getByText('Wallets that signed in and joined the relay network. A wallet is not proof of a unique person.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Controlled and test evidence' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Measurement rules' })).toBeVisible()
  await page.getByRole('link', { name: /Global Relay #001/ }).click()
  await expect(page.getByRole('heading', { name: 'Transaction lineage' })).toBeVisible()
  await expect(page.getByRole('link', { name: /View on nimiq.watch/ }).first()).toHaveAttribute('href', /^https:\/\/test\.nimiq\.watch\/#[0-9a-f]{64}$/)
  expect(problems).toEqual([])
})

test('the Play button launches a practice leg and returns to the world', async ({ page }) => {
  const problems = collectProblems(page)
  await mockRelayApi(page, { snapshot: emptySnapshot() })
  await page.goto('/')
  await nav(page).getByRole('button', { name: 'Play' }).click()
  await page.getByRole('dialog', { name: 'Play' }).getByRole('button', { name: /Practice a relay leg/ }).click()
  await expect(page).toHaveURL(/\/leg\/practice$/)
  await page.getByRole('button', { name: 'Let’s ride' }).click()
  await expect(page.locator('.race-controls')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(page.getByText('Take a breath.')).toBeVisible()
  await page.getByRole('button', { name: 'Leave ride' }).click()
  await expect(page.getByRole('heading', { name: 'How far can one NIM travel?' })).toBeVisible()
  expect(problems).toEqual([])
})

test('a live network: world, journey and Chronicle, then the runner’s inbox and profile', async ({ page }) => {
  const problems = collectProblems(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, signedInAs(RUNNERS.mateo, network.snapshot))
  await page.goto('/')
  await expect(page.locator(GLOBE)).toHaveAttribute('data-map-ready', 'true', { timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Nigeria → Brazil' })).toBeVisible()
  await expect(page.getByText('Your turn')).toBeVisible()
  await expect(nav(page).getByRole('link', { name: /Inbox, 2 unread/ })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/world-home.png` })

  await page.getByRole('link', { name: 'View journey' }).click()
  await expect(page.getByRole('heading', { name: 'Global Relay #001', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Carry this leg' })).toBeVisible()
  await expect(page.getByText('Mei Tan passed to Mateo Silva')).toBeVisible()
  await page.waitForTimeout(1600)
  await page.screenshot({ path: `${SHOTS}/journey.png` })

  await page.getByRole('link', { name: 'Read the Chronicle' }).click()
  await expect(page.getByRole('heading', { name: /4 verified handoffs across 5 countries/ })).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/chronicle.png` })

  await nav(page).getByRole('link', { name: /Inbox/ }).click()
  await expect(page.getByRole('button', { name: /Arjun Rao beat your ghost/ })).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/inbox.png` })

  await nav(page).getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByRole('heading', { name: 'Mateo Silva', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Courier locker' })).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/profile.png` })
  expect(problems).toEqual([])
})

test('the local Worker serves the world and its not-found answers', async ({ page, request }) => {
  const health = await request.get('/api/health').catch(() => null)
  test.skip(!health?.ok(), 'wrangler dev is not running on :8787')
  const problems = collectProblems(page)
  const snapshot = (await (await request.get('/api/station/network/public')).json()) as NetworkSnapshot
  await page.goto('/')
  await expect(page.locator(GLOBE)).toHaveAttribute('data-map-ready', 'true', { timeout: 20_000 })
  if (snapshot.batons.length === 0) await expect(page.getByRole('heading', { name: 'How far can one NIM travel?' })).toBeVisible()
  else await expect(page.getByRole('link', { name: 'View journey' })).toBeVisible()
  const missing = await request.get('/api/station/network/batons/NOPE000000')
  expect(missing.status()).toBe(404)
  expect(((await missing.json()) as { error: string }).error).toBe('journey_not_found')
  await page.goto('/relay/NOPE000000')
  await expect(page.getByRole('heading', { name: 'No relay uses this code' })).toBeVisible()
  expect(problems).toEqual([])
})
