/**
 * PRD section 11.4 / section 32.3 - single-use, expiring, origin-bound login
 * nonce. The nonce is embedded in the message the user signs with their
 * Nimiq account (`nimiq.sign()`), so a captured signature can't be replayed
 * against a different login attempt.
 *
 * Storage of issued/consumed nonces is Durable-Object or KV-backed
 * (wired in Phase 4 alongside the rest of the relay protocol's storage
 * layer); this module only defines the message shape and expiry policy so
 * the auth route can be built against a stable contract now.
 */

const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface LoginNonce {
  nonce: string
  issuedAt: number
  expiresAt: number
}

export function issueLoginNonce(): LoginNonce {
  const nonce = crypto.randomUUID()
  const issuedAt = Date.now()
  return { nonce, issuedAt, expiresAt: issuedAt + NONCE_TTL_MS }
}

export function isNonceExpired(nonce: LoginNonce, now = Date.now()): boolean {
  return now >= nonce.expiresAt
}

/**
 * The exact message the user is asked to sign. Origin-bound (PRD section
 * 32.3) so a signature produced for one deployment can't be replayed
 * against another. Nonce-bound so it can't be replayed across login
 * attempts even on the same origin.
 */
export function buildLoginMessage(origin: string, nonce: string): string {
  return `NIM Relay login\norigin: ${origin}\nnonce: ${nonce}`
}
