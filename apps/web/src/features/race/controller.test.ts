import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { RelayLegController, TICK_MS, type RaceCue } from './controller'
import { createBot, playBotLeg } from './dev/bot'

const config: relayLeg.Config = {
  engineVersion: '5',
  challenge: 'relay-leg',
  challengeVersion: '5',
  seed: 'controller-test',
  world: 'metro',
  tier: 1,
  openingFlow: 0,
}

/** Runs frames of `stepMs` until the predicate holds or the frame budget runs out. */
function runUntil(controller: RelayLegController, predicate: () => boolean, stepMs = 100, start = 0, maxFrames = 4000): number {
  let now = start
  controller.frame(now)
  for (let i = 0; i < maxFrames && !predicate(); i++) {
    now += stepMs
    controller.frame(now)
  }
  return now
}

describe('RelayLegController phases', () => {
  it('plays the arrival, then the catch beat, then starts the simulation', () => {
    // #given a practice leg with a one-second arrival
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 1000, catchMs: 1200, maxFrameMs: 10_000, maxOpeningFrameMs: 10_000 })
    const cues: RaceCue['kind'][] = []
    controller.onCue(cue => cues.push(cue.kind))
    controller.frame(0)

    // #when time passes through the opening
    controller.frame(900)
    const duringArrival = controller.getRenderSnapshot().phase
    controller.frame(1100)
    const duringCatch = { phase: controller.getRenderSnapshot().phase, tick: controller.getRenderSnapshot().state.tick }
    controller.frame(2200)
    const atGo = { phase: controller.getRenderSnapshot().phase, tick: controller.getRenderSnapshot().state.tick }
    controller.frame(2200 + TICK_MS * 30)

    // #then the simulation only starts ticking after the catch
    expect(duringArrival).toBe('arrival')
    expect(duringCatch).toEqual({ phase: 'catch', tick: 0 })
    expect(atGo).toEqual({ phase: 'racing', tick: 0 })
    expect(controller.getRenderSnapshot().state.tick).toBe(30)
    expect(cues.slice(0, 2)).toEqual(['catch', 'go'])
  })

  it('pauses the opening through a slow frame instead of skipping it', () => {
    // #given a leg in its arrival cinematic
    const controller = new RelayLegController(config, { mode: 'relay', openingMs: 3000, catchMs: 1200 })
    controller.frame(0)
    // #when a two-second hitch lands on one frame
    controller.frame(2000)
    // #then the cinematic advances by one short slice and is still arriving
    expect(controller.getRenderSnapshot().openingElapsedMs).toBe(50)
    expect(controller.getRenderSnapshot().phase).toBe('arrival')
  })

  it('never simulates more than one frame budget after a long stall', () => {
    // #given a running leg with the default frame budget
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0 })
    controller.frame(0)
    // #when a five-second stall arrives in one frame
    controller.frame(5000)
    // #then only 250ms of ticks are simulated
    expect(controller.getRenderSnapshot().state.tick).toBe(15)
  })

  it('does not advance ticks while paused, and resumes without a time jump', () => {
    // #given a leg one second into the race
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0, maxFrameMs: 1e9 })
    controller.frame(0)
    controller.frame(TICK_MS * 60)
    const before = controller.getRenderSnapshot().state.tick

    // #when it is paused while time passes, then resumed
    controller.pause()
    const pausedPhase = controller.getSnapshot().phase
    controller.frame(TICK_MS * 200)
    controller.frame(TICK_MS * 5000)
    const whilePaused = controller.getRenderSnapshot().state.tick
    controller.resume()
    controller.frame(TICK_MS * 6000)
    const afterResume = controller.getRenderSnapshot().state.tick
    controller.frame(TICK_MS * 6010)

    // #then no ticks ran while paused and the first frame after resume adds none
    expect(before).toBe(60)
    expect(pausedPhase).toBe('paused')
    expect(whilePaused).toBe(before)
    expect(afterResume).toBe(before)
    expect(controller.getRenderSnapshot().state.tick).toBe(before + 10)
  })

  it('ignores actions outside the race', () => {
    // #given a leg still in its opening
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 500, catchMs: 500 })
    controller.frame(0)
    // #when jump is pressed before the race starts
    controller.jump()
    controller.frame(1000 + TICK_MS * 3)
    // #then no jump is recorded
    expect(controller.getRenderSnapshot().state.metrics.jumps).toBe(0)
  })
})

