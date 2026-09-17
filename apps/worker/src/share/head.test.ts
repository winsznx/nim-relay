import { describe, expect, it } from 'vitest'
import { withPageMeta } from './head'
import { defaultMeta, inviteMeta, relayMeta } from './meta'
import type { BatonDetail } from '@nim-relay/shared'

const SHELL = `<!doctype html><html><head><title>NIM Relay</title><meta name="description" content="old" /><meta property="og:title" content="old" /></head><body><div id="root"></div></body></html>`

function page(): Response {
  return new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(SHELL.length) } })
}

function detail(overrides: Partial<BatonDetail['baton']> = {}): BatonDetail {
  const runner = { id: 'r1', handle: 'tim', name: 'Tim', wallet: 'NQ00', country: null, countrySource: null }
  return {
    baton: {
      id: 'b1', code: 'AURORA0001', serial: 1, title: 'Aurora', displayName: 'Aurora', mode: 'global', network: 'MainAlbatross', value: 100000,
      origin: runner, holder: { ...runner, name: 'Mariana', id: 'r2' }, createdAt: 0, updatedAt: 0, completedAt: null, status: 'active', handoffCount: 47,
      world: 'coast', route: { seed: 's', world: 'coast', tier: 1, sector: 0, sectorStartedLeg: 0, routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' }, previousRunId: null, crewId: null, rivalId: null,
      recipientId: null, recipientReservedAt: null, recipientAcceptedAt: null, expiresAt: 0, lineage: { countries: ['NG', 'DE'], runners: 31, ghostWins: 3 },
      quick: null, appearance: { handoffCount: 47, ageMs: 0, countries: 2, ghostWins: 3, milestones: [] }, aliveMs: 31_320_000, transactingWallets: 31,
      ...overrides,
    },
    handoffs: [],
    ghost: null,
    pendingHandoff: null,
    notableRuns: [],
    echoes: [],
    live: null,
    atlas: { journey: [], current: { routeId: 'genesis-to-cape-verdigris', origin: 'genesis', destination: 'cape-verdigris' }, next: null },
  }
}

describe('link preview head', () => {
  it('replaces the shell title and preview tags with exactly one set for the page', async () => {
    // #given the default preview for the home page
    const meta = defaultMeta('https://nimrelay.xyz', '/')
    // #when the shell is rewritten
    const html = await withPageMeta(page(), meta).text()
    // #then one title, one description and one og:title remain, with absolute image URLs and a large card
    expect({
      titles: html.match(/<title>/g)?.length,
      descriptions: html.match(/name="description"/g)?.length,
      ogTitles: html.match(/property="og:title"/g)?.length,
      image: html.includes('content="https://nimrelay.xyz/og/default.png"'),
      card: html.includes('name="twitter:card" content="summary_large_image"'),
      stale: html.includes('content="old"'),
    }).toEqual({ titles: 1, descriptions: 1, ogTitles: 1, image: true, card: true, stale: false })
  })

  it('escapes runner-chosen relay names so they cannot break out of the head', async () => {
    // #given a relay named with markup and quotes
    const meta = relayMeta('https://nimrelay.xyz', '/relay/AURORA0001', detail({ displayName: 'Aurora"><script>alert(1)</script>' }))
    // #when the shell is rewritten
    const html = await withPageMeta(page(), meta).text()
    // #then no script element is injected
    expect(html.includes('<script>alert(1)</script>')).toBe(false)
  })

  it('describes a relay with its holder, verified handoffs, countries and age', () => {
    // #given a live global relay
    const meta = relayMeta('https://nimrelay.xyz', '/relay/AURORA0001', detail())
    // #then the preview carries public journey facts
    expect({ title: meta.title, description: meta.description, image: meta.image }).toEqual({
      title: 'Aurora · Global Relay #001 · NIM Relay',
      description: 'Mariana carries it now. 47 verified handoffs, 2 countries, 8h 42m alive. Race the ghost and keep 1 NIM moving.',
      image: 'https://nimrelay.xyz/og/relay.png',
    })
  })

  it('keeps invite tokens out of previews', () => {
    // #given an invite link
    const meta = inviteMeta('https://nimrelay.xyz', '/invite/secret-token')
    // #then only the page URL carries the token and the text reveals nothing about it
    expect({ description: meta.description.includes('secret-token'), image: meta.image }).toEqual({ description: false, image: 'https://nimrelay.xyz/og/invite.png' })
  })
})
