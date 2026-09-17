import { expect, test as base, type Page, type Response } from '@playwright/test'
import { nimiqAddressFromPrivateKey } from '@nim-relay/relay-protocol'
import { ceremonyHeading, chooseOnwardRoute, expectDeparture, finishLeg, joinNetwork, journeyPath, journeyStats, keepNetworkBusy, mainNav, openLeg, startQuickRelay, statValue, throwBaton } from './lifecycle/flows'
import { milestones, RelayHarness, shot, type Runner } from './lifecycle/harness'
import { TREASURY_TEST_KEY } from './lifecycle/env'
import { mockChain } from './lifecycle/rpc'
import { MARIANA, NOOR, TIM } from './lifecycle/wallet'

/**
 * The relay lifecycle in real browsers against an isolated Worker (playwright.lifecycle.config.ts):
 * sign-in, a Quick relay, server-verified legs, handoffs through a mocked Nimiq Pay, custody,
 * ghost lineage and the public record, plus every way a pass can stall.
 */

const test = base.extend<{ relay: RelayHarness }>({
  relay: async ({ browser }, use, testInfo) => {
    const harness = new RelayHarness(browser, testInfo)
    await use(harness)
    await harness.close()
  },
})

const HANDOFF_API = '/api/station/network/handoff/'

/** Handoff API responses on `page`, collected from now on. */
function handoffResponses(page: Page, action: 'prepare' | 'attempt' | 'confirm'): Response[] {
  const responses: Response[] = []
  page.on('response', response => {
    if (new URL(response.url()).pathname === `${HANDOFF_API}${action}`) responses.push(response)
  })
  return responses
}

async function intentIdOf(response: Response): Promise<string> {
  const body: unknown = await response.json()
  const id: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'id') : undefined
  if (typeof id !== 'string') throw new Error(`handoff response without an intent id: ${JSON.stringify(body)}`)
  return id
}

function requestedIntentId(response: Response): string {
  const body: unknown = response.request().postDataJSON()
  const id: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'id') : undefined
  if (typeof id !== 'string') throw new Error(`handoff request without an intent id: ${JSON.stringify(body)}`)
  return id
}

function broadcastHash(runner: Runner): string {
  const { hash } = runner.wallet.lastTransfer()
  if (!hash) throw new Error(`${runner.name}'s last transfer was never broadcast`)
  return hash
}

/**
 * Tim, holding a fresh Quick relay against Mariana, has just finished a verified leg: the handoff zone is open.
 * Mariana's browser closes once she has joined unless the test still needs her online.
 */
async function timInHandoffZone(relay: RelayHarness, options: { marianaOnline?: boolean } = {}): Promise<{ tim: Runner; mariana: Runner; code: string }> {
  const mariana = await relay.runner(MARIANA)
  await joinNetwork(mariana)
  if (!options.marianaOnline) await relay.leave(mariana.page)
  const tim = await relay.runner(TIM)
  await joinNetwork(tim)
  const code = await startQuickRelay(tim, 'Mariana')
  await openLeg(tim, code)
  await finishLeg(tim)
  return { tim, mariana, code }
}

async function expectTimStillHolds(page: Page, code: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`${journeyPath(code)}$`))
  await expect(page.getByText(/You hold it/)).toBeVisible()
  await expect(statValue(journeyStats(page), 'verified handoffs')).toHaveText('0')
}

