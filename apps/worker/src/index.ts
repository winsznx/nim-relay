import { Hono } from 'hono'
import type { Env } from './env'
import { RelayRoom } from './durable/relay-room'
import { authRoutes } from './auth/routes'
import { runRoutes } from './runs/routes'

import { shareRoutes } from './share/routes'
import { stationRoutes } from './station/routes'
export { StationRoom } from './station/room'
export { RelayRoom }

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) =>
  c.json({ ok: true, service: 'nim-relay-worker', network: c.env.NIMIQ_NETWORK ?? null }),
)

app.route('/api/station', stationRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/runs', runRoutes)

app.get('/ws/network', c => c.env.STATION_ROOM.get(c.env.STATION_ROOM.idFromName('global-v4')).fetch(c.req.raw))

app.get('/ws/relays/:code', async (c) => {
  const code = c.req.param('code')
  const id = c.env.RELAY_ROOM.idFromName(code)
  const stub = c.env.RELAY_ROOM.get(id)
  return stub.fetch(c.req.raw)
})

app.route('/', shareRoutes)

// Other deep links the Worker sees first still get the plain app shell.
for (const path of ['/r/*', '/invite/*', '/proof/*']) app.get(path, c => c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url))))

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Daily challenge rotation / reconciliation sweep jobs land in Phase 4/6-7.
    console.log('scheduled trigger fired', controller.cron)
  },
} satisfies ExportedHandler<Env>
