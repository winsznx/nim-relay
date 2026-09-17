import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { RUNNERS, mockRelayApi, populatedNetwork, signedInAs } from './relay-fixtures'

const SHOTS = '/tmp/nim-relay-atlas/shots'
const GLOBE = '.nr-world__globe'
const CODE = 'G7K2M9Q4XA'

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

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true })
})

test('the world lights up the Atlas: stations and routes lit only by verified legs', async ({ page }) => {
  // #given a network whose Global Relay has raced four Atlas legs
  const problems = collectProblems(page)
  await mockRelayApi(page, populatedNetwork())

  // #when the world opens
  await page.goto('/')
  await expect(page.locator(GLOBE)).toHaveAttribute('data-map-ready', 'true', { timeout: 20_000 })

  // #then the community meter counts the lit stations and routes, and the hero counts Atlas stations, not countries
  const meter = page.getByRole('group', { name: 'Light the world' })
  await expect(meter).toContainText('5/24 stations, 4/55 routes')
  await expect(page.getByRole('link', { name: 'Genesis Station → Aurora Ridge' })).toBeVisible()
  await expect(page.getByText('Atlas stations')).toBeVisible()
  await expect(page.getByText('network-observed countries')).toHaveCount(0)
  await expect(page.getByText('Location not shared')).toHaveCount(0)
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: `${SHOTS}/atlas-01-world.png` })
  expect(problems).toEqual([])
})

test('a route sheet tells verified runs, runners, the fastest run and the batons on it', async ({ page }) => {
  // #given the route Mei raced for Global Relay #001
  const problems = collectProblems(page)
  await mockRelayApi(page, populatedNetwork())

  // #when its sheet opens, as a tap on the globe opens it
  await page.goto('/atlas/route/fjordgate-to-polar-drift')

  // #then the sheet reads the route's verified record
  await expect(page.getByRole('heading', { name: 'Fjordgate to Polar Drift', level: 1 })).toBeVisible()
  const stats = page.getByRole('group', { name: 'Route statistics' })
  await expect(stats).toContainText('1verified runs')
  await expect(stats).toContainText('1qualified runners')
  await expect(page.getByText('Fastest run')).toBeVisible()
  await expect(page.getByText(/by Mei Tan, leg 4/)).toBeVisible()
  await expect(page.getByText('Stations are destinations in the game world. They never show where a runner is.')).toBeVisible()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/atlas-02-route-sheet.png` })

  // #and a route nobody raced says it is dark, with the active baton racing toward Aurora Ridge on the lit one next door
  await page.goto('/atlas/route/polar-drift-to-aurora-ridge')
  await expect(page.getByRole('heading', { name: 'This route is still dark' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Global Relay #001' })).toBeVisible()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/atlas-03-dark-route.png` })
  expect(problems).toEqual([])
})

test('a baton journey replays its hops across the Atlas with a scrubber', async ({ page }) => {
  // #given Global Relay #001, four verified legs and a fifth in progress
  const problems = collectProblems(page)
  await mockRelayApi(page, populatedNetwork())

  // #when its journey opens and the Atlas section is scrubbed back to the first hop
  await page.goto(`/relay/${CODE}`)
  const atlas = page.getByRole('region', { name: 'Across the Atlas' })
  await expect(atlas).toBeVisible({ timeout: 20_000 })
  await expect(atlas.getByRole('listitem')).toHaveCount(5)
  await expect(atlas.getByRole('listitem').last()).toContainText('Mateo Silva is carrying it now')
  const scrubber = atlas.getByRole('slider', { name: 'Journey hop' })
  await expect(scrubber).toHaveValue('4')
  await scrubber.fill('0')

  // #then the first hop out of Genesis Station is the one shown
  await expect(atlas.getByText('Leg 1: Genesis Station to Cape Verdigris').first()).toBeVisible()
  await expect(atlas.locator('[data-current="true"]')).toContainText('Leg 1: Genesis Station to Cape Verdigris')
  await atlas.scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/atlas-04-journey-scrubber.png` })
  expect(problems).toEqual([])
})

test('the profile shows Atlas progress and missions, complete and locked', async ({ page }) => {
  // #given Mateo, who holds Global Relay #001
  const problems = collectProblems(page)
  const network = populatedNetwork()
  await mockRelayApi(page, network, signedInAs(RUNNERS.mateo, network.snapshot))

  // #when he opens his profile
  await page.goto('/profile')

  // #then his Atlas progress and missions read from his record
  const atlas = page.getByRole('region', { name: 'Relay Atlas' })
  await expect(atlas).toBeVisible({ timeout: 20_000 })
  await expect(atlas.getByText('stations visited')).toBeVisible()
  await expect(atlas.getByText('EXPLORER', { exact: true })).toBeVisible()
  await expect(atlas.getByText('Rewards are profile marks, never NIM.', { exact: false })).toBeVisible()
  await atlas.scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${SHOTS}/atlas-05-profile.png` })
  expect(problems).toEqual([])
})