test('two runners carry a Quick relay there and back through verified handoffs', async ({ relay }) => {
  // #given Mariana and Tim have joined the network from their own Nimiq Pay wallets
  const mariana = await relay.runner(MARIANA)
  await joinNetwork(mariana)
  const tim = await relay.runner(TIM)
  await joinNetwork(tim)

  // #when Tim starts a best-of-three Quick relay against Mariana and she accepts the next leg
  const code = await startQuickRelay(tim, 'Mariana')
  await mainNav(mariana.page).getByRole('link', { name: /^World/ }).click()
  const reserved = mariana.page.getByRole('status').filter({ hasText: 'Reserved for you' })
  await expect(reserved).toContainText('Tim saved the next leg', { timeout: 30_000 })
  await reserved.getByRole('button', { name: 'Accept' }).click()
  await expect(reserved).toBeHidden()

  // #when Tim carries leg 1 and the server verifies the run
  await openLeg(tim, code)
  await shot(tim.page, 'lifecycle-01-tim-leg1-arrival')
  // A Quick round's opening pass keeps its Atlas route, so no route step is offered.
  const handoff = await finishLeg(tim)
  await expect(handoff.getByText('Your match opponent')).toBeVisible()

  // #when he throws the baton to Mariana and approves the pass in Nimiq Pay
  tim.wallet.answerTransfers({ kind: 'approve', approvalMs: 3_000, rpcLatencyMs: 3_000 })
  await throwBaton(tim, 'Mariana', 'lifecycle-02-handoff1')
  await expect(tim.page.getByText('Approve the pass in Nimiq Pay')).toBeVisible()
  await shot(tim.page, 'lifecycle-03-handoff1-wallet')
  await expect(ceremonyHeading(tim.page, 'Handoff in flight')).toBeVisible({ timeout: 10_000 })
  await shot(tim.page, 'lifecycle-04-handoff1-in-flight')
  await expect(ceremonyHeading(tim.page, 'Handoff confirmed')).toBeVisible({ timeout: 20_000 })
  await shot(tim.page, 'lifecycle-05-handoff1-confirmed')

  // #then the pass is locked before Nimiq Pay opens, goes in flight, confirms, and leaves with the departure banner
  expect(await milestones(tim.page, '.handoff-eyebrow')).toEqual(['Handoff to', 'Launch platform', 'Pass locked', 'Nimiq network', 'Verified on Nimiq'])
  expect(await milestones(tim.page, '.handoff-status')).toEqual(['Locking the pass…', 'Approve the pass in Nimiq Pay'])
  const titles = await milestones(tim.page, '.handoff-title')
  expect(titles.indexOf('Handoff in flight')).toBeGreaterThan(-1)
  expect(titles.indexOf('Handoff in flight')).toBeLessThan(titles.indexOf('Handoff confirmed'))
  await expectDeparture(tim.page, 1, 'Mariana', { shot: 'lifecycle-06-handoff1-departure' })
  const firstHash = broadcastHash(tim)
  expect(tim.wallet.lastTransfer()).toMatchObject({ value: 100_000, data: expect.stringMatching(new RegExp(`^NR1\\.${code}\\.1\\.`)) })

  // #then the journey shows Mariana holding the baton after one verified handoff, with its transaction
  await expect(tim.page).toHaveURL(new RegExp(`${journeyPath(code)}$`), { timeout: 15_000 })
  await expect(tim.page.getByText(/Mariana holds it/)).toBeVisible()
  await expect(statValue(journeyStats(tim.page), 'verified handoffs')).toHaveText('1')
  await expect(tim.page.getByText('Tim passed to Mariana')).toBeVisible()
  const atlas = tim.page.getByRole('region', { name: 'Across the Atlas' })
  const firstLeg = (await atlas.getByRole('listitem').first().locator('.nr-atlas-step__title').innerText()).replace(/^Leg 1: /, '')
  await expect(atlas.getByRole('listitem').nth(1)).toContainText(`Leg 2: ${firstLeg}`)
  const proof = tim.page.getByRole('link', { name: 'Transaction proof' })
  await expect(proof).toHaveAttribute('href', `/proof/relay/${code}#tx-${firstHash}`)
  await shot(tim.page, 'lifecycle-07-journey-after-handoff1')
  await proof.click()
  const lineage = tim.page.locator(`[id="tx-${firstHash}"]`)
  await expect(lineage).toContainText('Leg 1')
  await expect(lineage).toContainText(firstHash)

  // #then Mariana's world announces her turn
  const incoming = mariana.page.getByRole('status').filter({ hasText: 'Incoming baton' })
  await expect(incoming).toContainText('Tim passed you the baton', { timeout: 30_000 })
  await expect(mainNav(mariana.page).getByRole('link', { name: /Inbox, \d+ unread/ })).toBeVisible()
  await shot(mariana.page, 'lifecycle-08-mariana-incoming')
  await incoming.getByRole('button', { name: 'Open' }).click()
  await expect(mariana.page.getByText(/You hold it/)).toBeVisible()

  // #when Mariana carries leg 2 against Tim's verified ghost
  await openLeg(mariana, code)
  await expect(mariana.page.getByText('FROM TIM', { exact: true })).toBeVisible({ timeout: 30_000 })
  await shot(mariana.page, 'lifecycle-09-mariana-arrival-from-tim')
  await expect(mariana.page.getByText(/^PREVIOUS RUNNER TIM\b/)).toBeVisible({ timeout: 30_000 })
  await shot(mariana.page, 'lifecycle-10-mariana-mission')
  const relayProgress = mariana.page.getByRole('progressbar', { name: 'Distance to the handoff gate' })
  await expect(relayProgress).toBeVisible({ timeout: 30_000 })
  await expect(relayProgress).toHaveAttribute('aria-valuetext', /^\d+%/)
  // The round closes with this pass, so Mariana sends leg 3 onward from the station leg 2 reached.
  let chosen = { from: '', to: '' }
  const marianaHandoff = await finishLeg(mariana, {
    route: async page => {
      chosen = await chooseOnwardRoute(page, 'lifecycle-11a-mariana-route-step')
    },
  })
  expect(await milestones(mariana.page, '.leg-arrival__kicker')).toContain('BATON INCOMING')
  expect(await milestones(mariana.page, '.leg-relay__name--previous')).toContain('TIM')
  await shot(mariana.page, 'lifecycle-11-mariana-results')
  await expect(marianaHandoff.getByText('Your match opponent')).toBeVisible()

  // #when she passes the baton back to Tim
  await throwBaton(mariana, 'Tim', 'lifecycle-12-handoff2')
  await expect(ceremonyHeading(mariana.page, 'Handoff confirmed')).toBeVisible({ timeout: 30_000 })
  await expectDeparture(mariana.page, 2, 'Tim', { shot: 'lifecycle-13-handoff2-departure' })
  const secondHash = broadcastHash(mariana)

  // #then Tim's world shows the baton back with him after two verified handoffs
  await mainNav(tim.page).getByRole('link', { name: /^World/ }).click()
  const back = tim.page.getByRole('status').filter({ hasText: 'Incoming baton' })
  await expect(back).toContainText('Mariana passed you the baton', { timeout: 30_000 })
  await shot(tim.page, 'lifecycle-14-tim-baton-back')
  await back.getByRole('button', { name: 'Open' }).click()
  await expect(tim.page.getByText(/You hold it/)).toBeVisible()
  await expect(statValue(journeyStats(tim.page), 'verified handoffs')).toHaveText('2')
  await expect(tim.page.getByText('1 of 3 rounds played', { exact: false })).toBeVisible()

  // #then the Atlas journey moved from leg 2's route to the route Mariana bound for leg 3
  const timAtlas = tim.page.getByRole('region', { name: 'Across the Atlas' })
  await expect(timAtlas.getByRole('listitem')).toHaveCount(3)
  await expect(timAtlas.getByRole('listitem').nth(1)).toContainText(`Leg 2: ${firstLeg}`)
  await expect(timAtlas.getByRole('listitem').nth(1)).toContainText(firstLeg.split(' to ')[1] ?? '')
  await expect(timAtlas.getByRole('listitem').nth(2)).toContainText(`Leg 3: ${chosen.from} to ${chosen.to}`)
  await expect(timAtlas.getByRole('listitem').nth(2)).toContainText('Tim is carrying it now')
  await shot(tim.page, 'lifecycle-15-tim-journey-round-one')

  // #then the public proof and Chronicle record both handoffs for anyone
  const visitor = await relay.visitor()
  await visitor.goto('/proof')
  await visitor.getByRole('link', { name: new RegExp(code) }).click()
  await expect(visitor).toHaveURL(new RegExp(`/proof/relay/${code}$`))
  for (const hash of [firstHash, secondHash]) await expect(visitor.locator(`[id="tx-${hash}"]`)).toContainText(hash)
  await shot(visitor, 'lifecycle-16-public-proof')
  await visitor.goto(`/chronicle/${code}`)
  await expect(visitor.getByText('Leg 1, received by Mariana')).toBeVisible()
  await expect(visitor.getByText('Leg 2, received by Tim')).toBeVisible()
  for (const hash of [firstHash, secondHash]) await expect(visitor.getByRole('link', { name: `${hash.slice(0, 10)}…${hash.slice(-8)}` })).toBeVisible()
  await shot(visitor, 'lifecycle-17-public-chronicle')

  expect(relay.problems()).toEqual([])
})

