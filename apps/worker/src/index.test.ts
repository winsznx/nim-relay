import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// Runs inside real workerd via @cloudflare/vitest-pool-workers - PRD section
// 39.3 "Use current Workers Vitest integration", not a Node.js mock.
describe('worker health', () => {
  it('GET /api/health responds ok', async () => {
    const res = await SELF.fetch('https://example.com/api/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, service: 'nim-relay-worker' })
  })
})
