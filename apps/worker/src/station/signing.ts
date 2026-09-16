import type { IssuedRace } from '@nim-relay/shared'

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

export async function mac(secret: string, value: unknown): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(value))))
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** Every field the issuance HMAC covers. Submissions must echo each of them unchanged. */
export function signedFields(issued: IssuedRace) {
  const network = issued.networkRace ? { networkRace: true, batonId: issued.batonId ?? null, practice: issued.practice ?? false } : {}
  return { ...network, relayLeg: issued.relayLeg, runId: issued.runId, playerId: issued.playerId, mode: issued.mode, config: issued.config, expiresAt: issued.expiresAt, target: issued.target }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}
