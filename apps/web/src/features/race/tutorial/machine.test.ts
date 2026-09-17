import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import {
  ACTION_WINDOW_TICKS,
  CALM_START_TICK,
  CLEAR_TICKS,
  EXIT_TICKS,
  FLOW_SHOW_TICKS,
  GHOSTLINE_READ_TICKS,
  GHOSTLINE_SHOW_TICKS,
  LANE_TIMEOUT_TICKS,
  MAX_VIEWS_PER_RUN,
  REPEAT_TICKS,
  TutorialMachine,
  type TutorialObservation,
} from './machine'
import { TUTORIAL_STEPS, type TutorialStepId } from './steps'
import { ONE, laneX, legConfig, stateAt, withGhostline } from './test-states'

const { EVENT } = relayLeg
const config = legConfig()

function observe(machine: TutorialMachine, state: relayLeg.State, extra: Partial<TutorialObservation> = {}) {
  return machine.observe({ racing: true, approaching: false, state, events: 0, jumped: false, ...extra })
}

/** Every step but these is already answered. */
function pendingOnly(...steps: TutorialStepId[]): TutorialMachine {
  return new TutorialMachine(TUTORIAL_STEPS.filter(step => !steps.includes(step)))
}

/** A calm moment on the opening straight: nothing to meet for well over two seconds. */
const calm = (tick: number) => stateAt(config, 20, { tick })
/** 65 m before the full-width barrier at 205 m. */
const beforeBarrier = (tick: number, overrides: Partial<relayLeg.State> = {}) => stateAt(config, 140, { tick, ...overrides })

describe('TutorialMachine lane prompt', () => {
  it('waits for the arrival title to clear, then asks for a lane change on a calm stretch', () => {
    // #given a fresh tutorial
    const machine = new TutorialMachine()
    // #when the race runs calm through its first two seconds
    const early = observe(machine, calm(CALM_START_TICK - 1))
    const earlyView = machine.view
    const effects = observe(machine, calm(CALM_START_TICK))
    // #then nothing shows before the arrival clears, and the lane prompt is viewed after
    expect(early).toEqual([])
    expect(earlyView).toBeNull()
    expect(effects).toEqual([{ kind: 'viewed', step: 'lane' }])
    expect(machine.view).toMatchObject({ step: 'lane', status: 'showing', showing: 1 })
  })

  it('completes on the first lane shift and plays its exit before it goes', () => {
    // #given the lane prompt on screen
    const machine = new TutorialMachine()
    observe(machine, calm(CALM_START_TICK))
    // #when the courier shifts lanes
    const effects = observe(machine, calm(CALM_START_TICK + 10), { events: EVENT.LANE_SHIFT })
    const exiting = machine.view
    observe(machine, calm(CALM_START_TICK + 10 + EXIT_TICKS))
    // #then the step completes, the prompt plays its answered exit, then unmounts
    expect(effects).toEqual([{ kind: 'completed', step: 'lane' }])
    expect(exiting).toMatchObject({ step: 'lane', status: 'done' })
    expect(machine.view).toBeNull()
    expect(machine.isCompleted('lane')).toBe(true)
  })

  it('times out unanswered without blocking anything, and asks again later in the run', () => {
    // #given the lane prompt on screen
    const machine = new TutorialMachine()
    observe(machine, calm(CALM_START_TICK))
    // #when nobody shifts lanes for the whole timeout, and the road stays calm long after
    const timedOut = observe(machine, calm(CALM_START_TICK + LANE_TIMEOUT_TICKS))
    const afterTimeout = machine.view
    const hiddenAt = CALM_START_TICK + LANE_TIMEOUT_TICKS
    observe(machine, calm(hiddenAt + REPEAT_TICKS - 1))
    const beforeRepeat = machine.view
    const again = observe(machine, calm(hiddenAt + REPEAT_TICKS))
    // #then the prompt leaves without completing, and returns as a new prompt once the repeat wait is over
    expect(timedOut).toEqual([])
    expect(afterTimeout).toMatchObject({ step: 'lane', status: 'dismissed' })
    expect(machine.isCompleted('lane')).toBe(false)
    expect(beforeRepeat).toBeNull()
    expect(again).toEqual([])
    expect(machine.view).toMatchObject({ step: 'lane', status: 'showing', showing: 2 })
  })

  it('asks at most a few times in one run', () => {
    // #given a courier who never changes lanes on a calm road
    const machine = new TutorialMachine()
    let tick = CALM_START_TICK
    let shown = 0
    // #when every prompt times out and the road stays calm for long enough to ask again and again
    for (let round = 0; round < MAX_VIEWS_PER_RUN + 2; round++) {
      observe(machine, calm(tick))
      if (machine.view?.status === 'showing') shown++
      tick += LANE_TIMEOUT_TICKS
      observe(machine, calm(tick))
      tick += REPEAT_TICKS
    }
    // #then it stopped asking after the cap
    expect(shown).toBe(MAX_VIEWS_PER_RUN)
  })
})

