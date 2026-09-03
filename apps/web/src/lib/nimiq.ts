import { getHostLanguage, init, requestDeviceIdentifier, type NimiqProvider } from '@nimiq/mini-app-sdk'

/**
 * Thin wrapper over @nimiq/mini-app-sdk. The SDK's provider methods resolve
 * with either a result or an `{ error }` object; these helpers throw on the
 * error shape so callers can use plain try/catch.
 */

export function isInsideNimiqPay(): boolean {
  return typeof window !== 'undefined' && (window.nimiq !== undefined || getHostLanguage() !== undefined)
}

/**
 * Canonical HTTPS deep link that opens this Mini App inside Nimiq Pay
 * (PRD 20.3). Format per nimiq.dev/mini-apps: the target is the host (and
 * path) with the scheme stripped. The custom-scheme form is
 * `nimiqpay://miniapp?url=<host>`.
 */
export function nimiqPayDeepLink(origin: string): string {
  return `https://nimpay.app/miniapps/open/${origin.replace(/^https?:\/\//, '')}`
}

function unwrap<T>(value: T | { error: { type: string; message: string } }): T {
  if (value && typeof value === 'object' && 'error' in value) {
    throw new Error(value.error.message || value.error.type || 'Nimiq Pay request failed')
  }
  return value
}

let providerPromise: Promise<NimiqProvider> | null = null

function provider(): Promise<NimiqProvider> {
  providerPromise ??= init({ timeout: 8000 })
  return providerPromise
}

export async function connectAccount(): Promise<string> {
  const p = await provider()
  const accounts = unwrap(await p.listAccounts())
  const address = accounts[0]
  if (!address) throw new Error('No Nimiq account available in Nimiq Pay')
  return address
}

export async function signMessage(message: string): Promise<{ publicKeyHex: string; signatureHex: string }> {
  const p = await provider()
  const result = unwrap(await p.sign(message))
  return { publicKeyHex: result.publicKey, signatureHex: result.signature }
}

export async function deviceIdentifier(reason: string): Promise<string | undefined> {
  try {
    return await requestDeviceIdentifier({ reason })
  } catch {
    return undefined
  }
}
