/**
 * The sound on/off choice. It shares the shell's existing key and values ('on' / 'off') so the
 * choice a runner already made carries over. Storage can be missing or throw (private browsing,
 * blocked site data, sandboxed WebViews); sound is then on and a change lasts for the visit.
 */

export const SOUND_STORAGE_KEY = 'nim-relay-sound'

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type StorageAccess = () => PreferenceStorage | null

export const browserStorage: StorageAccess = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Reading window.localStorage itself throws when site data is blocked.
    return null
  }
}

export function readMuted(storage: StorageAccess): boolean {
  try {
    return storage()?.getItem(SOUND_STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

/** Returns whether the choice was stored. */
export function writeMuted(storage: StorageAccess, muted: boolean): boolean {
  try {
    const target = storage()
    if (!target) return false
    target.setItem(SOUND_STORAGE_KEY, muted ? 'off' : 'on')
    return true
  } catch {
    return false
  }
}
