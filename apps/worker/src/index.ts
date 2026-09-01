import { Hono } from 'hono'
import type { Env } from './env'
import { RelayRoom } from './durable/relay-room'

export { RelayRoom }

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) =>
  c.json({ ok: true, service: 'nim-relay-worker', network: c.env.NIMIQ_NETWORK ?? null }),
)

app.get('/ws/relays/:code', async (c) => {
  const code = c.req.param('code')
  const id = c.env.RELAY_ROOM.idFromName(code)
  const stub = c.env.RELAY_ROOM.get(id)
  return stub.fetch(c.req.raw)
})

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Daily challenge rotation / reconciliation sweep jobs land in Phase 4/6-7.
    console.log('scheduled trigger fired', controller.cron)
  },
} satisfies ExportedHandler<Env>
