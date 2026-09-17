import { readTourState, writeTourState, type TourState } from '../../tour/state'
import type { RaceMode } from '../controller'
import { TUTORIAL_STEPS, type TutorialStepId } from './steps'

/**
 * Where the tutorial remembers itself. Its state (not seen, started, completed, skipped) is a guided-tour state,
 * separate from the product tour's and synced with the runner's preferences. Which steps are answered stays on
 * this device, so a courier who changes device mid-way meets the pending prompts again rather than none.
 */

export const TUTORIAL_TOUR_ID = 'gameplay'
export const TUTORIAL_VERSION = 'v1'
export const STEPS_STORAGE_KEY = `nim-relay-tutorial:${TUTORIAL_TOUR_ID}:${TUTORIAL_VERSION}:steps`
/** Written on the first race by the controls hint this tutorial replaced: set means the courier raced before it shipped. */
export const RACED_BEFORE_KEY = 'nim-relay:leg-controls-v6-hint'

export type { TourState }

export interface TutorialStore {
  readState(): TourState
  writeState(state: TourState): void
  readSteps(): TutorialStepId[]
  writeSteps(steps: readonly TutorialStepId[]): void
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Null when there is no storage to use. */
export type StorageAccess = () => StorageLike | null

export const browserStorage: StorageAccess = () => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Reading window.localStorage itself throws when site data is blocked.
    return null
  }
}

export interface TourStateAccess {
  read(tourId: string, version: string): TourState
  write(tourId: string, version: string, state: TourState): void
}

const browserTourState: TourStateAccess = { read: readTourState, write: writeTourState }

/** Answered steps in tutorial order; anything unreadable counts as none answered. */
export function parseSteps(raw: string | null): TutorialStepId[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const saved: readonly unknown[] = value
    return TUTORIAL_STEPS.filter(step => saved.includes(step))
  } catch {
    // A corrupt entry is no progress: the steps ask again.
    return []
  }
}

export function browserTutorialStore(storage: StorageAccess = browserStorage, tour: TourStateAccess = browserTourState): TutorialStore {
  return {
    readState: () => tour.read(TUTORIAL_TOUR_ID, TUTORIAL_VERSION),
    writeState: state => tour.write(TUTORIAL_TOUR_ID, TUTORIAL_VERSION, state),
    readSteps: () => {
      try {
        return parseSteps(storage()?.getItem(STEPS_STORAGE_KEY) ?? null)
      } catch {
        // Storage that throws on read has nothing saved.
        return []
      }
    },
    writeSteps: steps => {
      try {
        storage()?.setItem(STEPS_STORAGE_KEY, JSON.stringify(steps))
      } catch {
        // Storage that throws on write keeps nothing: the answered steps ask again next run.
        return
      }
    },
  }
}

/** A store that forgets everything with the page, for the dev lab and tests. */
export function memoryTutorialStore(state: TourState = 'not_seen', steps: readonly TutorialStepId[] = []): TutorialStore {
  let savedState = state
  let savedSteps = [...steps]
  return {
    readState: () => savedState,
    writeState: next => {
      savedState = next
    },
    readSteps: () => [...savedSteps],
    writeSteps: next => {
      savedSteps = [...next]
    },
  }
}

export function readRacedBefore(storage: StorageAccess): boolean {
  try {
    return storage()?.getItem(RACED_BEFORE_KEY) === '1'
  } catch {
    // Unreadable storage: treat the courier as new.
    return false
  }
}

/**
 * Whether a run opens with the tutorial: never for a replay, never once it was completed or skipped, and in
 * the official Daily only on a courier's first race ever, so no Daily attempt carries lessons after that.
 */
export function tutorialEligible(mode: RaceMode, state: TourState, racedBefore: boolean): boolean {
  if (mode === 'watch' || state === 'completed' || state === 'skipped') return false
  return mode !== 'daily' || (state === 'not_seen' && !racedBefore)
}