describe('TutorialMachine jump and slide prompts', () => {
  it('asks for a jump ahead of a barrier on the courier’s line and flares inside the action window', () => {
    // #given the lane step answered and the courier approaching the full-width barrier
    const machine = pendingOnly('jump')
    // #when the barrier comes into range, then into its action window
    const effects = observe(machine, beforeBarrier(200))
    const early = machine.view
    const windowStart = 205 - (ACTION_WINDOW_TICKS * relayLeg.BASE_SPEED) / ONE
    observe(machine, stateAt(config, windowStart + 0.5, { tick: 260 }))
    // #then the jump prompt shows early and says it is time once inside the window
    expect(effects).toEqual([{ kind: 'viewed', step: 'jump' }])
    expect(early).toMatchObject({ step: 'jump', status: 'showing', now: false })
    expect(machine.view).toMatchObject({ step: 'jump', status: 'showing', now: true })
  })

  it('completes on the courier’s own jump and never on a ramp launch', () => {
    // #given the jump prompt on screen
    const machine = pendingOnly('jump')
    observe(machine, beforeBarrier(200))
    // #when a ramp launches the courier, then the courier jumps itself
    const launched = observe(machine, beforeBarrier(201), { events: EVENT.JUMP, jumped: false })
    const jumped = observe(machine, beforeBarrier(202), { events: EVENT.JUMP, jumped: true })
    // #then only the courier's own jump answers the prompt
    expect(launched).toEqual([])
    expect(jumped).toEqual([{ kind: 'completed', step: 'jump' }, { kind: 'finished', step: 'jump' }])
  })

  it('lets the prompt go once the courier has steered clear, and asks about that obstacle only once', () => {
    // #given the jump prompt for the barrier in the left lane
    const machine = pendingOnly('jump')
    const inLeftLane = { targetLane: -2, lane: -2, x: laneX(-2) }
    observe(machine, stateAt(config, 100, { tick: 200, ...inLeftLane }))
    const shownFor = machine.view
    // #when the courier shifts to the clear centre lane and stays there, then drifts back into the left lane
    observe(machine, stateAt(config, 100, { tick: 201, targetLane: 0 }))
    const justClear = machine.view?.status
    const effects = observe(machine, stateAt(config, 101, { tick: 201 + CLEAR_TICKS, targetLane: 0 }))
    const clear = machine.view?.status
    observe(machine, stateAt(config, 110, { tick: 260, ...inLeftLane }))
    // #then a moment of clearance keeps it, a lasting one lets it go unanswered, and the same barrier never asks again
    expect(shownFor).toMatchObject({ step: 'jump', status: 'showing' })
    expect(justClear).toBe('showing')
    expect(effects).toEqual([])
    expect(clear).toBe('dismissed')
    expect(machine.view).toBeNull()
  })

  it('asks for a slide under a beam and completes on a slide', () => {
    // #given the courier 32 m before the beam over the centre lane
    const machine = pendingOnly('slide')
    observe(machine, stateAt(config, 640, { tick: 900 }))
    const shown = machine.view
    // #when the courier slides
    const effects = observe(machine, stateAt(config, 645, { tick: 911 }), { events: EVENT.SLIDE })
    // #then the slide step completes
    expect(shown).toMatchObject({ step: 'slide', status: 'showing' })
    expect(effects[0]).toEqual({ kind: 'completed', step: 'slide' })
  })

  it('replaces a calm prompt on screen', () => {
    // #given the lane prompt on screen
    const machine = new TutorialMachine()
    observe(machine, calm(CALM_START_TICK))
    // #when a barrier comes into range before the courier changes lanes
    const effects = observe(machine, beforeBarrier(CALM_START_TICK + 30))
    // #then the jump prompt takes over and the lane step stays pending
    expect(effects).toEqual([{ kind: 'viewed', step: 'jump' }])
    expect(machine.view).toMatchObject({ step: 'jump', status: 'showing', showing: 2 })
    expect(machine.isCompleted('lane')).toBe(false)
  })
})

