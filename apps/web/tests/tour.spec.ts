import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page, type Request, type TestInfo } from '@playwright/test'
import type { NetworkSnapshot, TourTrackInput } from '@nim-relay/shared'
import { HOUR, RUNNERS, emptySnapshot, mockRelayApi, populatedNetwork, signedInAs } from './relay-fixtures'
import { socialNetwork } from './social-fixtures'

const SHOTS = '/tmp/nim-relay-tour/shots'
const GLOBE = '.nr-world__globe'
const TOUR_KEY = 'nim-relay-tour:core:v1'
const JOURNEY = '/relay/G7K2M9Q4XA'

/** Runtime failures on the page. A signed-out session check answers 401 by design. */
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

/** Every tour event the app reports, in order. */
function recordTourEvents(page: Page): TourTrackInput[] {
  const events: TourTrackInput[] = []
  page.on('request', (request: Request) => {
    if (!request.url().endsWith('/api/station/network/track') || request.method() !== 'POST') return
    const body = request.postDataJSON() as { kind?: string }
    if (body.kind === 'tour') events.push(body as TourTrackInput)
  })
  return events
}

const eventNames = (events: readonly TourTrackInput[]) => events.map(event => (event.stepId ? `${event.event}:${event.stepId}` : event.event))

async function shoot(page: Page, info: TestInfo, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` })
}

const offer = (page: Page) => page.getByRole('region', { name: 'Want a 60-second tour?' })
const coach = (page: Page, title: string) => page.getByRole('dialog', { name: title })
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

async function tourState(page: Page): Promise<unknown> {
  return page.evaluate(key => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { state: string }).state : null
  }, TOUR_KEY)
}

/** Fully inside the viewport, with every button at least 44 px tall. */
async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize()
  const box = await locator.boundingBox()
  expect(box && viewport && { left: box.x >= 0, top: box.y >= 0, right: box.x + box.width <= viewport.width, bottom: box.y + box.height <= viewport.height }).toEqual({ left: true, top: true, right: true, bottom: true })
  for (const button of await locator.getByRole('button').all()) {
    const buttonBox = await button.boundingBox()
    expect(buttonBox && viewport && { inside: buttonBox.x >= 0 && buttonBox.y >= 0 && buttonBox.x + buttonBox.width <= viewport.width && buttonBox.y + buttonBox.height <= viewport.height, tall: buttonBox.height >= 44 }).toEqual({ inside: true, tall: true })
  }
}

/**
 * The lit ring surrounds the target, and the coach mark doesn't cover it. The globe's target is the Earth's disc
 * rather than its full-screen canvas, so there the ring must be a circle centered on the upper half of the screen.
 */
async function expectSpotlightOn(page: Page, target: Locator | 'globe', card: Locator): Promise<void> {
  await expect(page.locator('.nr-tour__ring')).toBeVisible()
  // The glide between targets takes 280 ms.
  await page.waitForTimeout(450)
  const ring = await page.locator('.nr-tour__ring').boundingBox()
  const viewport = page.viewportSize()
  const box =
    target === 'globe'
      ? ring && viewport && Math.abs(ring.width - ring.height) < 1 && ring.y + ring.height / 2 < viewport.height / 2 && ring.width > viewport.width * 0.8
        ? { x: ring.x + 1, y: ring.y + 1, width: ring.width - 2, height: ring.height - 2 }
        : null
      : await target.boundingBox()
  const cardBox = await card.boundingBox()
  // A ring stays a few pixels inside the screen, so a target touching an edge is surrounded up to that edge.
  const edge = 4
  expect(
    ring &&
      box &&
      viewport && {
        left: ring.x <= Math.max(box.x, edge) + 1,
        top: ring.y <= Math.max(box.y, edge) + 1,
        right: ring.x + ring.width >= Math.min(box.x + box.width, viewport.width - edge) - 1,
        bottom: ring.y + ring.height >= Math.min(box.y + box.height, viewport.height - edge) - 1,
      },
  ).toEqual({ left: true, top: true, right: true, bottom: true })
  const overlaps = ring && cardBox && cardBox.x < ring.x + ring.width && cardBox.x + cardBox.width > ring.x && cardBox.y < ring.y + ring.height && cardBox.y + cardBox.height > ring.y
  expect(overlaps).toBe(false)
}

async function openHome(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator(GLOBE)).toHaveAttribute('data-map-ready', 'true', { timeout: 20_000 })
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('a first visit is offered the tour, and Show me around walks every step across the app', async ({ page }, info) => {
  // #given a first-time visitor on a live network
  const problems = collectProblems(page)
  const events = recordTourEvents(page)
  await mockRelayApi(page, populatedNetwork(), undefined, { tour: 'unseen' })

  // #when the world home settles
  await openHome(page)
  // #then the offer appears, whole on screen, without blocking the world
  await expect(offer(page)).toBeVisible({ timeout: 10_000 })
  await expectWithinViewport(page, offer(page))
  await page.waitForTimeout(500)
  await shoot(page, info, '00-offer')

  // #when the visitor asks to be shown around
  await offer(page).getByRole('button', { name: 'Show me around' }).click()

  // #then each step points at the real thing, on its own screen
  const steps: { title: string; category: string; path: string; target: (page: Page) => Locator | 'globe'; tap?: boolean }[] = [
    { title: 'Watch NIM move', category: 'The relay world', path: '/', target: () => 'globe' },
    { title: 'This is what everyone carries', category: 'The baton', path: '/', target: p => p.getByRole('article').filter({ hasText: 'Global Relay #001' }) },
    { title: 'Every stop, on the record', category: 'Follow a journey', path: '/', target: p => p.getByRole('link', { name: 'View journey' }), tap: true },
    { title: 'Batons find you here', category: 'Your relay inbox', path: JOURNEY, target: p => nav(p).getByRole('link', { name: 'Inbox' }) },
    { title: 'Your turn shows up first', category: 'When the baton reaches you', path: '/inbox', target: p => p.getByRole('heading', { name: 'Your batons arrive here' }) },
    { title: 'Race to pass it on', category: 'Run your leg', path: '/inbox', target: p => nav(p).getByRole('button', { name: 'Play' }).locator('svg') },
    { title: 'Beat the ghost', category: 'Race a real run', path: JOURNEY, target: p => p.getByRole('link', { name: 'Race this ghost in practice' }) },
    { title: 'Crews and rivals', category: 'Don’t run alone', path: '/crew', target: p => p.getByRole('link', { name: 'Rivals' }) },
    { title: 'One course for everyone', category: 'Today’s route', path: '/daily', target: p => p.getByRole('heading', { name: /Midnight Metro|Solar Frontier|Sunbreak Coast|Glacier Line|Ocean/ }) },
    { title: 'Every leg stays with you', category: 'Your relay history', path: '/profile', target: p => p.getByRole('heading', { name: 'Your runner lives here' }) },
  ]
  for (const [index, step] of steps.entries()) {
    const card = coach(page, step.title)
    await expect(card).toBeVisible({ timeout: 8_000 })
    await expect(page).toHaveURL(new RegExp(`${step.path === '/' ? '/$' : step.path}$`))
    await expect(card.getByText(step.category)).toBeVisible()
    await expect(card.getByText(`Step ${index + 1} of ${steps.length}`)).toBeAttached()
    await expect(card.getByRole('button', { name: index === steps.length - 1 ? 'Finish' : 'Next' })).toBeFocused()
    const target = step.target(page)
    await expectSpotlightOn(page, target === 'globe' ? target : target.first(), card)
    await expectWithinViewport(page, card)
    await shoot(page, info, `${String(index + 1).padStart(2, '0')}-${step.title.toLowerCase().replace(/[^a-z]+/g, '-')}`)
    if (step.tap && target !== 'globe') await target.click()
    else await card.getByRole('button', { name: index === steps.length - 1 ? 'Finish' : 'Next' }).click()
  }

  // #then the completion card closes the tour with its two ways out
  const finale = page.getByRole('dialog', { name: /Catch\sit\. Carry\sit\. Pass\sit\son\./ })
  await expect(finale).toBeVisible()
  await expect(page.locator('.nr-tour__ring')).toBeHidden()
  await expectWithinViewport(page, finale)
  await page.waitForTimeout(500)
  await shoot(page, info, '11-ready')
  expect(await tourState(page)).toBe('completed')

  // #when the visitor goes exploring
  await finale.getByRole('button', { name: 'Explore NIM Relay' }).click()
  // #then they are back on the world home, free to use it, and the funnel saw the whole walk
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  await nav(page).getByRole('link', { name: 'Inbox' }).click()
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  await expect.poll(() => eventNames(events).at(-1)).toBe('completed')
  expect(eventNames(events)).toEqual([
    'offered',
    'started',
    ...steps.flatMap((_, index) => {
      const ids = ['relay-world', 'featured-relay', 'open-journey', 'nav-inbox', 'inbox-turns', 'nav-play', 'ghost', 'social-modes', 'daily', 'profile-history']
      return [`step_viewed:${ids[index]}`, `step_completed:${ids[index]}`]
    }),
    'completed',
  ])
  expect(events.every(event => event.entryRoute === undefined || !event.entryRoute.includes('?'))).toBe(true)
  expect(problems).toEqual([])
})

/** Starts the tour from the offer and waits for its first step. */
async function startFromOffer(page: Page): Promise<void> {
  await expect(offer(page)).toBeVisible({ timeout: 10_000 })
  await offer(page).getByRole('button', { name: 'Show me around' }).click()
  await expect(coach(page, 'Watch NIM move')).toBeVisible()
}

async function next(page: Page, title: string): Promise<void> {
  const card = coach(page, title)
  await expect(card).toBeVisible({ timeout: 8_000 })
  await card.getByRole('button', { name: 'Next' }).click()
}

test('Back returns to the previous step and its screen, and Escape leaves the tour', async ({ page }) => {
  // #given a first-time visitor who walked to the inbox step
  const problems = collectProblems(page)
  await mockRelayApi(page, populatedNetwork(), undefined, { tour: 'unseen' })
  await openHome(page)
  await startFromOffer(page)
  for (const title of ['Watch NIM move', 'This is what everyone carries', 'Every stop, on the record', 'Batons find you here']) await next(page, title)
  await expect(coach(page, 'Your turn shows up first')).toBeVisible()
  await expect(page).toHaveURL(/\/inbox$/)

  // #when they go back twice
  await coach(page, 'Your turn shows up first').getByRole('button', { name: 'Back' }).click()
  await expect(coach(page, 'Batons find you here')).toBeVisible()
  await coach(page, 'Batons find you here').getByRole('button', { name: 'Back' }).click()
  // #then the journey step shows again on the world home, where its target is
  await expect(coach(page, 'Every stop, on the record')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await expect(coach(page, 'Every stop, on the record').getByText('Step 3 of 10')).toBeAttached()

  // #when they press Escape
  await page.keyboard.press('Escape')
  // #then the tour is gone, recorded as skipped, and the world home is theirs
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  expect(await tourState(page)).toBe('skipped')
  expect(problems).toEqual([])
})

test('Skip tour mid-way hands the app back where the tour started and is never offered again', async ({ page }, info) => {
  // #given a visitor on the daily step of the tour
  const problems = collectProblems(page)
  const events = recordTourEvents(page)
  await mockRelayApi(page, populatedNetwork(), undefined, { tour: 'unseen' })
  await openHome(page)
  await startFromOffer(page)
  for (const title of ['Watch NIM move', 'This is what everyone carries', 'Every stop, on the record', 'Batons find you here']) await next(page, title)
  const inboxStep = coach(page, 'Your turn shows up first')
  await expect(inboxStep).toBeVisible()

  // #when they skip the tour
  await inboxStep.getByRole('button', { name: 'Skip tour' }).click()

  // #then nothing of the tour is left, they are back home, and the whole app responds again
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  await page.waitForTimeout(400)
  await shoot(page, info, 'skip-restored')
  await nav(page).getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('dialog', { name: 'Play' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'View journey' }).click()
  await expect(page.getByRole('heading', { name: 'Global Relay #001', level: 1 })).toBeVisible()
  expect({ state: await tourState(page), skipped: events.find(event => event.event === 'skipped') }).toEqual({
    state: 'skipped',
    skipped: expect.objectContaining({ stepId: 'inbox-turns', stepNumber: 5 }),
  })

  // #when they come back later
  await openHome(page)
  await page.waitForTimeout(2_500)
  // #then no offer appears
  await expect(offer(page)).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a visitor who declined, or a runner who finished on another device, is not offered the tour', async ({ page }) => {
  // #given a visitor who chose to explore on their own
  const problems = collectProblems(page)
  const events = recordTourEvents(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, undefined, { tour: 'unseen' })
  await openHome(page)
  await expect(offer(page)).toBeVisible({ timeout: 10_000 })
  await offer(page).getByRole('button', { name: 'I’ll explore' }).click()
  await expect(offer(page)).toHaveCount(0)
  expect({ state: await tourState(page), declined: eventNames(events).at(-1) }).toEqual({ state: 'skipped', declined: 'skipped' })

  // #when they return
  await openHome(page)
  await page.waitForTimeout(2_500)
  // #then there is no offer
  await expect(offer(page)).toHaveCount(0)

  // #given a runner signed in on a fresh device and browser session whose runner record says they completed the tour
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  const account = signedInAs(RUNNERS.ada, network.snapshot)
  await mockRelayApi(page, network, account, { tour: 'unseen' })
  let preferenceReads = 0
  await page.route('**/api/station/network/preferences', route => {
    preferenceReads++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tours: { core: { version: 'v1', state: 'completed', updatedAt: Date.now() - HOUR } } }) })
  })
  // #when they open the world
  await openHome(page)
  await page.waitForTimeout(2_500)
  // #then the synced record keeps the offer away and lands on this device
  await expect(offer(page)).toHaveCount(0)
  expect({ state: await tourState(page), preferenceReads }).toEqual({ state: 'completed', preferenceReads: 1 })
  expect(problems).toEqual([])
})

test('replaying from the profile or the Play sheet leaves first-run progress untouched', async ({ page }, info) => {
  // #given a visitor who completed the tour long ago
  const problems = collectProblems(page)
  const events = recordTourEvents(page)
  await mockRelayApi(page, populatedNetwork())
  const before = await (async () => {
    await page.goto('/profile')
    return page.evaluate(key => localStorage.getItem(key), TOUR_KEY)
  })()

  // #when they take the tour again from their profile
  await page.getByRole('button', { name: 'Take the product tour' }).click()
  // #then it starts on the world home
  await expect(coach(page, 'Watch NIM move')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await next(page, 'Watch NIM move')
  await expect(coach(page, 'This is what everyone carries')).toBeVisible()

  // #when they skip it
  await coach(page, 'This is what everyone carries').getByRole('button', { name: 'Skip tour' }).click()
  // #then they are back on their profile with their first-run record unchanged
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), TOUR_KEY)).toBe(before)

  // #when they ask for the tour from the Play sheet instead
  await nav(page).getByRole('button', { name: 'Play' }).click()
  const play = page.getByRole('dialog', { name: 'Play' })
  await expect(play.getByRole('button', { name: 'Take the tour' })).toBeVisible()
  await page.waitForTimeout(500)
  await shoot(page, info, 'play-sheet')
  await play.getByRole('button', { name: 'Take the tour' }).click()
  // #then the sheet makes way for the tour
  await expect(coach(page, 'Watch NIM move')).toBeVisible()
  await expect(play).toBeHidden()
  await page.waitForTimeout(400)
  await shoot(page, info, 'replay-from-play')
  await page.keyboard.press('Escape')
  await expect(page.locator('.nr-tour')).toHaveCount(0)

  // #then only replays were reported, and the stored record never moved
  expect({ events: eventNames(events), stored: await page.evaluate(key => localStorage.getItem(key), TOUR_KEY) }).toEqual({ events: ['replayed', 'replayed'], stored: before })
  expect(problems).toEqual([])
})

test('taps on the dimmed app, and on an explanatory step’s own target, do nothing', async ({ page }) => {
  // #given the step that explains the featured relay card
  const problems = collectProblems(page)
  await mockRelayApi(page, populatedNetwork(), undefined, { tour: 'unseen' })
  await openHome(page)
  await startFromOffer(page)
  await next(page, 'Watch NIM move')
  const step = coach(page, 'This is what everyone carries')
  await expect(step).toBeVisible()
  await page.waitForTimeout(450)

  // #when the visitor taps the bottom navigation, the top bar and the card's own buttons
  const tapCenter = async (locator: Locator) => {
    const box = await locator.boundingBox()
    if (!box) throw new Error('nothing to tap')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  await tapCenter(nav(page).getByRole('link', { name: 'Inbox' }))
  await tapCenter(page.getByRole('button', { name: 'Sign in' }))
  await tapCenter(page.getByRole('button', { name: 'Join next leg' }))
  await tapCenter(page.getByRole('link', { name: 'View journey' }))

  // #then nothing opened and the tour is still on the same step
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(/\/$/)
  await expect(step).toBeVisible()
  await expect(page.getByRole('dialog', { name: /sign in/i })).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a step whose target never appears is skipped after a short wait, without leaving the overlay stuck', async ({ page }) => {
  // #given a Daily screen whose tour target never renders
  const problems = collectProblems(page)
  const events = recordTourEvents(page)
  await page.addInitScript(() => {
    const strip = () => {
      for (const element of document.querySelectorAll('[data-tour="daily"]')) element.removeAttribute('data-tour')
    }
    new MutationObserver(strip).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tour'] })
  })
  await mockRelayApi(page, populatedNetwork(), undefined, { tour: 'unseen' })
  await openHome(page)
  await startFromOffer(page)
  for (const title of ['Watch NIM move', 'This is what everyone carries', 'Every stop, on the record', 'Batons find you here', 'Your turn shows up first', 'Race to pass it on', 'Beat the ghost']) await next(page, title)
  await expect(coach(page, 'Crews and rivals')).toBeVisible()

  // #when the visitor moves on to the Daily step
  const movedAt = Date.now()
  await coach(page, 'Crews and rivals').getByRole('button', { name: 'Next' }).click()

  // #then the tour lands on the profile step within the wait, one step shorter, and reports the missing target
  const profile = coach(page, 'Every leg stays with you')
  await expect(profile).toBeVisible({ timeout: 6_000 })
  expect(Date.now() - movedAt).toBeLessThan(4_500)
  await expect(profile.getByText('Step 9 of 9')).toBeAttached()
  await expect.poll(() => eventNames(events).includes('target_missing:daily')).toBe(true)
  await profile.getByRole('button', { name: 'Finish' }).click()
  await page.getByRole('button', { name: 'Explore NIM Relay' }).click()
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  expect(problems).toEqual([])
})

test('an invitation link is never interrupted by the offer; the world home later gets the quiet prompt once', async ({ page }, info) => {
  // #given a first-time visitor arriving on an invitation
  const problems = collectProblems(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, undefined, { tour: 'unseen' })
  const token = 'a1b2c3d4e5f6a7b8c9d0e1f2'
  await page.route(`**/api/station/network/invites/${token}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'invite-1', token, batonId: 'b-global', from: RUNNERS.mateo, recipientId: null, createdAt: Date.now() - HOUR, expiresAt: Date.now() + 23 * HOUR, claimedBy: null, url: `https://nimrelay.xyz/invite/${token}` }) }),
  )
  await page.goto(`/invite/${token}`)
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible()
  await page.waitForTimeout(2_500)
  // #then neither the offer nor the prompt covers it
  await expect(offer(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New here? Take the 60-second tour.' })).toHaveCount(0)

  // #when they head to the world home afterwards
  await nav(page).getByRole('link', { name: 'World' }).click()
  // #then a quiet prompt appears instead of the offer, and nothing is recorded yet
  const prompt = page.getByRole('complementary', { name: 'Product tour' })
  await expect(prompt).toBeVisible({ timeout: 10_000 })
  await expect(offer(page)).toHaveCount(0)
  await expectWithinViewport(page, prompt)
  await page.waitForTimeout(400)
  await shoot(page, info, 'nudge')
  expect(await tourState(page)).toBeNull()

  // #when they dismiss it and come back to the world home
  await prompt.getByRole('button', { name: 'Dismiss the tour suggestion' }).click()
  await expect(prompt).toHaveCount(0)
  await nav(page).getByRole('link', { name: 'Crew' }).click()
  await nav(page).getByRole('link', { name: 'World' }).click()
  await page.waitForTimeout(2_000)
  // #then it doesn't return this session, and still nothing is recorded
  await expect(prompt).toHaveCount(0)
  expect(await tourState(page)).toBeNull()
  expect(problems).toEqual([])
})

