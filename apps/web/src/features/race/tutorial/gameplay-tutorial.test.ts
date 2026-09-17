import type { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import type { TourTrackEvent } from '../../tour/controller'
import { RelayLegController, TICK_MS } from '../controller'
import { createBot, type BotOptions } from '../dev/bot'
import { GameplayTutorial, createRaceTutorial } from './gameplay-tutorial'
import { memoryTutorialStore, type TutorialStore } from './progress'
import { TUTORIAL_STEPS, stepNumber } from './steps'
import { legConfig, withGhostline } from './test-states'

/** The lab's capture leg: the grind bot racing the Ghostline of the lab's ghost, which meets every tutorial moment. */
const GRIND_BOT: BotOptions = { fork: 'risk', grindAt: 120 }
const ghosted = withGhostline(legConfig())

interface Run {
  controller: RelayLegController
  tutorial: GameplayTutorial | null
  store: TutorialStore
  events: TourTrackEvent[]
  /** Views on screen, in order, as `step:status`. */
  timeline: string[]
}

/** Races a leg frame by frame at 60 fps the way RaceScreen wires it: cues as they happen, then the frame. */
function race(options: { config: relayLeg.Config; bot: BotOptions | null; tutorial: boolean; store?: TutorialStore; untilView?: string }): Run {
  const controller = new RelayLegController(options.config, { mode: 'practice', openingMs: 0, catchMs: 0, autopilot: options.bot ? createBot(options.bot) : null })
  const store = options.store ?? memoryTutorialStore()
  const events: TourTrackEvent[] = []
  const tutorial = options.tutorial
    ? new GameplayTutorial({ render: controller.getRenderSnapshot, store, track: input => events.push(input), input: 'touch', ghostName: 'Mariana', entryRoute: '/leg/:code' })
    : null
  const timeline: string[] = []
  if (tutorial) {
    controller.onCue(tutorial.cue)
    tutorial.subscribe(() => {
      const view = tutorial.getSnapshot()
      if (view) timeline.push(`${view.step}:${view.status}`)
    })
  }
  let now = 0
  controller.frame(now)
  while (controller.getSnapshot().phase !== 'finished') {
    now += TICK_MS
    controller.frame(now)
    tutorial?.frame()
    if (options.untilView && timeline.at(-1) === options.untilView) break
  }
  return { controller, tutorial, store, events, timeline }
}

describe('GameplayTutorial in a race', () => {
  it('teaches every step in one leg of the lab’s capture run, then saves the tutorial as completed', () => {
    // #given a fresh courier's tutorial
    // #when the grind bot races the lab leg against the Ghostline
    const run = race({ config: ghosted, bot: GRIND_BOT, tutorial: true })
    // #then every prompt showed and was answered, progress is saved, and the tour is completed
    for (const step of TUTORIAL_STEPS) {
      expect(run.timeline).toContain(`${step}:showing`)
      expect(run.timeline).toContain(`${step}:done`)
    }
    expect(run.store.readState()).toBe('completed')
    expect(run.store.readSteps()).toEqual([...TUTORIAL_STEPS])
  })

  it('reports started with the first prompt, a view before each answer, and completed last', () => {
    // #given the same capture run
    const run = race({ config: ghosted, bot: GRIND_BOT, tutorial: true })
    const names = run.events.map(event => `${event.event}:${event.stepId}`)
    // #then the analytics follow the tour contract for the gameplay tour
    expect(names[0]).toBe('started:lane')
    expect(names[1]).toBe('step_viewed:lane')
    expect(run.events.at(-1)?.event).toBe('completed')
    for (const step of TUTORIAL_STEPS) {
      expect(names.indexOf(`step_viewed:${step}`)).toBeLessThan(names.indexOf(`step_completed:${step}`))
    }
    const numbers = new Map<string | undefined, number>(TUTORIAL_STEPS.map(step => [step, stepNumber(step)]))
    for (const event of run.events) {
      expect(event).toMatchObject({ tourId: 'gameplay', version: 'v1', entryRoute: '/leg/:code', stepNumber: numbers.get(event.stepId) })
    }
  })

  it('never changes the race: the same inputs give the same trace and result with or without prompts', () => {
    // #given the capture run raced twice
    const withPrompts = race({ config: ghosted, bot: GRIND_BOT, tutorial: true })
    const without = race({ config: ghosted, bot: GRIND_BOT, tutorial: false })
    const a = withPrompts.controller.getSnapshot()
    const b = without.controller.getSnapshot()
    // #then prompts showed in one and the recorded runs are identical
    expect(withPrompts.timeline.length).toBeGreaterThan(0)
    expect(a.trace).toEqual(b.trace)
    expect(a.result?.resultHash).toBe(b.result?.resultHash)
    expect(a.divergence).toBe(false)
  })

  it('skips for good: saved as skipped, reported with the step on screen, and never shown again', () => {
    // #given a courier who doesn't touch the controls, with the first prompt on screen
    const run = race({ config: legConfig(), bot: null, tutorial: true, untilView: 'lane:showing' })
    const tutorial = run.tutorial!
    // #when they skip, and the leg runs on to the finish
    tutorial.skip()
    const shownAfterSkip: string[] = []
    tutorial.subscribe(() => {
      if (tutorial.getSnapshot()) shownAfterSkip.push('shown')
    })
    let now = run.controller.getRenderSnapshot().state.tick * TICK_MS
    while (run.controller.getSnapshot().phase !== 'finished') {
      now += TICK_MS
      run.controller.frame(now)
      tutorial.frame()
    }
    // #then nothing showed again and the tour was saved and reported as skipped at the lane step
    expect(tutorial.getSnapshot()).toBeNull()
    expect(shownAfterSkip).toEqual([])
    expect(run.store.readState()).toBe('skipped')
    expect(run.events.at(-1)).toMatchObject({ event: 'skipped', stepId: 'lane', stepNumber: 1 })
  })

  it('carries answered steps into the next run and asks only for what is pending', () => {
    // #given a courier whose earlier run answered everything but the FLOW step
    const store = memoryTutorialStore('started', TUTORIAL_STEPS.filter(step => step !== 'flow'))
    // #when they race the capture leg again
    const run = race({ config: ghosted, bot: GRIND_BOT, tutorial: true, store })
    // #then only the FLOW prompt showed, and it finished the tutorial without a second started event
    expect(new Set(run.timeline.map(entry => entry.split(':')[0]))).toEqual(new Set(['flow']))
    expect(run.events.map(event => event.event)).toEqual(['step_viewed', 'step_completed', 'completed'])
    expect(store.readState()).toBe('completed')
  })
})

describe('createRaceTutorial', () => {
  it('has no tutorial for a replay or when switched off', () => {
    // #given a controller for a replayed run
    const config = legConfig()
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0 })
    const setup = { render: controller.getRenderSnapshot, ghostName: null }
    // #then watch mode and the off setting create nothing
    expect(createRaceTutorial({ ...setup, mode: 'watch', setting: 'force' })).toBeNull()
    expect(createRaceTutorial({ ...setup, mode: 'practice', setting: 'off' })).toBeNull()
  })
})