describe('TutorialMachine edge prompt', () => {
  const onShoulder = (tick: number, overrides: Partial<relayLeg.State> = {}) => stateAt(config, 60, { tick, x: -(5 * ONE), targetLane: -3, ...overrides })

  it('shows on the shoulder, follows the courier onto the rail and completes on the save', () => {
    // #given a fresh tutorial and a courier drifting onto the left shoulder
    const machine = new TutorialMachine()
    const effects = observe(machine, onShoulder(50))
    const shoulder = machine.view
    // #when the courier grinds the rail, then steers off it
    observe(machine, onShoulder(56, { motion: 'grinding', edgeSide: -1, x: -(6 * ONE) }))
    const grinding = machine.view
    const saved = observe(machine, onShoulder(70, { motion: 'grinding', edgeSide: -1 }), { events: EVENT.EDGE_SAVE })
    // #then it shows at once, even before the arrival clears, names the side and the grind, and completes on the save
    expect(effects).toEqual([{ kind: 'viewed', step: 'edge' }])
    expect(shoulder).toMatchObject({ step: 'edge', status: 'showing', side: -1, grinding: false })
    expect(grinding).toMatchObject({ step: 'edge', side: -1, grinding: true })
    expect(saved).toEqual([{ kind: 'completed', step: 'edge' }])
  })

  it('completes when the courier steers back into a lane, and lets go without completing after a fall', () => {
    // #given two couriers on the shoulder with the edge prompt on screen
    const steers = new TutorialMachine()
    const falls = new TutorialMachine()
    observe(steers, onShoulder(50))
    observe(falls, onShoulder(50))
    // #when one steers back inside the lanes and the other goes over the edge
    const back = observe(steers, onShoulder(60, { x: laneX(-2), targetLane: -2 }))
    const over = observe(falls, onShoulder(60, { motion: 'falling' }))
    // #then only steering back answers the prompt
    expect(back).toEqual([{ kind: 'completed', step: 'edge' }])
    expect(over).toEqual([])
    expect(falls.view).toMatchObject({ step: 'edge', status: 'dismissed' })
  })

  it('never prompts on a shoulder beside a wall, which only bumps the courier back', () => {
    // #given the walled pulse tunnel of the lab route
    const machine = new TutorialMachine()
    const walled = stateAt(config, 1100, { tick: 50, x: -(5 * ONE), targetLane: -3 })
    // #when the courier rides its shoulder
    observe(machine, walled)
    // #then nothing shows
    expect(machine.view).toBeNull()
  })
})

describe('TutorialMachine Ghostline prompt', () => {
  const ghosted = withGhostline(config)
  /** Riding the left lane with the ghost half a second ahead, close enough to draft. */
  const offTheLine = (tick: number, overrides: Partial<relayLeg.State> = {}) =>
    stateAt(ghosted, 30, { tick, targetLane: -2, lane: -2, x: laneX(-2), ghostLeadTicks: 30, ...overrides })

  it('shows while the courier is off the line, and completes once the courier drafts it after reading', () => {
    // #given a Ghostline on the road and the courier riding another lane
    const machine = pendingOnly('ghostline')
    // #when the prompt shows, the courier finds the line at once, then again once the prompt has been read
    const effects = observe(machine, offTheLine(200))
    const shown = machine.view
    const tooSoon = observe(machine, offTheLine(205), { events: EVENT.DRAFTING })
    const read = observe(machine, offTheLine(200 + GHOSTLINE_READ_TICKS), { events: EVENT.DRAFTING })
    // #then only drafting after reading answered it
    expect(effects).toEqual([{ kind: 'viewed', step: 'ghostline' }])
    expect(shown).toMatchObject({ step: 'ghostline', status: 'showing' })
    expect(tooSoon).toEqual([])
    expect(read[0]).toEqual({ kind: 'completed', step: 'ghostline' })
  })

  it('waits while the courier is already drafting, and completes by itself after its display', () => {
    // #given the courier drafting the line
    const drafting = pendingOnly('ghostline')
    observe(drafting, offTheLine(200), { events: EVENT.DRAFTING })
    const whileDrafting = drafting.view
    // #when another courier leaves the prompt up for its whole display
    const reader = pendingOnly('ghostline')
    observe(reader, offTheLine(200))
    const effects = observe(reader, offTheLine(200 + GHOSTLINE_SHOW_TICKS))
    // #then there was nothing to teach the drafting courier, and the reader's step completed on time
    expect(whileDrafting).toBeNull()
    expect(effects[0]).toEqual({ kind: 'completed', step: 'ghostline' })
  })

  it('only offers drafting while the ghost is close ahead, and never without a Ghostline', () => {
    // #given couriers leading the ghost, far behind it, and racing with no Ghostline at all
    const leading = pendingOnly('ghostline')
    const farBehind = pendingOnly('ghostline')
    const alone = pendingOnly('ghostline')
    // #when each reaches a calm moment off the line
    observe(leading, offTheLine(200, { ghostLeadTicks: -12 }))
    observe(farBehind, offTheLine(200, { ghostLeadTicks: relayLeg.DRAFT_MAX_LEAD_TICKS + 1 }))
    observe(alone, stateAt(config, 30, { tick: 200, ghostLeadTicks: 30 }))
    // #then there is no line to draft for any of them
    expect([leading.view, farBehind.view, alone.view]).toEqual([null, null, null])
  })
})

