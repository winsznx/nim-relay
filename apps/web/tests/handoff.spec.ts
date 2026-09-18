import { mkdirSync } from 'node:fs'
import { expect, test, type Page, type Route } from '@playwright/test'
import type { BatonDetail, BatonHandoff, IssuedRace, NetworkBaton, NetworkCrew, NetworkHandoffIntent, NetworkInvite, NetworkRunner, PrepareHandoffInput, RelayNote, SubmittedRace } from '@nim-relay/shared'
import { baton, batonAtlasOf, emptySnapshot, fixtureLeg, hash, HOUR, mockRelayApi, profileOf, signedInAs } from './relay-fixtures'

/**
 * The finish of a relay leg as a relay story, on the live finish scene of the handoff lab with the relay API mocked
 * and Nimiq Pay stubbed: the waiting runner's hero card, the relay note, the throw and the departure; and, with
 * nobody waiting, the holographic picker with an open relay invite and its QR code.
 */

declare global {
  interface Window {
    /** Set by the handoff lab: the ceremony state the finish scene is holding. */
    __handoffLabCeremony?: string
  }
}

const SHOTS = '/tmp/nim-relay-finish/shots'
const LAB = '/src/features/handoff/dev/handoff-lab.html'
const CODE = 'AUR0RA0001'
/** A Quick relay whose first opponent never accepted, so its opening pass may seat someone else. */
const REOPENED_MATCH = 'R3MATCH001'
const MINUTE = 60_000

/** A Nimiq address in the compact upper-case form snapshots carry, so identicons draw. */
function wallet(seed: number): string {
  return `NQ${String(20 + seed).padStart(2, '0')}${Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + ((seed * 3 + i * 7) % 26)) + String((seed + i) % 10) + String.fromCharCode(66 + ((seed * 5 + i) % 24)) + String((seed * 7 + i) % 10)).join('')}`
}

function courier(id: string, name: string, country: string | null, seed: number): NetworkRunner {
  return { id, name, handle: id, wallet: wallet(seed), country, countrySource: country ? 'network_observed' : null }
}

const TIM = courier('tim', 'Tim', 'PT', 1)
const MARIANA = courier('mariana', 'Mariana', 'BR', 2)
const YASMINE = courier('yasmine', 'Yasmine', 'MA', 3)
const KOFI = courier('kofi', 'Kofi', 'GH', 4)
const LENA = courier('lena', 'Lena', 'DE', 5)
const SAM = courier('sam', 'Sam', null, 6)
const RUNNERS = [TIM, MARIANA, YASMINE, KOFI, LENA, SAM]
const KOFIS_NOTE: RelayNote = { text: 'Coast is clear. Go!', visibility: 'public' }
const MARIANAS_NOTE: RelayNote = { text: 'Nine countries so far. Don’t drop it.', visibility: 'private' }

function problemsOn(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', error => problems.push(`page error: ${error.message}`))
  page.on('console', message => {
    if (message.type() !== 'error') return
    // The note refusal is an expected 422 from the mocked relay.
    if (/Failed to load resource: the server responded with a status of (401|404|422)/.test(message.text())) return
    problems.push(`console error: ${message.text()}`)
  })
  return problems
}

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

interface Story {
  /** Who the baton is reserved for, if anyone. */
  reservedFor: NetworkRunner | null
  /** The relay refuses any note with `note_not_allowed`. */
  refuseNotes?: boolean
}

interface Recorded {
  prepares: PrepareHandoffInput[]
  invites: number
  /** The signed-in account the story mocks, for responses that carry the runner's station profile. */
  account: ReturnType<typeof signedInAs>
}

