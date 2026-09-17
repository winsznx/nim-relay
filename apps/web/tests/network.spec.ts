import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import type { NetworkHandoffIntent, NetworkInvite, NetworkSnapshot } from '@nim-relay/shared'
import { HOUR, RUNNERS, emptySnapshot, hash, mockRelayApi, populatedNetwork, raceLive, signedInAs } from './relay-fixtures'
import { socialNetwork } from './social-fixtures'

const SHOTS = '/tmp/nim-relay-world/shots'
const SOCIAL_SHOTS = '/tmp/nim-relay-social/shots'
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
  await expect(page.locator('main.leg[data-phase="racing"]')).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible()
  await page.getByRole('button', { name: 'Leave race' }).click()
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

test('a leg raced right now shows live on the world and the journey, and goes quiet with its reports', async ({ page }) => {
  // #given Mateo racing Global Relay #001, reporting every second while the relay room announces live changes
  const problems = collectProblems(page)
  const network = populatedNetwork()
  const live = raceLive(network, Date.now())
  let reporting = true
  const reports = setInterval(() => {
    if (reporting) live.updatedAt = Date.now() - 300
  }, 1_000)
  await mockRelayApi(page, network)
  await page.routeWebSocket(/\/ws\/network$/, socket => {
    const announcements = setInterval(() => {
      if (reporting) socket.send(JSON.stringify({ type: 'network_updated', live: true }))
    }, 1_500)
    socket.onClose(() => clearInterval(announcements))
  })

  try {
    // #when a spectator opens the world
    await page.goto('/')
    await expect(page.locator(GLOBE)).toHaveAttribute('data-map-ready', 'true', { timeout: 20_000 })
    // #then the featured relay carries a live line
    await expect(page.getByRole('link', { name: 'MATEO SILVA IS CARRYING THE BATON NOW, 62% · +0.31s' })).toBeVisible()
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: `${SHOTS}/world-live.png` })

    // #when they open the journey
    await page.getByRole('link', { name: 'View journey' }).click()
    // #then the live panel names the runner, progress, ghost gap and world, and its bar reports 62%
    const panel = page.getByRole('region', { name: 'MATEO SILVA IS CARRYING THE BATON NOW' })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('62% · +0.31s vs MEI TAN · Sunbreak Coast')).toBeVisible()
    await expect(panel.getByRole('progressbar', { name: 'Mateo Silva’s leg' })).toHaveAttribute('aria-valuenow', '62')
    await page.waitForTimeout(1_600)
    await page.screenshot({ path: `${SHOTS}/journey-live.png` })

    // #when the reports stop
    reporting = false
    const stoppedAt = Date.now()
    // #then the panel holds while the last report is fresh and disappears once it is 8 s old, with no refetch needed
    await page.waitForTimeout(4_000)
    await expect(panel).toBeVisible()
    await expect(panel).toBeHidden({ timeout: 8_000 })
    expect(Date.now() - stoppedAt).toBeLessThan(8_000 + 2_500)
    expect(problems).toEqual([])
  } finally {
    clearInterval(reports)
  }
})

test.describe('an invitation while the holder has a pass in progress', () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    test(`tells the invitee in a toast that fits a ${viewport.width}×${viewport.height} phone`, async ({ page }) => {
      // #given Sam opens Mateo's invitation while Mateo's pass is still open
      await page.setViewportSize(viewport)
      const problems = collectProblems(page)
      const network = populatedNetwork()
      await mockRelayApi(page, network, signedInAs(RUNNERS.sam, network.snapshot))
      const token = hash(77)
      const invite: NetworkInvite = { id: 'invite-mateo', token, batonId: 'b-global', from: RUNNERS.mateo, recipientId: null, createdAt: Date.now() - HOUR, expiresAt: Date.now() + 23 * HOUR, claimedBy: null, url: `https://nimrelay.xyz/invite/${token}` }
      await page.route(`**/api/station/network/invites/${token}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invite) }))
      await page.route('**/api/station/network/invite/claim', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'holder_pass_in_progress' }) }))
      await page.goto(`/invite/${token}`)

      // #when Sam accepts
      await page.getByRole('button', { name: 'Accept invitation' }).click()

      // #then the toast speaks to Sam rather than the holder, whole on screen, centred above the bottom navigation
      const toast = page.locator('.nr-toast')
      await expect(toast).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/invite-holder-pass-${viewport.width}.png` })
      await expect(toast.locator('p')).toHaveText('The holder has a pass in progress. Ask them to finish it, or try again after it expires.')
      const box = await toast.boundingBox()
      const navBox = await nav(page).boundingBox()
      expect(
        box &&
          navBox && {
            insideLeft: box.x >= 16,
            insideRight: box.x + box.width <= viewport.width - 16,
            centred: Math.abs(box.x + box.width / 2 - viewport.width / 2) <= 1,
            aboveNav: box.y + box.height <= navBox.y,
          },
      ).toEqual({ insideLeft: true, insideRight: true, centred: true, aboveNav: true })
      expect(problems.filter(problem => !problem.includes('status of 409'))).toEqual([])
    })
  }
})

