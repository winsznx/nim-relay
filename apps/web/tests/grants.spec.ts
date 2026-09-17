import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type Route } from '@playwright/test'
import type { BatonDetail, GrantMilestoneView, GrantsView } from '@nim-relay/shared'
import { baton, hash, mockRelayApi, populatedNetwork, RUNNERS, signedInAs } from './relay-fixtures'

const SHOTS = '/tmp/nim-relay-grants/shots'
const STARTER_CODE = 'S7ARTER01X'

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

function milestone(id: GrantMilestoneView['id'], overrides: Partial<GrantMilestoneView> = {}): GrantMilestoneView {
  const copy: Record<GrantMilestoneView['id'], [string, string]> = {
    starter: ['Starter Baton', 'Your first relay is on us, while your wallet holds less than one baton.'],
    first_handoff: ['First handoff', 'Pass a baton to another runner and have it verified on chain.'],
    atlas_explorer: ['Atlas explorer', 'Complete 3 different Atlas routes.'],
    return_handoff: ['Back for more', 'Make a verified handoff on a later day than your first.'],
    social: ['Bring a runner', 'A runner you invited makes a verified handoff, or your crew holds a 3-day streak with you in it.'],
  }
  return { id, title: copy[id][0], requirement: copy[id][1], luna: 100_000, state: 'locked', blocked: 'requirement_not_met', phase: null, txHash: null, confirmations: null, batonCode: null, updatedAt: null, ...overrides }
}

/** The Worker's grants for one runner, moved along by the claim the page makes. */
class GrantsWorker {
  deviceSignal = false
  claims: unknown[] = []
  polls = 0
  starter: GrantMilestoneView = milestone('starter', { state: 'locked', blocked: 'no_device_signal' })
  refusal: string | null = null

  view(): GrantsView {
    const others = [milestone('first_handoff'), milestone('atlas_explorer'), milestone('return_handoff'), milestone('social')]
    const claimed = this.starter.state === 'pending' || this.starter.state === 'confirmed' ? this.starter.luna : 0
    return { network: 'TestAlbatross', enabled: true, paused: false, deviceSignal: this.deviceSignal, claimedLuna: claimed, confirmedLuna: this.starter.state === 'confirmed' ? claimed : 0, capLuna: 500_000, treasuryAddress: 'NQ60 YJML S1XY DLGH 05A6 EC2U ERMD 7HRH BN3C', milestones: [this.starter, ...others] }
  }

  async install(page: Page, onConfirmed: () => void): Promise<void> {
    await page.route('**/api/auth/device', async route => {
      this.deviceSignal = true
      if (this.starter.blocked === 'no_device_signal') this.starter = { ...this.starter, state: 'available', blocked: null }
      return json(route, 200, { deviceSignal: true })
    })
    await page.route('**/api/station/network/grants', route => {
      if (this.starter.state === 'pending' && ++this.polls >= 2) {
        this.starter = { ...this.starter, state: 'confirmed', phase: null, confirmations: 2, batonCode: STARTER_CODE }
        onConfirmed()
      }
      return json(route, 200, this.view())
    })
    await page.route('**/api/station/network/grants/claim', route => {
      this.claims.push(route.request().postDataJSON())
      if (this.refusal) return json(route, 409, { error: this.refusal })
      this.starter = { ...this.starter, state: 'pending', blocked: null, phase: 'confirming', txHash: hash(77), confirmations: 0 }
      return json(route, 200, { milestone: this.starter, grants: this.view() })
    })
  }
}

async function insideNimiqPay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.set(window, 'nimiqPay', { language: 'en', requestDeviceIdentifier: async () => 'e2e-grant-device' })
  })
}

function problemsOf(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', error => problems.push(`page error: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error' && !/status of (401|403|404|409)/.test(message.text())) problems.push(`console error: ${message.text()}`)
  })
  return problems
}

