import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type Route } from '@playwright/test'
import { opsReport } from './ops-fixtures'
import { RUNNERS, emptySnapshot, mockRelayApi, populatedNetwork, signedInAs } from './relay-fixtures'

const SHOTS = '/tmp/nim-relay-ops/shots'
const OPS_API = '**/api/station/network/ops'

/** Runtime failures on the page. The session check and the operator refusal answer 401 or 403 by design. */
function collectProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', error => problems.push(`page error: ${error.message}`))
  page.on('console', message => {
    if (message.type() !== 'error') return
    if (/Failed to load resource: the server responded with a status of (401|403|404)/.test(message.text())) return
    problems.push(`console error: ${message.text()}`)
  })
  return problems
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** The report sheet at the top, then one screenshot per scrolled screenful. */
async function shootSheet(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
  const sheet = page.locator('.nr-screen__scroll').last()
  for (let part = 2; part <= 8; part++) {
    const moved = await sheet.evaluate(element => {
      const before = element.scrollTop
      element.scrollTop += element.clientHeight - 80
      return element.scrollTop > before
    })
    if (!moved) break
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SHOTS}/${name}-${part}.png` })
  }
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('an operator sees alerts first, then totals, trends, the funnel, flagged runs and NIM moved', async ({ page }) => {
  const problems = collectProblems(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, signedInAs(RUNNERS.mateo, network.snapshot))
  await page.route(OPS_API, route => json(route, 200, opsReport()))
  await page.goto('/ops')

  await expect(page.getByRole('heading', { name: 'Operator report', level: 1 })).toBeVisible()
  await expect(page.locator('.nr-ops-head').getByText('Nimiq testnet', { exact: true })).toBeVisible()
  const alerts = page.getByRole('region', { name: 'Alerts' })
  await expect(alerts.getByText('2 critical, 2 to review')).toBeVisible()
  await expect(alerts.getByRole('listitem')).toHaveCount(4)
  await expect(alerts.getByRole('heading', { name: 'Critical: Verification rejections above 20%' })).toBeVisible()
  await expect(alerts.getByText('4 rejections in the last 24 h against 9 transaction hashes submitted (44%). Alert above 20%.')).toBeVisible()
  await expect(alerts.getByRole('heading', { name: 'Warning: Stranded batons' })).toBeVisible()

  // Alerts come before every other section.
  const headings = await page.locator('.nr-screen__scroll h2').allTextContents()
  expect(headings).toEqual(['Alerts', 'Network totals', 'Last 30 UTC days', 'Handoff funnel', 'Flagged runs', 'NIM moved'])

  await expect(page.getByText('Wallets that signed in and joined the relay network. A wallet is not proof of a unique person.')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Runs submitted per UTC day\. Today \d+ verified, \d+ rejected, \d+ refused\.$/ })).toBeVisible()
  await expect(page.getByText(/^Run counts started .* UTC and daily share counts .* UTC\. Earlier days show a dash on the baseline, not a zero\.$/)).toBeVisible()
  const funnel = page.getByRole('region', { name: 'Handoff funnel' })
  await expect(funnel.getByText('Transaction hash received')).toBeVisible()
  await expect(funnel.getByText('1 min 34 s')).toBeVisible()
  await expect(funnel.getByText('CUSTODY_CHANGED')).toBeVisible()
  const flagged = page.getByRole('region', { name: 'Flagged runs' })
  await expect(flagged.getByRole('link', { name: '@mateo' })).toHaveAttribute('href', '/runner/mateo')
  await expect(flagged.getByText('Global leg', { exact: false }).first()).toContainText('submitted 3 times')
  await expect(page.getByRole('region', { name: 'NIM moved' }).getByText('212 NIM')).toBeVisible()

  // No wallet address reaches the operator screen.
  expect(await page.locator('.nr-ops').textContent()).not.toMatch(/NQ\d{2}/)
  await shootSheet(page, 'ops')
  expect(problems).toEqual([])
})

test('a signed-in runner who is not an operator sees only that the page is for operators', async ({ page }) => {
  const problems = collectProblems(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, signedInAs(RUNNERS.sam, network.snapshot))
  await page.route(OPS_API, route => json(route, 403, { error: 'operators_only' }))
  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: 'Operators only' })).toBeVisible()
  await expect(page.locator('.nr-ops')).toHaveCount(0)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/ops-forbidden.png` })
  expect(problems).toEqual([])
})

test('a signed-out visitor sees the same answer and the report is never requested', async ({ page }) => {
  const problems = collectProblems(page)
  let requested = 0
  await mockRelayApi(page, { snapshot: emptySnapshot() })
  await page.route(OPS_API, route => {
    requested++
    return json(route, 401, { error: 'no_session' })
  })
  await page.goto('/ops')
  await expect(page.getByRole('heading', { name: 'Operators only' })).toBeVisible()
  expect(requested).toBe(0)
  expect(problems).toEqual([])
})

test('the report refreshes every 30 seconds while the page is open', async ({ page }) => {
  let requests = 0
  const network = populatedNetwork()
  await page.clock.install()
  await mockRelayApi(page, network, signedInAs(RUNNERS.mateo, network.snapshot))
  await page.route(OPS_API, route => {
    requests++
    return json(route, 200, opsReport(Date.now(), { alerts: [] }))
  })
  await page.goto('/ops')
  await expect(page.getByText(/^No alert condition holds\./)).toBeVisible()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/ops-all-clear.png` })
  expect(requests).toBe(1)
  await page.clock.fastForward(31_000)
  await expect.poll(() => requests).toBe(2)
})
