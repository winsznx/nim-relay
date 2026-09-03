import { describe, expect, it } from 'vitest'
import { buildLoginMessage, isNonceExpired, issueLoginNonce } from './nonce'

describe('login nonce', () => {
  it('issues a fresh, unexpired nonce', () => {
    const n = issueLoginNonce()
    expect(n.nonce).toHaveLength(36) // uuid
    expect(isNonceExpired(n)).toBe(false)
  })

  it('expires after its TTL', () => {
    const n = issueLoginNonce()
    expect(isNonceExpired(n, n.expiresAt + 1)).toBe(true)
    expect(isNonceExpired(n, n.expiresAt - 1)).toBe(false)
  })

  it('builds an origin- and nonce-bound message', () => {
    const msg = buildLoginMessage('https://nim-relay.example', 'abc-123')
    expect(msg).toContain('https://nim-relay.example')
    expect(msg).toContain('abc-123')
  })

  it('produces different messages for different origins (replay protection across deployments)', () => {
    const a = buildLoginMessage('https://staging.example', 'same-nonce')
    const b = buildLoginMessage('https://production.example', 'same-nonce')
    expect(a).not.toBe(b)
  })
})