/** Tim holds Aurora after Mariana's pass; around him, a crew mate, a match opponent and a runner who just started a relay. */
async function tellStory(page: Page, story: Story): Promise<Recorded> {
  const now = Date.now()
  const aurora: NetworkBaton = {
    ...baton({ id: 'b-aurora', code: CODE, serial: 7, mode: 'global', title: 'Aurora', path: [KOFI, MARIANA, TIM], createdAt: now - 30 * HOUR, updatedAt: now - 2 * HOUR }),
    ...(story.reservedFor ? { recipientId: story.reservedFor.id, recipientReservedAt: now - HOUR, recipientAcceptedAt: now - 50 * MINUTE } : {}),
  }
  const match: NetworkBaton = {
    ...baton({ id: 'b-match', code: 'M4TCH00001', serial: 3, mode: 'quick', title: 'Friday rematch', path: [TIM, SAM], createdAt: now - 26 * HOUR, updatedAt: now - 20 * HOUR }),
    quick: { players: [TIM.id, SAM.id], bestOf: 3, scores: { [TIM.id]: 1, [SAM.id]: 0 }, rounds: 1, winnerId: null, rematchOf: null },
  }
  const reopened: NetworkBaton = {
    ...baton({ id: 'b-reopened', code: REOPENED_MATCH, serial: 4, mode: 'quick', title: 'Sunday decider', path: [TIM], createdAt: now - 30 * HOUR, updatedAt: now - 30 * HOUR }),
    quick: { players: [TIM.id, SAM.id], bestOf: 3, scores: { [TIM.id]: 0, [SAM.id]: 0 }, rounds: 0, winnerId: null, rematchOf: null },
  }
  const coast = baton({ id: 'b-coast', code: 'C0AST00001', serial: 9, mode: 'global', title: 'Coast to coast', path: [YASMINE], createdAt: now - 12 * MINUTE, updatedAt: now - 12 * MINUTE })
  const crew: NetworkCrew = { id: 'crew-rift', code: 'RIFT42', name: 'Rift Runners', members: [TIM, LENA], batonIds: [], streak: 4, bestStreak: 6, todayHandoffs: 0, contributions: {}, deadline: now + 6 * HOUR }
  const handoff = (leg: number, from: NetworkRunner, to: NetworkRunner, at: number, note: RelayNote | null): BatonHandoff => ({
    id: `h-${leg}`,
    batonId: aurora.id,
    leg,
    from,
    to,
    value: aurora.value,
    txHash: hash(40 + leg),
    network: 'TestAlbatross',
    at,
    runId: `run-aurora-${leg}`,
    resultHash: hash(60 + leg),
    qualified: true,
    confirmations: 3,
    blockNumber: 12_000_000 + leg,
    sector: 0,
    race: null,
    rescue: false,
    note,
    atlas: { ...fixtureLeg(leg - 1), backfilled: false, onCourse: true },
  })
  const handoffs = [handoff(1, KOFI, MARIANA, now - 20 * HOUR, KOFIS_NOTE), handoff(2, MARIANA, TIM, now - 2 * HOUR, MARIANAS_NOTE)]
  const detail: BatonDetail = {
    baton: aurora,
    handoffs,
    ghost: null,
    pendingHandoff: null,
    notableRuns: [],
    echoes: [],
    live: null,
    atlas: batonAtlasOf(aurora, handoffs),
  }
  const snapshot = { ...emptySnapshot(), batons: [coast, aurora, match, reopened], crews: [crew], runners: RUNNERS }
  const reopenedDetail: BatonDetail = { baton: reopened, handoffs: [], ghost: null, pendingHandoff: null, notableRuns: [], echoes: [], live: null, atlas: batonAtlasOf(reopened, []) }
  const signedIn = signedInAs(TIM, snapshot)
  const incoming = { id: 'n-aurora', type: 'incoming_baton' as const, title: 'Mariana passed you the baton', body: 'Aurora, handoff 2', batonId: aurora.id, runId: 'run-aurora-2', createdAt: now - 2 * HOUR, readAt: null, note: MARIANAS_NOTE.text }
  const account = { ...signedIn, snapshot: { ...signedIn.snapshot, inbox: [incoming] } }
  await mockRelayApi(page, { snapshot, details: { [CODE]: detail, [REOPENED_MATCH]: reopenedDetail } }, account)

  const profile = { ...profileOf(TIM, snapshot), recentRunners: [MARIANA, KOFI].map(({ name, handle }) => ({ name, handle })) }
  await page.route('**/api/station/network/runners/tim', route => json(route, 200, profile))

  const recorded: Recorded = { prepares: [], invites: 0, account }
  let intent: NetworkHandoffIntent | null = null
  let checks = 0
  await page.route('**/api/station/network/invite', route => {
    recorded.invites++
    const token = hash(recorded.invites + 90)
    const invite: NetworkInvite = { id: `invite-${recorded.invites}`, token, batonId: aurora.id, from: TIM, recipientId: null, createdAt: now, expiresAt: now + 24 * HOUR, claimedBy: null, url: `https://nimrelay.app/invite/${token}` }
    return json(route, 200, invite)
  })
  await page.route('**/api/station/network/handoff/*', route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)
    if (action === 'prepare') {
      const body = route.request().postDataJSON() as PrepareHandoffInput
      recorded.prepares.push(body)
      if (story.refuseNotes && body.note) return json(route, 422, { error: 'note_not_allowed' })
      const recipient = RUNNERS.find(runner => runner.id === body.recipient) ?? YASMINE
      intent = {
        id: '2f1d5c7e-2f5b-4d5e-9a61-1c1f0e3a7b10',
        batonId: aurora.id,
        runId: body.runId,
        recipientId: recipient.id,
        recipientName: recipient.name,
        sender: TIM.wallet,
        recipient: recipient.wallet,
        value: aurora.value,
        data: `NR1.${CODE}.3.commitment`,
        network: 'TestAlbatross',
        leg: 3,
        status: 'pending',
        state: 'prepared',
        txHash: null,
        ...(body.throw ? { throw: body.throw } : {}),
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * MINUTE,
        attemptedAt: null,
        failure: null,
        note: body.note ?? null,
        route: body.routeId ? { routeId: body.routeId, origin: 'fjordgate', destination: body.routeId.split('-to-')[1] ?? 'fjordgate' } : fixtureLeg(3),
      }
      return json(route, 200, intent)
    }
    if (!intent) return json(route, 404, { error: 'handoff_not_found' })
    if (action === 'attempt') return json(route, 200, { ...intent, state: 'attempting', attemptedAt: Date.now() })
    if (action === 'confirm') {
      checks++
      const txHash = (route.request().postDataJSON() as { txHash: string }).txHash
      return json(route, 200, checks === 1 ? { status: 'pending', reason: 'NOT_INCLUDED', intent: { ...intent, state: 'submitted', txHash } } : { status: 'verified', intent: { ...intent, state: 'verified', status: 'verified', txHash } })
    }
    return json(route, 404, { error: 'not_found' })
  })
  return recorded
}