test('a holder back at a pass Nimiq Pay never reported has the chain checked, then recovers it by hand', async ({ page }) => {
  // #given Mateo reopens Global Relay #001 while the pass he declined in Nimiq Pay is still open on the relay
  const problems = collectProblems(page)
  const network = populatedNetwork()
  const account = signedInAs(RUNNERS.mateo, network.snapshot)
  const detail = network.details['G7K2M9Q4XA']
  if (!detail) throw new Error('Global Relay #001 is missing from the fixture')
  const attemptedAt = Date.now() - HOUR
  const intent: NetworkHandoffIntent = {
    id: '6a0c2f7e-8d4b-4f1a-9c3e-2b7d5e1f0a93',
    batonId: detail.baton.id,
    runId: 'run-mateo-5',
    recipientId: RUNNERS.sam.id,
    recipientName: RUNNERS.sam.name,
    sender: RUNNERS.mateo.wallet,
    recipient: RUNNERS.sam.wallet,
    value: detail.baton.value,
    data: 'NR1.G7K2M9Q4XA.5.AAAAAAAAAAAAAAAAAAAAAA',
    network: 'TestAlbatross',
    leg: 5,
    status: 'pending',
    state: 'attempting',
    txHash: null,
    createdAt: attemptedAt - 60_000,
    expiresAt: attemptedAt + 4 * 60_000,
    attemptedAt,
    failure: null,
    note: null,
  }
  detail.pendingHandoff = intent
  account.snapshot.pendingHandoff = intent
  await mockRelayApi(page, network, account)
  const checked = new Set<string>()
  let answerCheck: () => void = () => undefined
  const checkAnswered = new Promise<void>(resolve => {
    answerCheck = resolve
  })
  await page.route('**/api/station/network/handoff/check', async route => {
    checked.add((route.request().postDataJSON() as { id: string }).id)
    await checkAnswered
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(intent) })
  })

  // #when he opens the journey
  await page.goto('/relay/G7K2M9Q4XA')

  // #then the relay checks the chain for the pass before anything else
  const pass = page.getByRole('region', { name: 'Finish your pass to Sam Reed' })
  await expect(pass.getByText('Checking the Nimiq network for this pass…')).toBeVisible()
  await page.waitForTimeout(400)
  await pass.screenshot({ path: `${SHOTS}/pending-pass-checking.png` })

  // #when the chain shows nothing yet
  answerCheck()

  // #then he recovers the pass by hand, told what a decline means for it
  await expect(pass.getByRole('button', { name: 'Verify the pass' })).toBeVisible()
  await expect(pass.getByText('If you declined in Nimiq Pay, choose ‘My wallet shows no transfer’ to approve again, or wait for this pass to expire to choose another runner.')).toBeVisible()
  await expect(pass.getByRole('button', { name: 'My wallet shows no transfer' })).toBeVisible()
  await page.waitForTimeout(400)
  await pass.screenshot({ path: `${SHOTS}/pending-pass-recovery.png` })
  // React's development double mount resumes the pass twice; either way only this pass is checked.
  expect(checked).toEqual(new Set([intent.id]))
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