describe('TutorialMachine FLOW prompt', () => {
  it('shows once FLOW first reaches the mid tier and completes by itself after its display', () => {
    // #given a courier building FLOW on a clear road
    const machine = pendingOnly('flow')
    observe(machine, stateAt(config, 20, { tick: 200, flow: Math.round(0.45 * ONE) }))
    const belowMid = machine.view
    // #when FLOW crosses into the mid tier and the prompt has been on screen for its display
    const shown = observe(machine, stateAt(config, 21, { tick: 201, flow: ONE / 2 }))
    const done = observe(machine, stateAt(config, 60, { tick: 201 + FLOW_SHOW_TICKS, flow: ONE / 2 }))
    // #then it showed at the mid tier and completed the tutorial by itself
    expect(belowMid).toBeNull()
    expect(shown).toEqual([{ kind: 'viewed', step: 'flow' }])
    expect(done).toEqual([{ kind: 'completed', step: 'flow' }, { kind: 'finished', step: 'flow' }])
  })
})

describe('TutorialMachine around the race', () => {
  it('hides while the race is paused and returns as the same prompt', () => {
    // #given the lane prompt on screen
    const machine = new TutorialMachine()
    observe(machine, calm(CALM_START_TICK))
    const before = machine.view
    // #when the race pauses and resumes
    observe(machine, calm(CALM_START_TICK), { racing: false })
    const paused = machine.view
    observe(machine, calm(CALM_START_TICK + 1))
    // #then it hid while paused and came back as the same prompt
    expect(paused).toBeNull()
    expect(machine.view).toMatchObject({ step: 'lane', status: 'showing', showing: before?.showing })
  })

  it('stays quiet while the courier closes on the handoff gate', () => {
    const machine = new TutorialMachine()
    observe(machine, calm(CALM_START_TICK), { approaching: true })
    expect(machine.view).toBeNull()
  })

  it('ends for good when skipped, naming the step on screen', () => {
    // #given the lane prompt on screen
    const machine = new TutorialMachine()
    observe(machine, calm(CALM_START_TICK))
    // #when the player skips, and the race runs on past a barrier
    const skipped = machine.skip()
    const effects = observe(machine, beforeBarrier(CALM_START_TICK + 60))
    // #then no prompt shows again
    expect(skipped).toBe('lane')
    expect(machine.over).toBe(true)
    expect(effects).toEqual([])
    expect(machine.view).toBeNull()
    expect(machine.skip()).toBeNull()
  })

  it('shows nothing once every step was completed', () => {
    // #given a tutorial completed in an earlier run
    const machine = new TutorialMachine(TUTORIAL_STEPS)
    // #when the race offers every kind of moment
    observe(machine, calm(CALM_START_TICK))
    observe(machine, beforeBarrier(CALM_START_TICK + 60))
    observe(machine, stateAt(config, 60, { tick: CALM_START_TICK + 120, x: -(5 * ONE) }))
    // #then it never prompts
    expect(machine.over).toBe(true)
    expect(machine.view).toBeNull()
  })

})
