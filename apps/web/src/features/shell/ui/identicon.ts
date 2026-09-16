import { useEffect, useSyncExternalStore } from 'react'

/**
 * Nimiq identicons for runner wallets. The hash is sensitive to spacing and
 * case, and Nimiq's wallet components hash the user-friendly address in upper
 * case with a space every four characters (@nimiq/utils normalizeAddress). The
 * relay server stores addresses compact, so they are regrouped first; that keeps
 * a runner's identicon identical to the one Nimiq Pay shows for their account.
 */

const USER_FRIENDLY_ADDRESS = /^NQ[0-9]{2}[0-9A-Z]{32}$/

/** The text Nimiq's wallets feed to the identicon hash for `wallet`, or null when it isn't a Nimiq address. */
export function identiconSeed(wallet: string): string | null {
  const compact = wallet.toUpperCase().replace(/[\s+-]|%20/g, '')
  if (!USER_FRIENDLY_ADDRESS.test(compact)) return null
  return compact.replace(/(.)(?=(.{4})+$)/g, '$1 ')
}

export interface IdenticonCache {
  /** The generated data URL, or null while it is missing, generating or failed. */
  read(seed: string): string | null
  /** Starts generating once per seed. A failure is kept, so the avatar stays on initials instead of retrying. */
  request(seed: string): void
  subscribe(listener: () => void): () => void
}

export function createIdenticonCache(generate: (seed: string) => Promise<string>): IdenticonCache {
  const urls = new Map<string, string>()
  const requested = new Set<string>()
  const listeners = new Set<() => void>()
  return {
    read: seed => urls.get(seed) ?? null,
    request(seed) {
      if (requested.has(seed)) return
      requested.add(seed)
      generate(seed)
        .then(url => {
          urls.set(seed, url)
          for (const listener of listeners) listener()
        })
        .catch((error: unknown) => console.warn('Identicon not generated; the avatar keeps initials', error))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

type IdenticonsLibrary = typeof import('@nimiq/identicons/dist/identicons.bundle.min.js').default

let library: Promise<IdenticonsLibrary> | null = null

/** The library carries about 90 KB of artwork, so it loads on the first avatar that needs it. */
function generateIdenticon(seed: string): Promise<string> {
  library ??= import('@nimiq/identicons/dist/identicons.bundle.min.js').then(module => module.default)
  return library.then(identicons => identicons.toDataUrl(seed))
}

const identicons = createIdenticonCache(generateIdenticon)

/** The identicon data URL for a wallet, or null until it is ready or when the wallet can't have one. */
export function useIdenticon(wallet: string | null | undefined): string | null {
  const seed = wallet ? identiconSeed(wallet) : null
  const url = useSyncExternalStore(identicons.subscribe, () => (seed ? identicons.read(seed) : null))
  useEffect(() => {
    if (seed && url === null) identicons.request(seed)
  }, [seed, url])
  return url
}