test('a declined approval pauses the pass and the retry sends the same locked intent', async ({ relay }) => {
  // #given Tim in the handoff zone, and a wallet that declines once
  const { tim } = await timInHandoffZone(relay)
  const prepared = handoffResponses(tim.page, 'prepare')
  const attempts = handoffResponses(tim.page, 'attempt')
  tim.wallet.answerTransfers({ kind: 'decline' }, { kind: 'approve' })

  // #when he throws and declines in Nimiq Pay
  await throwBaton(tim, 'Mariana')

  // #then the pass is paused with the baton still his
  await expect(ceremonyHeading(tim.page, 'Pass paused')).toBeVisible()
  await expect(tim.page.getByText('The baton is still with you.')).toBeVisible()
  await shot(tim.page, 'decline-01-pass-paused')

  // #when he approves again
  await tim.page.getByRole('button', { name: 'Approve again' }).click()

  // #then the same intent is sent and verified
  await expect(ceremonyHeading(tim.page, 'Handoff confirmed')).toBeVisible({ timeout: 30_000 })
  await expectDeparture(tim.page, 1, 'Mariana')
  expect(prepared).toHaveLength(1)
  const intentId = await intentIdOf(prepared[0]!)
  expect(attempts.map(requestedIntentId)).toEqual([intentId, intentId])
  const [declined, approved] = tim.wallet.transfers
  expect(declined?.outcome).toBe('decline')
  expect(approved).toMatchObject({ outcome: 'approve', recipient: declined?.recipient, data: declined?.data })
  expect(relay.problems()).toEqual([])
})