/** Aurora's leg reaches Fjordgate: the route step offers the routes out of it before any runner. */
async function chooseRoute(page: Page, name: RegExp | 'relay', shot?: string): Promise<void> {
  const step = page.getByRole('dialog', { name: 'Where does it go next?' })
  await expect(step).toBeVisible({ timeout: 20_000 })
  await expect(step.getByText('You reached Fjordgate')).toBeVisible()
  if (shot) {
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${SHOTS}/${shot}.png` })
  }
  if (name === 'relay') await step.getByRole('button', { name: 'Let the relay choose' }).click()
  else await step.getByRole('button', { name }).click()
}

async function openFinish(page: Page, code = CODE): Promise<void> {
  // Hot updates from edits elsewhere in the app would reload the lab mid-ceremony; this page never hears of them.
  await page.routeWebSocket(url => url.searchParams.has('token'), () => undefined)
  await page.goto(`${LAB}?code=${code}&world=coast`)
  await expect(page.locator('main.leg[data-phase="finished"]')).toBeVisible({ timeout: 60_000 })
}

/** Holds the launch pad, draws the arc up and lets go. */
async function throwBaton(page: Page, shot?: string): Promise<void> {
  const pad = page.getByRole('button', { name: 'Hold to charge the throw, release to pass the baton' })
  const box = await pad.boundingBox()
  if (!box) throw new Error('The launch pad has no layout box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(page.getByText('Release to throw', { exact: true })).toBeVisible()
  await page.mouse.move(x, y - 50, { steps: 5 })
  await page.waitForTimeout(650)
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}.png` })
  await page.mouse.up()
}

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('a runner waiting for the baton gets the hero card, and the note travels with the throw to the departure', async ({ page }) => {
  // #given Yasmine accepted Tim's invite for the next leg of Aurora
  const problems = problemsOn(page)
  const recorded = await tellStory(page, { reservedFor: YASMINE })

  // #when Tim's leg finishes
  await openFinish(page)

  // #then he first sends the next leg on from Fjordgate: the same route again, or on to Polar Drift or Meridian Yard
  const routes = page.getByRole('dialog', { name: 'Where does it go next?' })
  await expect(routes.getByRole('button')).toContainText([/Again to Fjordgate/, /Polar Drift/, /Meridian Yard/, /Let the relay choose/])
  await chooseRoute(page, /^Polar Drift/, 'finish-00-route-step')

  // #then one holographic hero card hands the baton to Yasmine, with nobody else to choose
  await expect(page.getByText('Next leg: Fjordgate to Polar Drift')).toBeVisible({ timeout: 20_000 })
  const hero = page.getByRole('dialog', { name: 'Handoff to Yasmine' })
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await expect(hero.getByText('Accepted your invite')).toBeVisible()
  await expect(hero.getByText('Ready', { exact: true })).toBeVisible()
  await expect(hero.getByRole('button', { name: 'Choose someone else' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__handoffLabCeremony)).toBe('approach')
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/finish-01-known-runner.png` })

  // #when Tim prepares the handoff and writes a private note
  await hero.getByRole('button', { name: 'Prepare handoff' }).click()
  const note = page.getByRole('dialog', { name: 'Relay note' })
  await expect(note).toBeVisible()
  const input = note.getByRole('textbox', { name: 'Relay note' })
  await expect(input).toHaveAttribute('placeholder', 'Don’t drop the baton.')
  await expect(note.getByText('0/48')).toBeVisible()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/finish-02-note-empty.png` })
  await input.fill('Take it to the coast, Yasmine!')
  await expect(note.getByText('30/48')).toBeVisible()
  await note.getByRole('button', { name: 'Only them' }).click()
  await expect(note.getByRole('button', { name: 'Only them' })).toHaveAttribute('aria-pressed', 'true')
  await expect(note.getByText('Only Yasmine and you can read it.')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/finish-03-note-written.png` })
  await note.getByRole('button', { name: 'Attach note' }).click()

  // #then the launch platform shows the pass with the note attached
  const aim = page.getByRole('dialog', { name: /Passing 1 NIM\s*to Yasmine/ })
  await expect(aim).toBeVisible()
  await expect(aim.getByText('Take it to the coast, Yasmine!')).toBeVisible()
  await expect(aim.getByText('Only you two')).toBeVisible()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/finish-04-launch-pad.png` })

  // #when he throws
  await throwBaton(page, 'finish-05-charging')

  // #then the note is prepared with the pass, the scene freezes for Nimiq Pay, the pass flies and is confirmed
  await expect(page.getByText('Approve the pass in Nimiq Pay')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/finish-06-freeze-wallet.png` })
  expect(recorded.prepares).toHaveLength(1)
  expect(recorded.prepares[0]).toMatchObject({ runId: 'run-lab', recipient: YASMINE.id, note: { text: 'Take it to the coast, Yasmine!', visibility: 'private' }, routeId: 'fjordgate-to-polar-drift' })
  await expect(page.getByRole('dialog', { name: 'Handoff in flight' })).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/finish-07-in-flight.png` })
  await expect(page.getByRole('dialog', { name: 'Handoff confirmed' })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/finish-08-confirmed.png` })

  // #and the departure names the new holder first
  const departure = page.getByRole('status').filter({ hasText: 'has the baton' })
  await expect(departure).toBeVisible({ timeout: 10_000 })
  await expect(departure).toContainText(/Yasmine\s*has the baton/)
  await expect(departure).toContainText('Handoff #3 complete')
  await page.waitForTimeout(1_200)
  await page.screenshot({ path: `${SHOTS}/finish-09-departure.png` })
  expect(problems).toEqual([])
})

test('with nobody waiting, the holder chooses from friends, crew, opponents and the most active runner, or opens the relay', async ({ page }) => {
  // #given nobody is reserved for Aurora and the relay refuses notes it can't carry
  const problems = problemsOn(page)
  const recorded = await tellStory(page, { reservedFor: null, refuseNotes: true })

  // #when Tim's leg finishes and he leaves the route to the relay
  await openFinish(page)
  await chooseRoute(page, 'relay')

  // #then the picker groups who he relays with, and recommends the runner who just started a relay
  const picker = page.getByRole('region', { name: 'Choose the next runner' })
  await expect(picker).toBeVisible({ timeout: 20_000 })
  await expect(picker.getByRole('heading', { name: 'Who carries it next?' })).toBeVisible()
  const section = (name: string) => picker.getByRole('region', { name })
  await expect(section('Friends').getByRole('button')).toHaveText([/Mariana\s*Relayed with you$/, /Kofi\s*Relayed with you$/])
  await expect(section('Crew').getByRole('button')).toHaveText([/Lena\s*Crew member$/])
  await expect(section('Recent opponents').getByRole('button')).toHaveText([/Sam\s*Quick match opponent$/])
  await expect(section('Recommended').getByRole('button')).toHaveText([/Yasmine\s*Started Coast to coast \d+m ago$/])
  await expect(page.getByRole('button', { name: 'Keep the baton for now' })).toBeVisible()
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: `${SHOTS}/finish-10-picker.png` })

  // #when he asks for the open relay's QR code
  const open = page.getByRole('region', { name: 'Open relay' })
  expect(recorded.invites).toBe(0)
  await open.getByRole('button', { name: 'Show QR code' }).click()

  // #then one invite is created and its code is drawn
  const qr = open.getByRole('img', { name: 'QR code for the invite link' })
  await expect(qr).toBeVisible()
  expect(recorded.invites).toBe(1)
  await expect(open.getByRole('button', { name: 'Copy link' })).toBeVisible()
  await qr.scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/finish-11-open-relay-qr.png` })

  // #when he searches by handle instead
  await picker.getByRole('button', { name: 'Find a runner by handle' }).click()
  await picker.getByRole('searchbox', { name: 'Runner handle or name' }).fill('@kof')
  const results = picker.getByRole('list', { name: 'Matching runners' })
  await expect(results.getByRole('button')).toHaveText([/Kofi\s*@kofi$/])
  await page.screenshot({ path: `${SHOTS}/finish-12-search.png` })

  // #and picks Kofi, then writes a note the relay won't carry
  await results.getByRole('button', { name: /^Kofi/ }).click()
  const note = page.getByRole('dialog', { name: 'Relay note' })
  await expect(note.getByText('Kofi', { exact: true })).toBeVisible()
  await note.getByRole('textbox', { name: 'Relay note' }).fill('something the relay refuses')
  await note.getByRole('button', { name: 'Attach note' }).click()
  await throwBaton(page)

  // #then the ceremony returns to the note with the relay's reason, the draft kept and no wallet opened
  const refused = page.getByRole('dialog', { name: 'Relay note' })
  await expect(refused.getByRole('alert')).toHaveText('That note can’t travel with the baton. Write something else, or pass without a note.')
  await expect(refused.getByRole('textbox', { name: 'Relay note' })).toHaveValue('something the relay refuses')
  expect(recorded.prepares).toEqual([expect.objectContaining({ recipient: KOFI.id, note: { text: 'something the relay refuses', visibility: 'public' } })])
  expect(recorded.prepares[0]).not.toHaveProperty('routeId')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/finish-13-note-refused.png` })
  expect(problems).toEqual([])
})

test('notes travel on: the journey route, the Chronicle, the world banner and the inbox', async ({ page }) => {
  // #given Kofi passed Aurora with a public note and Mariana passed it on to Tim with a private one
  const problems = problemsOn(page)
  await tellStory(page, { reservedFor: null })

  // #when Tim opens the journey
  await page.goto(`/relay/${CODE}`)
  const route = page.getByRole('region', { name: 'The route' })
  await expect(route.getByText('Kofi passed to Mariana')).toBeVisible({ timeout: 20_000 })

  // #then both notes are quoted under their handoffs, the private one marked
  await expect(route.getByText(KOFIS_NOTE.text)).toBeVisible()
  await expect(route.getByText(MARIANAS_NOTE.text)).toBeVisible()
  await expect(route.getByText('Only you two')).toHaveCount(1)
  await route.getByText(MARIANAS_NOTE.text).scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/finish-14-journey-notes.png` })

  // #when he reads the Chronicle
  await page.goto(`/chronicle/${CODE}`)

  // #then only the public note is told, by the runner who wrote it
  const stops = page.getByRole('region', { name: 'Route' })
  await expect(stops.getByText(KOFIS_NOTE.text)).toBeVisible({ timeout: 20_000 })
  await expect(stops.getByRole('figure').filter({ hasText: KOFIS_NOTE.text })).toContainText('Kofi')
  await expect(page.getByText(MARIANAS_NOTE.text)).toHaveCount(0)
  await stops.getByText(KOFIS_NOTE.text).scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/finish-15-chronicle-note.png` })

  // #when he returns to the world with the arrival still unread
  await page.goto('/')

  // #then the incoming banner carries Mariana's note
  const banner = page.getByRole('status').filter({ hasText: 'Incoming baton' })
  await expect(banner).toContainText(MARIANAS_NOTE.text, { timeout: 20_000 })
  await page.waitForTimeout(1_200)
  await page.screenshot({ path: `${SHOTS}/finish-16-world-incoming-note.png` })

  // #and so does his inbox
  await page.goto('/inbox')
  await expect(page.getByRole('region', { name: 'Needs you now' }).getByRole('button', { name: /Mariana passed you the baton/ })).toContainText(MARIANAS_NOTE.text)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/finish-17-inbox-note.png` })
  expect(problems).toEqual([])
})