describe('RelayLegController verification', () => {
  it('records a trace that replays to the same verified result', () => {
    // #given a leg steered through the controller's input methods
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0 })
    const bot = createBot({ fork: 'risk' })
    let now = 0
    controller.frame(now)

    // #when the leg is raced to the end frame by frame
    for (let frame = 0; frame < 20000 && controller.getSnapshot().phase !== 'finished'; frame++) {
      const input = bot(controller.getRenderSnapshot().state)
      controller.setSteer(input.steer)
      if (input.action === relayLeg.ACTION_JUMP) controller.jump()
      if (input.action === relayLeg.ACTION_SLIDE) controller.slide()
      now += TICK_MS
      controller.frame(now)
    }

    // #then the recorded trace replays canonically to the published result
    const snapshot = controller.getSnapshot()
    expect(snapshot.phase).toBe('finished')
    expect(snapshot.divergence).toBe(false)
    expect(snapshot.trace).not.toBeNull()
    const canonical = relayLeg.replay({ ...config, inputTrace: snapshot.trace! })
    expect(snapshot.result?.resultHash).toBe(canonical.resultHash)
    expect(snapshot.result?.ticks).toBe(controller.getRenderSnapshot().state.tick)
  })

  it('records the autopilot through the same path as a player', () => {
    // #given a leg driven by the dev autopilot
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0, autopilot: createBot({ fork: 'safe' }) })
    // #when it runs to the finish
    runUntil(controller, () => controller.getSnapshot().phase === 'finished', 250)
    // #then its trace verifies like any player's
    const snapshot = controller.getSnapshot()
    expect(snapshot.result?.completed).toBe(true)
    expect(relayLeg.replay({ ...config, inputTrace: snapshot.trace! }).resultHash).toBe(snapshot.result?.resultHash)
  })

  it('reproduces a given trace in watch mode without recording', () => {
    // #given a canonical run and a watch controller for it
    const run = playBotLeg(config, { fork: 'risk', lag: 2 })
    const watch = new RelayLegController(config, { mode: 'watch', playback: run.trace, openingMs: 0, catchMs: 0 })
    // #when input is attempted and the replay plays out
    watch.setSteer(64)
    runUntil(watch, () => watch.getSnapshot().phase === 'finished', 250)
    // #then it reproduces the run's result from the given trace
    const snapshot = watch.getSnapshot()
    expect(snapshot.result?.resultHash).toBe(run.result.resultHash)
    expect(snapshot.trace).toBe(run.trace)
    expect(snapshot.divergence).toBe(false)
  })
})

describe('RelayLegController ghost', () => {
  it('reports the ghost ahead of a slower courier', () => {
    // #given a fast ghost and a courier that never steers or jumps
    const fast = playBotLeg(config, { fork: 'risk' })
    const controller = new RelayLegController(config, {
      mode: 'relay',
      openingMs: 0,
      catchMs: 0,
      ghost: { config, trace: fast.trace, name: 'MARIANA', timeMs: fast.result.timeMs },
      autopilot: () => ({ steer: 0, action: 0 }),
    })
    // #when fifteen seconds of race pass
    runUntil(controller, () => controller.getRenderSnapshot().state.tick >= 900, 250)
    // #then the ghost is ahead
    expect(controller.getRenderSnapshot().ghostDelta).toBeGreaterThan(0)
  })

  it('reports the courier ahead of a slower ghost with its own opening flow', () => {
    // #given a hesitant ghost whose own config carries a different opening FLOW
    const hesitant = playBotLeg(config, { fork: 'safe', lag: 30 })
    const ghostConfig = { ...config, openingFlow: relayLeg.MAX_OPENING_FLOW }
    const cues: RaceCue['kind'][] = []
    const controller = new RelayLegController(config, {
      mode: 'relay',
      openingMs: 0,
      catchMs: 0,
      ghost: { config: ghostConfig, trace: hesitant.trace, name: 'TIM', timeMs: hesitant.result.timeMs },
      autopilot: createBot({ fork: 'risk' }),
    })
    controller.onCue(cue => cues.push(cue.kind))
    // #when a sharp courier races it to the end
    runUntil(controller, () => controller.getSnapshot().phase === 'finished', 250)
    // #then the courier leads at the finish and the approach and finish cues fired
    expect(controller.getRenderSnapshot().ghostDelta).toBeLessThan(0)
    expect(controller.getSnapshot().leader).toBe('you')
    expect(cues).toContain('approach')
    expect(cues.at(-1)).toBe('finish')
  })

  it('ignores a ghost recorded on a different track', () => {
    // #given a valid run from another seed
    const run = playBotLeg(config, { fork: 'safe' })
    // #when it is offered as the ghost
    const controller = new RelayLegController(config, {
      mode: 'relay',
      ghost: { config: { ...config, seed: 'another-route' }, trace: run.trace, name: 'MARIANA', timeMs: run.result.timeMs },
    })
    // #then the leg runs without a ghost
    expect(controller.ghostRun).toBeNull()
    expect(controller.getRenderSnapshot().ghost).toBeNull()
    expect(controller.getSnapshot().ghostDelta).toBeNull()
  })

  it('ignores a malformed ghost trace', () => {
    // #given a trace whose first sample does not start at tick 0
    // #when it is offered as the ghost
    const controller = new RelayLegController(config, {
      mode: 'relay',
      ghost: { config, trace: [[5, 0, 0]], name: 'MARIANA', timeMs: 40000 },
    })
    // #then the leg runs without a ghost
    expect(controller.ghostRun).toBeNull()
  })
})
