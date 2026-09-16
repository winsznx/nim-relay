import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'nim-relay-sound'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    // Storage can be blocked; sound then stays on for this visit.
    return true
  }
}

let enabled = typeof window === 'undefined' ? true : read()

export function soundEnabled(): boolean {
  return enabled
}

/** Returns false when storage is blocked; the choice then lasts until the app closes. */
function persist(next: boolean): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    return true
  } catch {
    return false
  }
}

export function setSoundEnabled(next: boolean): void {
  enabled = next
  persist(next)
  for (const listener of listeners) listener()
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    soundEnabled,
    soundEnabled,
  )
}