test('a runner with an unread incoming baton sees only the baton, then the quiet prompt once it is opened', async ({ page }) => {
  // #given a signed-in runner who was just passed Global Relay #001
  const problems = collectProblems(page)
  const network = populatedNetwork()
  const account = signedInAs(RUNNERS.ada, network.snapshot)
  const arrival = { id: 'n-arrival', type: 'incoming_baton' as const, title: 'Mateo Silva passed you the baton', body: 'Global Relay #001, handoff 5', batonId: 'b-global', runId: null, createdAt: Date.now() - 60_000, readAt: null as number | null }
  account.snapshot = { ...account.snapshot, inbox: [arrival] } satisfies NetworkSnapshot
  await mockRelayApi(page, network, account, { tour: 'unseen' })

  // #when they open the world home
  await openHome(page)
  await expect(page.getByText('Incoming baton')).toBeVisible()
  await page.waitForTimeout(2_500)
  // #then no offer or prompt competes with the arrival
  await expect(offer(page)).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Product tour' })).toHaveCount(0)

  // #when the arrival has been opened and they come back to the world home
  arrival.readAt = Date.now()
  await openHome(page)
  // #then the quiet prompt appears, never the full offer
  await expect(page.getByRole('complementary', { name: 'Product tour' })).toBeVisible({ timeout: 10_000 })
  await expect(offer(page)).toHaveCount(0)
  expect(problems).toEqual([])
})

