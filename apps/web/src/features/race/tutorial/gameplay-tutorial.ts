import { relayLeg } from '@nim-relay/game-engine'
import type { TourEvent } from '@nim-relay/shared'
import { trackTourEvent } from '../../tour/analytics'
import type { TourTrackEvent } from '../../tour/controller'
import { entryRouteOf } from '../../tour/entry-route'
import type { RaceCue, RaceMode, RenderSnapshot } from '../controller'
import { TutorialMachine, type CoachView, type TutorialEffect } from './machine'
import {
  browserStorage,
  browserTutorialStore,
  memoryTutorialStore,
  readRacedBefore,
  tutorialEligible,
  TUTORIAL_TOUR_ID,
  TUTORIAL_VERSION,
  type TourState,
  type TutorialStore,
} from './progress'
import { isOwnJump } from './road-ahead'
import { TUTORIAL_STEPS, stepNumber, type CoachInput, type TutorialStepId } from './steps'

/** Where tutorial analytics go: the product tour's reporter in the app, a list in tests, nowhere in the dev lab. */
export type TutorialTracker = (event: TourTrackEvent) => void

export interface GameplayTutorialOptions {
  /** The race's render snapshot, read on cues and frames and never written. */
  render: () => RenderSnapshot
  store: TutorialStore
  track: TutorialTracker
  input: CoachInput
  /** Whose Ghostline the courier races, named in the Ghostline prompt. */
  ghostName: string | null
  /** The pattern of the route the race runs on, e.g. `/leg/:code`, reported with every tutorial event. */
  entryRoute: string
}

/**
 * The gameplay tutorial for one run: follows the race through its cues and frames, saves progress and
 * reports it. React reads the prompt on screen through `subscribe` and `getSnapshot`.
 */
export class GameplayTutorial {
  readonly input: CoachInput
  readonly ghostName: string | null
  private readonly machine: TutorialMachine
  private readonly listeners = new Set<() => void>()
  private tourState: TourState
  private published: CoachView | null = null
  private events = 0
  private jumped = false

  constructor(private readonly options: GameplayTutorialOptions) {
    this.input = options.input
    this.ghostName = options.ghostName
    this.tourState = options.store.readState()
    this.machine = new TutorialMachine(options.store.readSteps())
  }

  /** Collects a tick's events. Call for every race cue as it is emitted, while its tick is the render state. */
  cue = (cue: RaceCue): void => {
    if (cue.kind !== 'events') return
    this.events |= cue.events
    if ((cue.events & relayLeg.EVENT.JUMP) !== 0 && isOwnJump(this.options.render().state)) this.jumped = true
  }

  /** Moves the prompts to the race on screen. Call once per rendered frame, after that frame's cues. */
  frame = (): void => {
    const render = this.options.render()
    const effects = this.machine.observe({
      racing: render.phase === 'racing',
      approaching: render.approaching,
      state: render.state,
      events: this.events,
      jumped: this.jumped,
    })
    this.events = 0
    this.jumped = false
    for (const effect of effects) this.apply(effect)
    this.notify()
  }

  /** The player's "Skip gameplay tutorial": no prompt shows again. */
  skip = (): void => {
    const step = this.machine.skip()
    if (!step) return
    this.saveState('skipped')
    this.report('skipped', step)
    this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): CoachView | null => this.published

  private apply(effect: TutorialEffect): void {
    switch (effect.kind) {
      case 'viewed':
        if (this.tourState === 'not_seen') {
          this.saveState('started')
          this.report('started', effect.step)
        }
        this.report('step_viewed', effect.step)
        return
      case 'completed':
        this.options.store.writeSteps(TUTORIAL_STEPS.filter(step => this.machine.isCompleted(step)))
        this.report('step_completed', effect.step)
        return
      case 'finished':
        this.saveState('completed')
        this.report('completed', effect.step)
        return
    }
  }

  private saveState(state: TourState): void {
    this.tourState = state
    this.options.store.writeState(state)
  }

  private report(event: TourEvent, step: TutorialStepId): void {
    this.options.track({
      event,
      tourId: TUTORIAL_TOUR_ID,
      version: TUTORIAL_VERSION,
      stepId: step,
      stepNumber: stepNumber(step),
      entryRoute: this.options.entryRoute,
    })
  }

  private notify(): void {
    const view = this.machine.view
    if (view === this.published) return
    this.published = view
    for (const listener of this.listeners) listener()
  }
}

/** 'auto' follows the courier's saved progress; the dev lab forces the tutorial on or off. */
export type TutorialSetting = 'auto' | 'force' | 'off'

export interface RaceTutorialSetup {
  mode: RaceMode
  setting: TutorialSetting
  render: () => RenderSnapshot
  ghostName: string | null
}

/** Swipes where the main pointer is a finger that cannot hover, arrow keys everywhere else. */
export function coachInput(): CoachInput {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'touch'
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches ? 'touch' : 'keys'
}

/**
 * The tutorial for one run, or null when this run has none. A forced tutorial starts fresh whatever was
 * saved, and saves and reports nothing.
 */
export function createRaceTutorial(setup: RaceTutorialSetup): GameplayTutorial | null {
  if (setup.mode === 'watch' || setup.setting === 'off') return null
  const shared = { render: setup.render, ghostName: setup.ghostName, input: coachInput(), entryRoute: entryRouteOf(window.location.pathname) }
  if (setup.setting === 'force') return new GameplayTutorial({ ...shared, store: memoryTutorialStore(), track: () => undefined })
  const store = browserTutorialStore()
  if (!tutorialEligible(setup.mode, store.readState(), readRacedBefore(browserStorage))) return null
  return new GameplayTutorial({ ...shared, store, track: trackTourEvent })
}
