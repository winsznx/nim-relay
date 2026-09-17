import { describe, expect, it } from 'vitest'
import {
  RACED_BEFORE_KEY,
  STEPS_STORAGE_KEY,
  browserTutorialStore,
  parseSteps,
  readRacedBefore,
  tutorialEligible,
  type StorageLike,
  type TourState,
} from './progress'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  },
}

describe('tutorial progress', () => {
  it('reads answered steps in tutorial order and ignores anything it does not know', () => {
    expect(parseSteps(JSON.stringify(['flow', 'lane', 'somersault', 3]))).toEqual(['lane', 'flow'])
    expect(parseSteps('{"lane":true}')).toEqual([])
    expect(parseSteps('not json')).toEqual([])
    expect(parseSteps(null)).toEqual([])
  })

  it('keeps the tour state under the gameplay tour, separate from answered steps on this device', () => {
    // #given a tour state store and this device's storage
    const tours = new Map<string, TourState>()
    const storage = memoryStorage()
    const store = browserTutorialStore(() => storage, {
      read: (tourId, version) => tours.get(`${tourId}:${version}`) ?? 'not_seen',
      write: (tourId, version, state) => {
        tours.set(`${tourId}:${version}`, state)
      },
    })
    // #when a run starts the tutorial and answers two steps
    store.writeState('started')
    store.writeSteps(['lane', 'jump'])
    // #then the state is the gameplay v1 tour's, and the steps are this device's
    expect(tours.get('gameplay:v1')).toBe('started')
    expect(store.readState()).toBe('started')
    expect(storage.values.get(STEPS_STORAGE_KEY)).toBe('["lane","jump"]')
    expect(store.readSteps()).toEqual(['lane', 'jump'])
  })

  it('treats storage that throws as holding no progress, without throwing itself', () => {
    const store = browserTutorialStore(() => throwing, { read: () => 'not_seen', write: () => undefined })
    expect(() => store.writeSteps(['lane'])).not.toThrow()
    expect(store.readSteps()).toEqual([])
    expect(readRacedBefore(() => throwing)).toBe(false)
  })

  it('recognises a courier who raced before the tutorial shipped', () => {
    expect(readRacedBefore(() => memoryStorage({ [RACED_BEFORE_KEY]: '1' }))).toBe(true)
    expect(readRacedBefore(() => memoryStorage())).toBe(false)
    expect(readRacedBefore(() => null)).toBe(false)
  })
})

describe('tutorialEligible', () => {
  it('never runs for replays, or once the tutorial was completed or skipped', () => {
    expect(tutorialEligible('watch', 'not_seen', false)).toBe(false)
    expect(tutorialEligible('practice', 'completed', false)).toBe(false)
    expect(tutorialEligible('relay', 'skipped', false)).toBe(false)
  })

  it('runs in practice and relay legs until it is done', () => {
    expect(tutorialEligible('practice', 'not_seen', true)).toBe(true)
    expect(tutorialEligible('relay', 'started', false)).toBe(true)
  })

  it('runs in the official Daily only on a courier’s first race ever', () => {
    expect(tutorialEligible('daily', 'not_seen', false)).toBe(true)
    expect(tutorialEligible('daily', 'started', false)).toBe(false)
    expect(tutorialEligible('daily', 'not_seen', true)).toBe(false)
  })
})