test('an insufficient balance asks for the relay value and keeps the baton', async ({ relay }) => {
  // #given Tim in the handoff zone with a wallet short of 1 NIM
  const { tim, code } = await timInHandoffZone(relay)
  tim.wallet.answerTransfers({ kind: 'insufficient-balance' })

  // #when he throws the baton
  await throwBaton(tim, 'Mariana')

  // #then the ceremony names the required amount and the baton stays with him
  await expect(ceremonyHeading(tim.page, 'This relay requires 1 NIM')).toBeVisible()
  await expect(tim.page.getByText('Add NIM to your wallet, then approve again. The baton is still with you.')).toBeVisible()
  await shot(tim.page, 'insufficient-01-requires-1-nim')
  await tim.page.getByRole('button', { name: 'Keep the baton for now' }).click()
  await expectTimStillHolds(tim.page, code)
  await shot(tim.page, 'insufficient-02-journey')
  expect(relay.problems()).toEqual([])
})

test('a wallet timeout asks the runner to check their wallet and the pasted reference verifies', async ({ relay }) => {
  // #given Tim in the handoff zone, and Nimiq Pay timing out after broadcasting
  const { tim } = await timInHandoffZone(relay)
  tim.wallet.answerTransfers({ kind: 'timeout' })

  // #when he throws the baton
  await throwBaton(tim, 'Mariana')

  // #then the recovery panel asks for the transaction reference instead of sending again
  await expect(ceremonyHeading(tim.page, 'Check your wallet')).toBeVisible()
  await shot(tim.page, 'timeout-01-check-your-wallet')

  // #when he pastes the reference of the transfer that was actually broadcast
  await tim.page.getByLabel('Transaction reference').fill(broadcastHash(tim))
  await tim.page.getByRole('button', { name: 'Verify the pass' }).click()

  // #then the server verifies it and the baton moves
  await expect(ceremonyHeading(tim.page, 'Handoff confirmed')).toBeVisible({ timeout: 30_000 })
  await expectDeparture(tim.page, 1, 'Mariana')
  expect(tim.wallet.transfers).toHaveLength(1)
  expect(relay.problems()).toEqual([])
})