declare global {
  interface Window {
    __sharedCards: { name: string; data: string }[]
  }
}

/** Replaces the system share sheet with one that keeps each shared file, so cards can be saved and inspected. */
async function captureSharedCards(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const shared: { name: string; data: string }[] = []
    Object.defineProperty(window, '__sharedCards', { value: shared })
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (data?: ShareData) => (data?.files?.length ?? 0) > 0 })
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0]
        if (!file) return
        const url = await new Promise<string>(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.readAsDataURL(file)
        })
        shared.push({ name: file.name, data: url })
      },
    })
  })
}

/** Presses a share control, writes the card it produced to the shots folder and returns the shared file name. */
async function saveCard(page: Page, name: string, share: () => Promise<void>): Promise<string> {
  const before = await page.evaluate(() => window.__sharedCards.length)
  await share()
  await page.waitForFunction(count => window.__sharedCards.length > count, before, { timeout: 15_000 })
  const card = await page.evaluate(index => window.__sharedCards[index], before)
  expect(card?.data).toMatch(/^data:image\/png;base64,/)
  writeFileSync(`${SOCIAL_SHOTS}/card-${name}.png`, Buffer.from(card?.data.split(',')[1] ?? '', 'base64'))
  return card?.name ?? ''
}

/** The sheet at the top, then one screenshot per scrolled screenful, so long screens can be reviewed whole. */
async function shootSheet(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SOCIAL_SHOTS}/${name}.png` })
  const sheet = page.locator('.nr-screen__scroll').last()
  for (let part = 2; part <= 5; part++) {
    const moved = await sheet.evaluate(element => {
      const before = element.scrollTop
      element.scrollTop += element.clientHeight - 80
      return element.scrollTop > before
    })
    if (!moved) break
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${SOCIAL_SHOTS}/${name}-${part}.png` })
  }
  await sheet.evaluate(element => {
    element.scrollTop = 0
  })
}

