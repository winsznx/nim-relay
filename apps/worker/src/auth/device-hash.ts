import type { Env } from '../env'

/**
 * PRD section 11.5 - Nimiq Pay's device identifier identifies a device, not
 * a human. The raw value is never persisted; only an HMAC-SHA256 (server
 * pepper) of it is stored, as an abuse/session signal.
 */
export async function hashDeviceId(env: Env, rawDeviceId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.DEVICE_HASH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawDeviceId))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