async function setUp(page: Page) {
  const network = populatedNetwork()
  const runner = RUNNERS.ada
  const account = signedInAs(runner, network.snapshot)
  const starterBaton = { ...baton({ id: 'b-starter', code: STARTER_CODE, serial: 2, mode: 'global', title: 'Starter Baton', path: [runner], createdAt: Date.now(), updatedAt: Date.now() }), starterGrant: { kind: 'treasury_starter_grant' as const, at: Date.now(), toRunner: { name: runner.name, handle: runner.handle }, txHash: hash(77), station: 'genesis' as const } }
  starterBaton.route = { ...starterBaton.route, routeId: 'genesis-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' }
  const detail: BatonDetail = { ...(Object.values(network.details)[0] as BatonDetail), baton: starterBaton, handoffs: [], notableRuns: [], echoes: [], pendingHandoff: null, live: null }
  network.details[STARTER_CODE] = detail
  await insideNimiqPay(page)
  await mockRelayApi(page, network, account)
  const worker = new GrantsWorker()
  await worker.install(page, () => {
    account.snapshot = { ...account.snapshot, batons: [...account.snapshot.batons, starterBaton] }
  })
  return { worker, account }
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('a new runner claims the Starter Baton, watches it confirm and gets their first baton', async ({ page }) => {
  const problems = problemsOf(page)
  const { worker } = await setUp(page)
  await page.goto('/')

  // #given the World home offers the Starter Baton
  const banner = page.locator('[data-tour="starter-baton-banner"]')
  await expect(banner).toContainText('Your first relay is on us')
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${SHOTS}/01-home-offer.png` })

  // #when they open it
  await banner.getByRole('button', { name: 'Claim' }).click()
  const sheet = page.getByRole('dialog', { name: 'Starter Baton' })
  await expect(sheet.getByText('Your first relay is on us.')).toBeVisible()
  await expect(sheet).not.toContainText(/faucet/i)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/02-claim-sheet.png` })

  // #and claim
  await sheet.getByRole('button', { name: 'Claim Starter Baton' }).click()
  await expect(page.getByText('Confirming on Nimiq')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/03-confirming.png` })

  // #then only the milestone went to the server, and the baton is revealed once the grant confirms
  const reveal = page.getByRole('dialog', { name: 'You received your first baton' })
  await expect(reveal).toBeVisible({ timeout: 30_000 })
  await expect(reveal.getByText('Starter Baton', { exact: true })).toBeVisible()
  await expect(reveal.getByRole('button', { name: 'Carry it' })).toBeVisible()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/04-reveal.png` })
  expect(worker.claims).toEqual([{ grantId: 'starter' }])
  expect(worker.deviceSignal).toBe(true)

  // #and the profile shows the grant against the cap
  await reveal.getByRole('button', { name: 'Later' }).click()
  await page.goto('/profile')
  const panel = page.getByRole('region', { name: 'Relay Grants' })
  await expect(panel.getByText('1 / 5 NIM claimed')).toBeVisible()
  await expect(panel.getByText('Received.')).toBeVisible()
  await expect(panel.getByText('Pass a baton to another runner and have it verified on chain.')).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/05-profile-grants.png` })
  expect(problems).toEqual([])
})

test('a refused claim says why and sends nothing more', async ({ page }) => {
  const { worker } = await setUp(page)
  worker.refusal = 'wallet_already_funded'
  await page.goto('/profile')
  const panel = page.getByRole('region', { name: 'Relay Grants' })
  await expect(panel.getByText('0 / 5 NIM claimed')).toBeVisible()
  await panel.getByRole('button', { name: 'Claim' }).click()
  const sheet = page.getByRole('dialog', { name: 'Starter Baton' })
  await sheet.getByRole('button', { name: 'Claim Starter Baton' }).click()
  await expect(sheet.getByRole('alert')).toContainText('already holds enough NIM')
  await expect(sheet.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/06-refused.png` })
  expect(worker.claims).toHaveLength(1)
})