test('on an empty network the tour explains what isn’t there yet, without pointing at anything made up', async ({ page }, info) => {
  // #given a first visit to a network with no relays
  const problems = collectProblems(page)
  await mockRelayApi(page, { snapshot: emptySnapshot() }, undefined, { tour: 'unseen' })
  await openHome(page)
  await startFromOffer(page)
  await expect(coach(page, 'Watch NIM move').getByText('Routes light up here as real NIM batons pass from person to person.')).toBeVisible()
  await expect(coach(page, 'Watch NIM move').getByText('Step 1 of 9')).toBeAttached()
  await next(page, 'Watch NIM move')

  // #then the baton step points at the empty hero and says no baton is moving
  const empty = coach(page, 'Every relay starts with one NIM')
  await expect(empty.getByText('No baton is moving here yet. Start the first one with 1 NIM, or practice a leg.')).toBeVisible()
  await expectSpotlightOn(page, page.getByRole('article').filter({ hasText: 'How far can one NIM travel?' }), empty)
  await shoot(page, info, 'empty-02-baton')
  await next(page, 'Every relay starts with one NIM')

  // #then there is no journey step, and the ghost step explains itself on a centered card
  await expect(coach(page, 'Batons find you here')).toBeVisible()
  for (const title of ['Batons find you here', 'Your turn shows up first', 'Race to pass it on']) await next(page, title)
  const ghost = coach(page, 'Beat the ghost')
  await expect(ghost.getByText('When a runner came before you, you race their ghost, replayed from the ride the server verified.')).toBeVisible()
  await expect(page.locator('.nr-tour__ring')).toBeHidden()
  await expectWithinViewport(page, ghost)
  await page.waitForTimeout(400)
  await shoot(page, info, 'empty-06-ghost')
  await ghost.getByRole('button', { name: 'Skip tour' }).click()
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a signed-in runner’s first choice about the tour is saved to their runner record', async ({ page }) => {
  // #given a signed-in runner with no tour record anywhere
  const problems = collectProblems(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, signedInAs(RUNNERS.ada, network.snapshot), { tour: 'unseen' })
  const saved: unknown[] = []
  await page.route('**/api/station/network/preferences/tour', route => {
    saved.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tours: { core: { version: 'v1', state: 'skipped', updatedAt: Date.now() } } }) })
  })

  // #when the offer appears and they choose to explore
  await openHome(page)
  await expect(offer(page)).toBeVisible({ timeout: 10_000 })
  await offer(page).getByRole('button', { name: 'I’ll explore' }).click()

  // #then the choice is on this device and sent to the server
  await expect.poll(() => saved).toEqual([{ tourId: 'core', version: 'v1', state: 'skipped' }])
  expect(await tourState(page)).toBe('skipped')
  expect(problems).toEqual([])
})

