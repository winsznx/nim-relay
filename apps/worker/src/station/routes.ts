import { Hono } from 'hono'
import type { Env } from '../env'
import { requireSession, type AuthedVars } from '../auth/middleware'
import { getAuthStore } from '../auth/store'
export const stationRoutes = new Hono<{ Bindings: Env; Variables: AuthedVars }>()
stationRoutes.get('/public', c => c.env.STATION_ROOM.get(c.env.STATION_ROOM.idFromName('global-v4')).fetch(new Request('https://station/public')))
stationRoutes.get('/network/public', c => c.env.STATION_ROOM.get(c.env.STATION_ROOM.idFromName('global-v4')).fetch(new Request('https://station/network/public', { method: 'POST', body: '{}' })))
for (const path of ['/network/batons/:code', '/network/replays/:id', '/network/invites/:token']) stationRoutes.get(path, c => c.env.STATION_ROOM.get(c.env.STATION_ROOM.idFromName('global-v4')).fetch(new Request(`https://station${c.req.path.slice('/api/station'.length)}`, { method: 'POST', body: '{}' })))
stationRoutes.use('*', requireSession)
stationRoutes.all('*', async c => {
  const origin = c.req.header('Origin')
  if (c.req.method !== 'GET' && origin && origin !== c.env.APP_ORIGIN && origin !== new URL(c.req.url).origin) return c.json({ error: 'origin_mismatch' }, 403)
  if (Number(c.req.header('Content-Length') ?? 0) > 100000) return c.json({ error: 'request_too_large' }, 413)
  const player = await getAuthStore(c.env).getPlayerById(c.get('playerId'))
  if (!player) return c.json({ error: 'no_player' }, 401)
  const text = c.req.method === 'GET' ? '' : await c.req.text()
  if (text.length > 100000) return c.json({ error: 'request_too_large' }, 413)
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { return c.json({ error: 'bad_request' }, 400) }
  return c.env.STATION_ROOM.get(c.env.STATION_ROOM.idFromName('global-v4')).fetch(new Request(`https://station${c.req.path.slice('/api/station'.length) || '/'}`, { method: 'POST', body: JSON.stringify({ player, body, country: c.req.raw.cf?.country }) }))
})
