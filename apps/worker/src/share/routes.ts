import { Hono, type Context } from 'hono'
import type { BatonDetail, RunnerProfile } from '@nim-relay/shared'
import type { Env } from '../env'
import { withPageMeta } from './head'
import { dailyMeta, defaultMeta, inviteMeta, proofMeta, relayMeta, runnerMeta, type PageMeta } from './meta'

/**
 * Page routes that link previews read. Crawlers never run the app's JavaScript, so the Worker serves the
 * app shell with this page's Open Graph and Twitter tags already in the head. Everything else is unchanged.
 */
export const shareRoutes = new Hono<{ Bindings: Env }>()

type ShareContext = Context<{ Bindings: Env }>

const CODE = /^[A-Za-z0-9-]{1,64}$/
const HANDLE = /^@?[A-Za-z0-9_-]{1,40}$/

function origin(c: ShareContext): string {
  return c.env.APP_ORIGIN || new URL(c.req.url).origin
}

async function shell(c: ShareContext, meta: PageMeta): Promise<Response> {
  const page = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)))
  if (!page.ok) return page
  return withPageMeta(page, meta)
}

/** Public read from the relay network. A missing or failing lookup falls back to the default preview. */
async function publicRead<T>(c: ShareContext, path: string): Promise<T | null> {
  try {
    const room = c.env.STATION_ROOM.get(c.env.STATION_ROOM.idFromName('global-v4'))
    const response = await room.fetch(new Request(`https://station/network${path}`, { method: 'POST', body: JSON.stringify({ body: null, actorId: null }) }))
    return response.ok ? ((await response.json()) as T) : null
  } catch (error) {
    console.warn('Link preview lookup failed', error instanceof Error ? error.message : 'unknown')
    return null
  }
}

async function relayPage(c: ShareContext, code: string): Promise<Response> {
  if (!CODE.test(code)) return shell(c, defaultMeta(origin(c), c.req.path))
  const detail = await publicRead<BatonDetail>(c, `/batons/${encodeURIComponent(code)}`)
  return shell(c, detail ? relayMeta(origin(c), c.req.path, detail) : defaultMeta(origin(c), c.req.path))
}

shareRoutes.get('/', c => shell(c, defaultMeta(origin(c), '/')))
for (const prefix of ['/relay', '/r', '/journey', '/chronicle']) {
  shareRoutes.get(`${prefix}/:code`, c => relayPage(c, c.req.param('code')))
}
shareRoutes.get('/proof/relay/:code', c => relayPage(c, c.req.param('code')))
shareRoutes.get('/runner/:handle', async c => {
  const handle = c.req.param('handle')
  if (!HANDLE.test(handle)) return shell(c, defaultMeta(origin(c), c.req.path))
  const profile = await publicRead<RunnerProfile>(c, `/runners/${encodeURIComponent(handle.replace(/^@/, ''))}`)
  return shell(c, profile ? runnerMeta(origin(c), c.req.path, profile) : defaultMeta(origin(c), c.req.path))
})
shareRoutes.get('/invite/:token', c => shell(c, inviteMeta(origin(c), c.req.path)))
shareRoutes.get('/daily', c => shell(c, dailyMeta(origin(c), '/daily')))
shareRoutes.get('/proof', c => shell(c, proofMeta(origin(c), '/proof')))