test('a signed-in runner replays the tour over their own inbox, crew and relay history', async ({ page }, info) => {
  // #given Mateo, who holds a baton, has a crew and a relay history
  const problems = collectProblems(page)
  const events = recordTourEvents(page)
  const network = socialNetwork()
  await mockRelayApi(page, network, network.account)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Mateo Silva', level: 2 })).toBeVisible()

  // #when he replays the tour from his profile
  await page.getByRole('button', { name: 'Take the product tour' }).click()
  for (const title of ['Watch NIM move', 'This is what everyone carries', 'Every stop, on the record', 'Batons find you here']) await next(page, title)

  // #then the inbox step points at what needs him now
  const inbox = coach(page, 'Your turn shows up first')
  await expect(inbox).toBeVisible()
  await page.waitForTimeout(600)
  await shoot(page, info, 'signed-in-05-inbox')
  await expectSpotlightOn(page, page.getByRole('button', { name: /Your turn with Global Relay #001/ }), inbox)
  await expectWithinViewport(page, inbox)
  for (const title of ['Your turn shows up first', 'Race to pass it on', 'Beat the ghost']) await next(page, title)

  // #then the crew step points at Rivals over his own crew
  const crew = coach(page, 'Crews and rivals')
  await expect(crew).toBeVisible()
  await expectSpotlightOn(page, page.getByRole('link', { name: 'Rivals' }), crew)
  await shoot(page, info, 'signed-in-08-crew')
  await next(page, 'Crews and rivals')
  await next(page, 'One course for everyone')

  // #then his relay history, far down the profile, is scrolled into view and lit
  const history = coach(page, 'Every leg stays with you')
  await expect(history).toBeVisible()
  await expect(history.getByText('Batons you carried, the achievements they earned and your runner level all stay here.')).toBeVisible()
  await page.waitForTimeout(700)
  await expectSpotlightOn(page, page.getByRole('heading', { name: 'Batons', exact: true }), history)
  await expectWithinViewport(page, history)
  await shoot(page, info, 'signed-in-10-history')
  await history.getByRole('button', { name: 'Finish' }).click()
  await page.getByRole('button', { name: 'Try a practice run' }).click()

  // #then the practice run opens, with no wallet prompt, and only the replay was reported
  await expect(page).toHaveURL(/\/leg\/practice$/)
  await expect(page.locator('.nr-tour')).toHaveCount(0)
  expect(eventNames(events)).toEqual(['replayed'])
  expect(problems).toEqual([])
})
