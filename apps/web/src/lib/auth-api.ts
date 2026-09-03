export interface Player {
  id: string
  handle: string
  displayName: string
  walletAddress: string
}

export interface NonceChallenge {
  nonce: string
  message: string
  expiresAt: number
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as T | { error?: string } | null
  if (!res.ok) {
    const err = body && typeof body === 'object' && 'error' in body ? body.error : undefined
    throw new Error(err ?? `request failed (${res.status})`)
  }
  return body as T
}

export function requestNonce(): Promise<NonceChallenge> {
  return fetch('/api/auth/nonce', { method: 'POST' }).then(json<NonceChallenge>)
}

export function verifyLogin(input: {
  nonce: string
  publicKeyHex: string
  signatureHex: string
  deviceId?: string
}): Promise<{ player: Player }> {
  return fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then(json<{ player: Player }>)
}

export async function fetchMe(): Promise<Player | null> {
  const res = await fetch('/api/auth/me')
  if (res.status === 401) return null
  return (await json<{ player: Player }>(res)).player
}

export function logout(): Promise<unknown> {
  return fetch('/api/auth/logout', { method: 'POST' }).then(json)
}
