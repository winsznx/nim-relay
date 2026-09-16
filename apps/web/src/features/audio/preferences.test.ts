import { describe, expect, it } from 'vitest'
import { SOUND_STORAGE_KEY, readMuted, writeMuted, type PreferenceStorage } from './preferences'

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem: key => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value
    },
  }
}

const throwing: PreferenceStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  },
}

describe('mute preference', () => {
  it('keeps the shell sound setting key so an existing choice carries over', () => {
    expect(SOUND_STORAGE_KEY).toBe('nim-relay-sound')
    expect(readMuted(() => memoryStorage({ 'nim-relay-sound': 'off' }))).toBe(true)
    expect(readMuted(() => memoryStorage({ 'nim-relay-sound': 'on' }))).toBe(false)
  })

  it('is unmuted when nothing was stored', () => {
    expect(readMuted(() => memoryStorage())).toBe(false)
    expect(readMuted(() => null)).toBe(false)
  })

  it('persists a change and reads it back', () => {
    const storage = memoryStorage()
    expect(writeMuted(() => storage, true)).toBe(true)
    expect(storage.values[SOUND_STORAGE_KEY]).toBe('off')
    expect(readMuted(() => storage)).toBe(true)
    expect(writeMuted(() => storage, false)).toBe(true)
    expect(readMuted(() => storage)).toBe(false)
  })

  it('survives storage that throws on read or write', () => {
    expect(readMuted(() => throwing)).toBe(false)
    expect(writeMuted(() => throwing, true)).toBe(false)
  })

  it('survives storage that throws when it is accessed at all', () => {
    const blocked = (): PreferenceStorage => {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    }
    expect(readMuted(blocked)).toBe(false)
    expect(writeMuted(blocked, true)).toBe(false)
    expect(writeMuted(() => null, true)).toBe(false)
  })
})
