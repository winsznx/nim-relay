import { Hono } from 'hono'
import type { Env } from '../env'
import { lookupSession, requireSession, type AuthedVars } from '../auth/middleware'
import { getAuthStore } from '../auth/store'

const MAX_BODY_CHARS = 100_000
const MAX_TRACK_BODY_CHARS = 2_000

export const stationRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>()

const stationRoom = (env: Env) => env.STATION_ROOM.get(env.STATION_ROOM.idFromName('global-v4'))
const crossOrigin = (origin: string | undefined, env: Env, url: string) => Boolean(origin) && origin !== env.APP_ORIGIN && origin !== new URL(url).origin

stationRoutes.get('/public', c => stationRoom(c.env).fetch(new Request('https://station/public')))
stationRoutes.get('/network/public', c => stationRoom(c.env).fetch(new Request('https://station/network/public', { method: 'POST', body: '{}' })))
for (const path of ['/network/batons/:code', '/network/replays/:id', '/network/invites/:token', '/network/runners/:handle', '/network/chronicles/:code']) {
  stationRoutes.get(path, c => stationRoom(c.env).fetch(new Request(`https://station${c.req.path.slice('/api/station'.length)}`, { method: 'POST', body: '{}' })))
}

/** Share tracking works signed in or out; a signed-in runner is counted under their own cap. */
stationRoutes.post('/network/track', async c => {
  if (crossOrigin(c.req.header('Origin'), c.env, c.req.url)) return c.json({ error: 'origin_mismatch' }, 403)
  const text = await c.req.text()
  if (text.length > MAX_TRACK_BODY_CHARS) return c.json({ error: 'request_too_large' }, 413)
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { return c.json({ error: 'bad_request' }, 400) }
  const session = await lookupSession(c.env, getAuthStore(c.env), c.req.raw)
  const actorId = session.ok ? session.session.playerId : null
  return stationRoom(c.env).fetch(new Request('https://station/network/track', { method: 'POST', body: JSON.stringify({ body, actorId }) }))
})

stationRoutes.use('*', requireSession)
stationRoutes.all('*', async c => {
  if (c.req.method !== 'GET' && crossOrigin(c.req.header('Origin'), c.env, c.req.url)) return c.json({ error: 'origin_mismatch' }, 403)
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_BODY_CHARS) return c.json({ error: 'request_too_large' }, 413)
  const player = await getAuthStore(c.env).getPlayerById(c.get('playerId'))
  if (!player) return c.json({ error: 'no_player' }, 401)
  const text = c.req.method === 'GET' ? '' : await c.req.text()
  if (text.length > MAX_BODY_CHARS) return c.json({ error: 'request_too_large' }, 413)
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { return c.json({ error: 'bad_request' }, 400) }
  return stationRoom(c.env).fetch(new Request(`https://station${c.req.path.slice('/api/station'.length) || '/'}`, { method: 'POST', body: JSON.stringify({ player, body, country: c.req.raw.cf?.country }) }))
})