test('a transfer short of confirmations stays in flight until the chain confirms it', async ({ relay }) => {
  // #given Tim in the handoff zone, and a transfer included with one confirmation
  const { tim } = await timInHandoffZone(relay)
  const confirmations = handoffResponses(tim.page, 'confirm')
  tim.wallet.answerTransfers({ kind: 'approve', confirmations: 1 })

  // #when he throws the baton
  await throwBaton(tim, 'Mariana')

  // #then the pass stays in flight through a second confirmation check
  const inFlight = ceremonyHeading(tim.page, 'Handoff in flight')
  await expect(inFlight).toBeVisible()
  await shot(tim.page, 'confirmations-01-in-flight')
  await expect.poll(() => confirmations.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  for (const response of confirmations) expect(await response.json()).toMatchObject({ status: 'pending', reason: 'INSUFFICIENT_CONFIRMATIONS' })
  await expect(inFlight).toBeVisible()

  // #when the chain reaches two confirmations
  await mockChain.confirm(broadcastHash(tim), 2)

  // #then the next check verifies the handoff
  await expect(ceremonyHeading(tim.page, 'Handoff confirmed')).toBeVisible({ timeout: 30_000 })
  await expectDeparture(tim.page, 1, 'Mariana')
  expect(relay.problems()).toEqual([])
})

test('a transfer to the wrong wallet is not verified and the baton stays with the sender', async ({ relay }) => {
  // #given Tim in the handoff zone, and a wallet that pays someone else
  const { tim, code } = await timInHandoffZone(relay)
  tim.wallet.answerTransfers({ kind: 'wrong-recipient' })

  // #when he throws the baton
  await throwBaton(tim, 'Mariana')

  // #then the server rejects the transfer and says why
  await expect(ceremonyHeading(tim.page, 'Handoff not verified')).toBeVisible({ timeout: 30_000 })
  await expect(tim.page.getByText('The transfer went to a different wallet than the runner you chose.')).toBeVisible()
  await expect(tim.page.getByText('The baton stays with you until a matching transfer is verified.')).toBeVisible()
  await shot(tim.page, 'wrong-recipient-01-not-verified')

  // #then custody never moved, in his journey or in the public record
  await tim.page.getByRole('button', { name: 'Back to the journey' }).click()
  await expectTimStillHolds(tim.page, code)
  const visitor = await relay.visitor()
  await visitor.goto(`/proof/relay/${code}`)
  await expect(visitor.getByText('No handoff has been verified for this relay yet.')).toBeVisible()
  await expect(visitor.locator(`[id="tx-${broadcastHash(tim)}"]`)).toHaveCount(0)
  expect(relay.problems()).toEqual([])
})

test('a confirmed handoff departs on time while other runners keep the network busy', async ({ relay }) => {
  // #given Tim in the handoff zone while Mariana's app writes to the network every 700 ms
  const { tim, mariana, code } = await timInHandoffZone(relay, { marianaOnline: true })
  const stopWriting = await keepNetworkBusy(mariana)

  // #when his pass is verified
  await throwBaton(tim, 'Mariana')
  await expect(ceremonyHeading(tim.page, 'Handoff confirmed')).toBeVisible({ timeout: 30_000 })

  // #then the launch cinematic still hands over to the journey, instead of restarting on every network refresh
  await expectDeparture(tim.page, 1, 'Mariana', { withinMs: 8_000 })
  await expect(tim.page).toHaveURL(new RegExp(`${journeyPath(code)}$`))
  await stopWriting()
  expect(relay.problems()).toEqual([])
})

test('a new runner claims the Starter Baton, sees it confirm, then passes it on through a verified handoff', async ({ relay }) => {
  // #given a funded grant treasury, Mariana on the network, and Noor signing in for the first time with an empty wallet
  await mockChain.balance(await nimiqAddressFromPrivateKey(TREASURY_TEST_KEY), 50 * 100_000)
  const mariana = await relay.runner(MARIANA)
  await joinNetwork(mariana)
  await relay.leave(mariana.page)
  const noor = await relay.runner(NOOR)
  await joinNetwork(noor)

  // #when the World home offers the Starter Baton and she claims it
  await mainNav(noor.page).getByRole('link', { name: /^World/ }).click()
  const offer = noor.page.locator('[data-tour="starter-baton-banner"]')
  await expect(offer).toContainText('Your first relay is on us', { timeout: 30_000 })
  await shot(noor.page, 'grant-01-offer')
  await offer.getByRole('button', { name: 'Claim' }).click()
  await noor.page.getByRole('dialog', { name: 'Starter Baton' }).getByRole('button', { name: 'Claim Starter Baton' }).click()
  await expect(noor.page.getByText('Confirming on Nimiq')).toBeVisible({ timeout: 30_000 })
  await shot(noor.page, 'grant-02-confirming')

  // #then the Worker broadcast one treasury transfer; once the chain confirms it, the baton is revealed
  await expect.poll(() => mockChain.sent(), { timeout: 20_000 }).toHaveLength(1)
  const [grantHash] = await mockChain.sent()
  await mockChain.confirm(grantHash!, 2)
  const reveal = noor.page.getByRole('dialog', { name: 'You received your first baton' })
  await expect(reveal).toBeVisible({ timeout: 60_000 })
  await shot(noor.page, 'grant-03-reveal')
  expect(noor.wallet.transfers).toHaveLength(0)

  // #when she carries the Starter Baton and passes it to Mariana
  await reveal.getByRole('button', { name: 'Carry it' }).click()
  await expect(noor.page).toHaveURL(/\/leg\/[A-Z0-9]+$/)
  const code = new URL(noor.page.url()).pathname.split('/').at(-1) ?? ''
  await expect(noor.page.locator('main.leg')).toHaveAttribute('data-phase', 'finished', { timeout: 240_000 })
  await noor.page.getByRole('button', { name: /^PASS / }).click({ timeout: 30_000 })
  await noor.page.getByRole('button', { name: 'Let the relay choose' }).click()
  await noor.page.getByRole('button', { name: 'Find a runner by handle' }).click()
  await noor.page.getByRole('searchbox', { name: 'Runner handle or name' }).fill('Mariana')
  await noor.page.getByRole('list', { name: 'Matching runners' }).getByRole('button', { name: /Mariana/ }).click()
  await shot(noor.page, 'grant-04-choose-mariana')
  await throwBaton(noor, 'Mariana', 'grant-05-handoff', { picked: true })
  await expect(ceremonyHeading(noor.page, 'Handoff confirmed')).toBeVisible({ timeout: 30_000 })

  // #then that pass is the first verified handoff; the grant never counted as one
  await expectDeparture(noor.page, 1, 'Mariana')
  expect(noor.wallet.lastTransfer()).toMatchObject({ value: 100_000, data: expect.stringMatching(new RegExp(`^NR1\\.${code}\\.1\\.`)) })
  await expect(noor.page).toHaveURL(new RegExp(`${journeyPath(code)}$`), { timeout: 15_000 })
  await expect(statValue(journeyStats(noor.page), 'verified handoffs')).toHaveText('1')
  const visitor = await relay.visitor()
  await visitor.goto(`/proof/relay/${code}`)
  await expect(visitor.locator('[data-kind="treasury_starter_grant"]')).toContainText(grantHash!)
  await expect(visitor.locator(`[id="tx-${broadcastHash(noor)}"]`)).toContainText('Leg 1')
  await shot(visitor, 'grant-06-proof')
  expect(relay.problems()).toEqual([])
})
