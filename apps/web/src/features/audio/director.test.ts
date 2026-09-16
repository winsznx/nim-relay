import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it, vi } from 'vitest'
import { AudioDirector } from './director'
import type { PreferenceStorage } from './preferences'

function memoryStorage(): PreferenceStorage {
  const values = new Map<string, string>()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) }
}

function exercise(director: AudioDirector): void {
  director.scene('world')
  director.startRace({ world: 'metro' })
  director.syncRace(120, true)
  director.syncRace(Number.NaN, false)
  director.setFlow(0.8)
  director.setSpeed(0.5)
  director.setRailing(true)
  director.cue(relayLeg.EVENT.HIT | relayLeg.EVENT.JUMP)
  director.cueNamed('overtake')
  director.ceremony('frozen')
  director.haptic('impact')
}

describe('AudioDirector without Web Audio', () => {
  it('reports audio as unavailable and turns every call into a no-op', async () => {
    const director = new AudioDirector({ storage: memoryStorage })
    expect(director.getSnapshot().status).toBe('unavailable')
    await expect(director.unlock()).resolves.toBeUndefined()
    expect(() => exercise(director)).not.toThrow()
    director.dispose()
    expect(() => exercise(director)).not.toThrow()
  })

  it('stays locked and silent when the platform refuses to create a context', async () => {
    const createContext = vi.fn(() => null)
    const director = new AudioDirector({ storage: memoryStorage, createContext })
    await director.unlock()
    expect(createContext).toHaveBeenCalledTimes(1)
    expect(director.getSnapshot().status).toBe('locked')
    expect(() => exercise(director)).not.toThrow()
    director.dispose()
  })
})

describe('AudioDirector mute', () => {
  it('persists the choice, notifies subscribers once per change, and keeps snapshots stable', () => {
    const storage = memoryStorage()
    const director = new AudioDirector({ storage: () => storage })
    const listener = vi.fn()
    director.subscribe(listener)
    const before = director.getSnapshot()
    expect(director.getSnapshot()).toBe(before)

    director.setMuted(true)
    director.setMuted(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(director.muted).toBe(true)
    expect(director.getSnapshot()).toEqual({ muted: true, status: 'unavailable' })
    expect(new AudioDirector({ storage: () => storage }).muted).toBe(true)
    director.dispose()
  })

  it('still toggles for the session when storage throws', () => {
    const director = new AudioDirector({
      storage: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(director.muted).toBe(false)
    expect(() => director.setMuted(true)).not.toThrow()
    expect(director.muted).toBe(true)
    director.dispose()
  })

  it('stops notifying after dispose', () => {
    const director = new AudioDirector({ storage: memoryStorage })
    const listener = vi.fn()
    const unsubscribe = director.subscribe(listener)
    director.dispose()
    director.setMuted(true)
    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})