test.describe('social surfaces', () => {
  test.beforeAll(() => {
    mkdirSync(SOCIAL_SHOTS, { recursive: true })
  })

  test('profile: identicon, level climb, record, achievements, artifacts and proof', async ({ page }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await mockRelayApi(page, network, network.account)
    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Mateo Silva', level: 2 })).toBeVisible()
    await expect(page.locator('.nr-runner-head .nr-avatar__identicon')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'XP toward level 4' })).toHaveAttribute('aria-valuetext', '250 of 500 XP')
    await expect(page.getByText('250 XP to level 4.', { exact: false })).toBeVisible()
    await expect(page.getByText('3 of 11 unlocked')).toBeVisible()
    await expect(page.getByText('Beat the ghost on 10 legs you pass on.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Relay Artifacts' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Wanjiru K/ }).first()).toHaveAttribute('href', '/runner/wanjiru')
    // The wallet address stays behind the Proof disclosure.
    await expect(page.getByText(RUNNERS.mateo.wallet)).toBeHidden()
    await shootSheet(page, 'profile')
    await page.getByText('Proof', { exact: true }).click()
    await expect(page.getByText(RUNNERS.mateo.wallet)).toBeVisible()
    expect(problems).toEqual([])
  })

  test('the avatar identicon is the one Nimiq’s identicon library draws for the address', async ({ page }) => {
    const network = socialNetwork()
    await mockRelayApi(page, network, network.account)
    await page.goto('/profile')
    const image = page.locator('.nr-runner-head .nr-avatar__identicon')
    await expect(image).toBeVisible()
    const source = (await image.getAttribute('src')) ?? ''
    const rendered = Buffer.from(source.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8')
    // Reference: the package's documented API, fed the address as @nimiq/utils normalizeAddress formats it for Nimiq's wallets.
    const identicons = (createRequire(import.meta.url)('@nimiq/identicons') as { default: { svg(text: string): Promise<string> } }).default
    const walletForm = RUNNERS.mateo.wallet.toUpperCase().replace(/[\s+-]|%20/g, '').replace(/(.)(?=(.{4})+$)/g, '$1 ')
    const reference = await identicons.svg(walletForm)
    // Each call draws a random clip-path id, and a browser's XML serializer writes the SVG namespace onto every
    // copied part where Node's parser copies the markup as is. Neither changes the picture.
    const comparable = (svg: string) => svg.replace(/hexagon-clip-\d+/g, 'hexagon-clip').replaceAll(' xmlns="http://www.w3.org/2000/svg"', '')
    expect(comparable(rendered)).toBe(comparable(reference))
  })

  test('crew at risk: streak countdown, crew baton, contributions, history and invite', async ({ page }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await mockRelayApi(page, network, network.account)
    await page.goto('/crew')
    await expect(page.getByRole('heading', { name: 'Rift Valley Runners', level: 2 })).toBeVisible()
    await expect(page.getByText('At risk')).toBeVisible()
    const clock = page.locator('.nr-streak .nr-countdown')
    const first = await clock.textContent()
    expect(first).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    await expect(clock).not.toHaveText(first ?? '', { timeout: 3_000 })
    await expect(page.getByText('One verified pass between different members before midnight UTC keeps the streak.')).toBeVisible()
    await expect(page.getByText('With Wanjiru K')).toBeVisible()
    await expect(page.getByRole('link', { name: 'See the journey' })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Thandi M’s share of crew passes' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent crew passes' })).toBeVisible()
    await expect(page.getByText('You → Wanjiru K')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy crew code RIFT42' })).toBeVisible()
    await shootSheet(page, 'crew')
    expect(problems).toEqual([])
  })

  test('rivals: gold against cyan, a call for runners and a finished rivalry', async ({ page }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await mockRelayApi(page, network, network.account)
    await page.goto('/rivals')
    const live = page.getByRole('article', { name: 'North vs South' })
    await expect(live.getByText('Racing')).toBeVisible()
    await expect(live.getByRole('progressbar', { name: /Your team, verified handoffs toward 10/ })).toHaveAttribute('aria-valuenow', '6')
    await expect(live.getByRole('progressbar', { name: /Lena Vogel’s team/ })).toHaveAttribute('aria-valuenow', '4')
    await expect(live.getByText('Your team needs a runner.', { exact: false })).toBeVisible()
    await expect(live.getByRole('link', { name: 'Take the next leg' })).toHaveAttribute('href', '/relay/GOLDN0RTH1#next-leg')
    await expect(live.locator('.nr-countdown')).toHaveText(/^\dd \d{2}:\d{2}:\d{2}$/)
    await expect(page.getByRole('article', { name: 'Coast Cup' }).getByText('Cyan won')).toBeVisible()
    await shootSheet(page, 'rivals')
    expect(problems).toEqual([])
  })

  test('daily: official result with rank, top percent, ghost above and the board', async ({ page }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await mockRelayApi(page, network, network.account)
    await page.goto('/daily')
    await expect(page.getByText('#3 of 8')).toBeVisible()
    await expect(page.getByText('Top 38%')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Race Mei Tan’s ghost, 1.09s faster' })).toHaveAttribute('href', '/leg/practice?ghost=daily-1')
    await expect(page.getByText('00:58.12')).toBeVisible()
    await expect(page.locator('.nr-daily-cover .nr-countdown')).toHaveText(/^\d{2}:\d{2}:\d{2}$/)
    await expect(page.getByRole('link', { name: 'Watch Arjun Rao’s ride' })).toHaveAttribute('href', '/leg/watch?run=daily-2')
    await shootSheet(page, 'daily')
    expect(problems).toEqual([])
  })

  test('inbox: what needs the runner now, then updates, each one tap from its action', async ({ page }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await mockRelayApi(page, network, network.account)
    await page.goto('/inbox')
    const now = page.getByRole('region', { name: 'Needs you now' })
    await expect(now.getByRole('button', { name: /Carry/ }).first()).toBeVisible()
    await expect(now.getByRole('button', { name: /Lena Vogel saved the next leg for you/ })).toBeVisible()
    await expect(now.getByRole('button', { name: /Rift Valley Runners needs a pass today/ })).toContainText('Streak ends in')
    const updates = page.getByRole('list', { name: 'Notifications' })
    await expect(updates.getByRole('button', { name: /Arjun Rao beat your ghost/ })).toContainText('Race again')
    await shootSheet(page, 'inbox')
    await now.getByRole('button', { name: /Rift Valley Runners needs a pass today/ }).click()
    await expect(page).toHaveURL(/\/crew$/)
    expect(problems).toEqual([])
  })

  test('an empty inbox points to the Daily and the Relay Station', async ({ page }) => {
    const problems = collectProblems(page)
    const quiet = emptySnapshot()
    await mockRelayApi(page, { snapshot: quiet }, signedInAs(RUNNERS.sam, quiet))
    await page.goto('/inbox')
    await expect(page.getByRole('heading', { name: 'Nothing needs you right now' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ride today’s Daily' })).toHaveAttribute('href', '/daily')
    await expect(page.getByRole('link', { name: 'Open the Relay Station' })).toHaveAttribute('href', '/station')
    expect(problems).toEqual([])
  })

  test('without a share sheet, a card downloads and its deep link is copied', async ({ page, context }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(() => {
      Reflect.deleteProperty(Navigator.prototype, 'share')
      Reflect.deleteProperty(Navigator.prototype, 'canShare')
    })
    await mockRelayApi(page, network, network.account)
    await page.goto('/crew')
    const download = page.waitForEvent('download')
    const tracked = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/station/network/track'))
    await page.getByRole('button', { name: 'Share the streak card' }).click()
    expect((await download).suggestedFilename()).toBe('nim-relay-crew-rift-valley-runners.png')
    expect((await tracked).postDataJSON()).toMatchObject({ kind: 'share', surface: 'crew' })
    await expect(page.getByText('Card saved and link copied.')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/crew$/)
    expect(problems).toEqual([])
  })

  test('share cards render to PNG for every moment', async ({ page }) => {
    const problems = collectProblems(page)
    const network = socialNetwork()
    await captureSharedCards(page)
    await mockRelayApi(page, network, network.account)
    const surfaces: string[] = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/api/station/network/track')) surfaces.push((request.postDataJSON() as { surface: string }).surface)
    })

    const shared: string[] = []
    await page.goto('/relay/C4NB7T90RE')
    await expect(page.getByRole('button', { name: 'Share result card' })).toBeEnabled()
    shared.push(await saveCard(page, 'result', () => page.getByRole('button', { name: 'Share result card' }).click()))
    shared.push(await saveCard(page, 'handoff', () => page.getByRole('button', { name: 'Share handoff card' }).last().click()))

    await page.goto('/relay/AUR0RA10XQ')
    shared.push(await saveCard(page, 'milestone', () => page.getByRole('button', { name: 'Share milestone card' }).click()))

    await page.goto('/chronicle/G7K2M9Q4XA')
    shared.push(await saveCard(page, 'chronicle', () => page.getByRole('button', { name: 'Share Chronicle card' }).click()))

    await page.goto('/daily')
    shared.push(await saveCard(page, 'daily', () => page.getByRole('button', { name: 'Share Daily card' }).click()))

    await page.goto('/crew')
    shared.push(await saveCard(page, 'crew', () => page.getByRole('button', { name: 'Share the streak card' }).click()))

    await page.goto('/rivals')
    shared.push(await saveCard(page, 'rival', () => page.getByRole('article', { name: 'North vs South' }).getByRole('button', { name: 'Share rivalry card' }).click()))

    expect(shared).toEqual(['nim-relay-result-c4nb7t90re.png', 'nim-relay-handoff-c4nb7t90re-2.png', 'nim-relay-milestone-aur0ra10xq-10.png', 'nim-relay-g7k2m9q4xa.png', expect.stringMatching(/^nim-relay-daily-\d{4}-\d{2}-\d{2}\.png$/), 'nim-relay-crew-rift-valley-runners.png', 'nim-relay-rivalry-north-vs-south.png'])
    // Every completed share is counted on its surface; rivalries count under the Crew tab they belong to.
    await expect.poll(() => surfaces).toEqual(['result', 'handoff', 'chronicle', 'chronicle', 'daily', 'crew', 'crew'])
    expect(problems).toEqual([])
  })
})