test('a match opponent who never accepted keeps the hero card, and the reopened seat lets the holder choose someone else', async ({ page }) => {
  // #given Tim's Quick relay against Sam, whose reservation lapsed before the first pass
  const problems = problemsOn(page)
  await tellStory(page, { reservedFor: null })

  // #when Tim's opening leg finishes
  await openFinish(page, REOPENED_MATCH)

  // #then a Quick round keeps its route, so there is no route to choose; Sam is still the one waiting
  const hero = page.getByRole('dialog', { name: 'Handoff to Sam' })
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('dialog', { name: 'Where does it go next?' })).toHaveCount(0)
  await expect(hero.getByText('Your match opponent')).toBeVisible()
  await hero.getByRole('button', { name: 'Choose someone else' }).click()

  // #when he looks at everyone else
  const picker = page.getByRole('region', { name: 'Choose the next runner' })
  await expect(picker.getByRole('heading', { name: 'Who carries it next?' })).toBeVisible()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/finish-18-reopened-seat-picker.png` })

  // #then he can return to Sam without losing the handoff
  await page.getByRole('button', { name: 'Back to Sam' }).click()
  await expect(page.getByRole('dialog', { name: 'Handoff to Sam' })).toBeVisible()
  expect(problems).toEqual([])
})

/** Issues Aurora's leg on the current engine and accepts the finished run as a qualified handoff. */
async function issueAndAcceptTheLeg(page: Page, account: Recorded['account']): Promise<void> {
  const issued: IssuedRace = {
    batonId: 'b-aurora',
    networkRace: true,
    relayLeg: 2,
    runId: 'run-aurora-3',
    playerId: TIM.id,
    mode: 'global',
    config: { engineVersion: '6', challenge: 'relay-leg', challengeVersion: '6', seed: `baton-${CODE}-sector-0`, world: 'coast', tier: 1, openingFlow: 0, tetherSaves: 1, ghostline: null },
    expiresAt: Date.now() + 30 * MINUTE,
    target: null,
    mac: 'signed',
    ghost: null,
    sector: { index: 0, startedLeg: 0, firstLeg: false },
    echoes: [],
  }
  await page.route('**/api/station/network/issue', route => json(route, 200, issued))
  await page.route('**/api/station/network/leg/progress', route => json(route, 200, { accepted: true }))
  await page.route('**/api/station/submit', route => {
    const metrics = { perfectGates: 9, totalGates: 12, pulseHits: 4, nearMisses: 2, hits: 0, falls: 0, jumps: 5, cleanLandings: 5, hardLandings: 0, slides: 2, railTicks: 0, boostPadTicks: 40, riskRoutes: 1, laneChanges: 30, cleanLaneChanges: 28, edgeGrinds: 0, edgeSaves: 0, tetherSaves: 0, draftTicks: 0, overtakes: 0, rushes: 1, rushTicks: 180, flowSum: 0, flowPeak: 0 }
    const receipt: SubmittedRace = { runId: issued.runId, result: { score: 18_000, resultHash: hash(99), completed: true, failed: false, ticks: 3_300, timeMs: 55_000, metrics, moments: [] }, created: true, xpEarned: 150, profile: account.station.profile, qualifiedHandoff: true }
    return json(route, 200, receipt)
  })
}

test('the real leg: the note arrives with the baton, a verified finish passes it with one tap, and the world shows who has it', async ({ page }) => {
  test.setTimeout(420_000)
  // #given Yasmine waits for Aurora, and the dev autopilot rides Tim's leg
  const problems = problemsOn(page)
  const { account } = await tellStory(page, { reservedFor: YASMINE })
  await issueAndAcceptTheLeg(page, account)
  await page.addInitScript(() => Reflect.set(window, '__NIM_RELAY_E2E_AUTOPILOT__', true))
  // Nimiq Pay approves the transfer and answers with its hash.
  await page.addInitScript(() => Reflect.set(window, 'nimiq', { listAccounts: async () => [], sendBasicTransactionWithData: async () => 'be'.repeat(32) }))
  await page.routeWebSocket(url => url.searchParams.has('token'), () => undefined)

  // #when Tim opens the leg
  await page.goto(`/leg/${CODE}`)

  // #then the arrival quotes Mariana's note before the race starts
  await expect(page.getByText(`“${MARIANAS_NOTE.text}”`)).toBeVisible({ timeout: 90_000 })
  await page.screenshot({ path: `${SHOTS}/finish-00a-arrival-note.png` })

  // #when the leg is finished and the relay verifies it
  await expect(page.locator('main.leg')).toHaveAttribute('data-phase', 'finished', { timeout: 300_000 })
  const pass = page.getByRole('button', { name: 'PASS AURORA' })
  await expect(pass).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_200)
  await page.screenshot({ path: `${SHOTS}/finish-00b-results-pass.png` })

  // #then one tap opens the handoff: the route out of Fjordgate first, then the runner waiting for it
  await pass.click()
  await chooseRoute(page, /^Again to Fjordgate/)
  const hero = page.getByRole('dialog', { name: 'Handoff to Yasmine' })
  await expect(hero).toBeVisible()
  await expect(hero.getByText('Accepted your invite')).toBeVisible()
  await page.waitForTimeout(1_000)
  await page.screenshot({ path: `${SHOTS}/finish-00c-product-hero.png` })

  // #when he passes without a note and the network confirms
  await hero.getByRole('button', { name: 'Prepare handoff' }).click()
  await page.getByRole('dialog', { name: 'Relay note' }).getByRole('button', { name: 'Pass without a note' }).click()
  await throwBaton(page)
  await expect(page.getByRole('dialog', { name: 'Handoff confirmed' })).toBeVisible({ timeout: 20_000 })

  // #then the world takes over on the journey: Yasmine has the baton, handoff 3 is complete
  const departure = page.getByRole('status').filter({ hasText: 'has the baton' })
  await expect(departure).toContainText(/Yasmine\s*has the baton/, { timeout: 15_000 })
  await expect(departure).toContainText('Handoff #3 complete')
  await expect(page).toHaveURL(new RegExp(`/relay/${CODE}$`))
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: `${SHOTS}/finish-00d-departure-over-the-world.png` })
  expect(problems).toEqual([])
})
