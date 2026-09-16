import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { APP_ORIGIN, APP_PORT, SHOTS_DIR, VIEWPORT } from './env'
import { MockNimiqPay, type RunnerKey } from './wallet'

/** A signed-in-capable runner: their own browser context, Nimiq Pay wallet and page. */
export interface Runner {
  name: string
  page: Page
  wallet: MockNimiqPay
}

interface OpenBrowser {
  label: string
  context: BrowserContext
  page: Page
  closed: boolean
}

/** Ceremony and race copy whose every value is recorded, so stages too brief to poll can still be asserted in order. */
const MILESTONE_SELECTORS = [
  '.handoff-eyebrow',
  '.handoff-title',
  '.handoff-status',
  '.leg-arrival__kicker',
  '.leg-arrival__title',
  '.leg-arrival__ghost-name',
  '.leg-delta__name',
  '.nr-departure__title',
  '.nr-departure__holder',
]
const MILESTONES_KEY = '__nimRelayMilestones'

function recordMilestones({ selectors, key }: { selectors: string[]; key: string }): void {
  const seen: string[] = []
  const shown = new Set<string>()
  Reflect.set(window, key, seen)
  new MutationObserver(() => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const entry = `${selector} ${(element.textContent ?? '').replace(/\s+/g, ' ').trim()}`
        if (shown.has(entry)) continue
        shown.add(entry)
        seen.push(entry)
      }
    }
  }).observe(document, { subtree: true, childList: true, characterData: true })
}

/** Texts `selector` has shown on this page so far, in the order they first appeared. */
export async function milestones(page: Page, selector: string): Promise<string[]> {
  const recorded: unknown = await page.evaluate(key => Reflect.get(window, key), MILESTONES_KEY)
  if (!Array.isArray(recorded)) return []
  return recorded.flatMap(entry => (typeof entry === 'string' && entry.startsWith(`${selector} `) ? [entry.slice(selector.length + 1)] : []))
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png` })
}

/** A signed-out visitor's session probe answers 401 by design; any other failed request or script error is a defect. */
function expectedWhileSignedOut(url: string, text: string): boolean {
  return url.startsWith(APP_ORIGIN) && new URL(url).pathname === '/api/auth/me' && text.includes('status of 401')
}

/**
 * Browser contexts for one test: runners with their wallets and signed-out visitors.
 * Records page and console errors across all of them, keeps each context's video,
 * and keeps traces when the test fails.
 */
export class RelayHarness {
  private readonly browsers: OpenBrowser[] = []
  private readonly errors: string[] = []

  constructor(
    private readonly browser: Browser,
    private readonly testInfo: TestInfo,
  ) {}

  async runner(key: RunnerKey): Promise<Runner> {
    const wallet = await MockNimiqPay.create(key)
    const page = await this.open(key.name.toLowerCase(), async context => {
      await wallet.install(context)
      await context.addInitScript(() => Reflect.set(window, '__NIM_RELAY_E2E_AUTOPILOT__', true))
    })
    return { name: key.name, page, wallet }
  }

  /** A plain browser outside Nimiq Pay, never signed in. */
  async visitor(label = 'visitor'): Promise<Page> {
    return this.open(label, async () => undefined)
  }

  problems(): string[] {
    return [...this.errors]
  }

  /** Closes a runner's browser early, e.g. once they only needed to exist on the network. */
  async leave(page: Page): Promise<void> {
    const open = this.browsers.find(entry => entry.page === page)
    if (open) await this.closeBrowser(open)
  }

  async close(): Promise<void> {
    for (const open of this.browsers) await this.closeBrowser(open)
  }

  private async open(label: string, prepare: (context: BrowserContext) => Promise<void>): Promise<Page> {
    const context = await this.browser.newContext({
      baseURL: APP_ORIGIN,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: this.testInfo.outputPath(`video-${label}`), size: VIEWPORT },
    })
    await context.tracing.start({ title: label, snapshots: true })
    // Pages keep the code they loaded: edits landing in the working tree mid-test must not hot-reload a running race.
    await context.routeWebSocket(url => url.port === String(APP_PORT) && url.pathname === '/', () => undefined)
    await context.addInitScript(recordMilestones, { selectors: MILESTONE_SELECTORS, key: MILESTONES_KEY })
    await prepare(context)
    const page = await context.newPage()
    page.on('pageerror', error => this.errors.push(`[${label}] page error: ${error.message}`))
    page.on('console', message => {
      if (message.type() !== 'error') return
      const { url } = message.location()
      if (expectedWhileSignedOut(url, message.text())) return
      this.errors.push(`[${label}] console error: ${message.text()} (${url})`)
    })
    this.browsers.push({ label, context, page, closed: false })
    return page
  }

  private async closeBrowser(open: OpenBrowser): Promise<void> {
    if (open.closed) return
    open.closed = true
    const failed = this.testInfo.status !== undefined && this.testInfo.status !== this.testInfo.expectedStatus
    await open.context.tracing.stop(failed ? { path: this.testInfo.outputPath(`trace-${open.label}.zip`) } : {})
    const video = open.page.video()
    await open.context.close()
    if (video) await this.testInfo.attach(`video-${open.label}`, { path: await video.path(), contentType: 'video/webm' })
  }
}
