import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { RelayLegController, TICK_MS, type RaceCue } from './controller'
import { createBot, playBotLeg } from './dev/bot'

const config: relayLeg.Config = {
  engineVersion: '6',
  challenge: 'relay-leg',
  challengeVersion: '6',
  seed: 'controller-test',
  world: 'metro',
  tier: 1,
  openingFlow: 0,
  tetherSaves: 1,
  ghostline: null,
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

/** A leg past its opening, ready to take input on its next frame. */
function racing(options: Partial<ConstructorParameters<typeof RelayLegController>[1]> = {}, legConfig = config): RelayLegController {
  const controller = new RelayLegController(legConfig, { mode: 'practice', openingMs: 0, catchMs: 0, maxFrameMs: 1e9, ...options })
  controller.frame(0)
  return controller
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
    const controller = racing()
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

  it('ignores actions and lane shifts outside the race', () => {
    // #given a leg still in its opening
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 500, catchMs: 500 })
    controller.frame(0)
    // #when jump and a lane shift are pressed before the race starts
    controller.jump()
    controller.shift(1)
    controller.frame(1000 + TICK_MS * 3)
    // #then nothing reaches the simulation
    const state = controller.getRenderSnapshot().state
    expect({ jumps: state.metrics.jumps, targetLane: state.targetLane }).toEqual({ jumps: 0, targetLane: 0 })
  })
})

describe('RelayLegController lanes', () => {
  it('applies flicks that arrive together on consecutive ticks, two lanes over', () => {
    // #given a courier settled in the centre lane of a three-lane road
    const controller = racing()
    controller.frame(TICK_MS * 30)
    // #when two right flicks land before the next frame
    controller.shift(1)
    controller.shift(1)
    controller.frame(TICK_MS * 31)
    const afterFirst = controller.getRenderSnapshot().state.targetLane
    controller.frame(TICK_MS * 32)
    // #then the first tick targets the right lane and the second the shoulder beyond it
    expect(afterFirst).toBe(2)
    expect(controller.getRenderSnapshot().state.targetLane).toBe(3)
  })

  it('holds a nudge until it changes and magnetizes when released', () => {
    // #given a racing courier
    const controller = racing()
    // #when a nudge is held for a while, then released
    controller.setNudge(6)
    controller.frame(TICK_MS * 20)
    const held = controller.getRenderSnapshot().state.nudge
    controller.setNudge(0)
    controller.frame(TICK_MS * 21)
    // #then the simulation holds it every tick and drops it on release
    expect(held).toBe(6)
    expect(controller.getRenderSnapshot().state.nudge).toBe(0)
  })

  it('clamps and rounds nudges to the engine range', () => {
    // #given a racing courier
    const controller = racing()
    // #when a nudge far past the range and a fractional one are set
    controller.setNudge(40)
    controller.frame(TICK_MS)
    const high = controller.getRenderSnapshot().state.nudge
    controller.setNudge(-2.6)
    controller.frame(TICK_MS * 2)
    // #then both reach the engine as legal whole units
    expect(high).toBe(relayLeg.NUDGE_RANGE)
    expect(controller.getRenderSnapshot().state.nudge).toBe(-3)
  })

  it('reports the shoulder while the courier rides outside the lanes', () => {
    // #given a courier sent from the centre lane onto the right shoulder
    const controller = racing()
    controller.frame(TICK_MS * 10)
    controller.shift(1)
    controller.shift(1)
    // #when it has had time to get there
    controller.frame(TICK_MS * 60)
    // #then the snapshot reads the shoulder
    expect(controller.getSnapshot().shoulder).toBe(true)
  })
})

describe('RelayLegController verification', () => {
  it('records flicks, nudges and actions into a trace that replays to the same verified result', () => {
    // #given a leg driven through the controller's input methods by the dev bot
    const controller = racing({ maxFrameMs: 250 })
    const bot = createBot({ fork: 'risk', bias: 3 })
    let now = 0

    // #when the leg is raced to the end one tick per frame
    for (let frame = 0; frame < 20000 && controller.getSnapshot().phase !== 'finished'; frame++) {
      const input = bot(controller.getRenderSnapshot().state)
      controller.setNudge(input.nudge)
      if (input.shift !== 0) controller.shift(input.shift)
      if (input.action === relayLeg.ACTION_JUMP) controller.jump()
      if (input.action === relayLeg.ACTION_SLIDE) controller.slide()
      now += TICK_MS
      controller.frame(now)
    }

    // #then the recorded trace replays canonically to the published result
    const snapshot = controller.getSnapshot()
    expect(snapshot.phase).toBe('finished')
    expect(snapshot.divergence).toBe(false)
    expect(snapshot.result?.completed).toBe(true)
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
    watch.shift(1)
    watch.setNudge(8)
    runUntil(watch, () => watch.getSnapshot().phase === 'finished', 250)
    // #then it reproduces the run's result from the given trace
    const snapshot = watch.getSnapshot()
    expect(snapshot.result?.resultHash).toBe(run.result.resultHash)
    expect(snapshot.trace).toBe(run.trace)
    expect(snapshot.divergence).toBe(false)
  })

  it('finishes a leg that ends in a fall with no tether left as failed', () => {
    // #given a leg without tether saves whose autopilot rides off an open edge
    const legConfig: relayLeg.Config = { ...config, world: 'coast', seed: 'dev-leg', tetherSaves: 0 }
    const controller = new RelayLegController(legConfig, { mode: 'practice', openingMs: 0, catchMs: 0, autopilot: createBot({ fork: 'risk', fallAt: 440 }) })
    // #when it runs out
    runUntil(controller, () => controller.getSnapshot().phase === 'finished', 250)
    // #then the verified result is a failed leg and the snapshot shows why
    const snapshot = controller.getSnapshot()
    expect({ failed: snapshot.result?.failed, completed: snapshot.result?.completed, motion: snapshot.motion, divergence: snapshot.divergence }).toEqual({
      failed: true,
      completed: false,
      motion: 'failed',
      divergence: false,
    })
  })

  it('drains the Relay Rush share as the rush runs out', () => {
    // #given a leg raced by the autopilot from the highest opening FLOW
    const controller = new RelayLegController({ ...config, openingFlow: relayLeg.MAX_OPENING_FLOW }, { mode: 'practice', openingMs: 0, catchMs: 0, maxFrameMs: 1e9, autopilot: createBot({ fork: 'risk' }) })
    controller.frame(0)
    // #when the first rush starts and runs for a second
    let now = 0
    while (controller.getRenderSnapshot().state.rushTicks === 0 && now < 60_000) controller.frame((now += TICK_MS))
    const start = controller.getRenderSnapshot().state.tick
    controller.frame((now += TICK_MS * 2))
    const early = controller.getSnapshot()
    controller.frame((now += TICK_MS * 60))
    const later = controller.getSnapshot()
    // #then the rush share starts near full and drains, with the tier on rush
    expect(start).toBeGreaterThan(0)
    expect(early.flowTier).toBe('rush')
    expect(early.rush).toBeGreaterThan(0.95)
    expect(later.rush).toBeLessThan(early.rush!)
  })
})

describe('RelayLegController ghost', () => {
  const quickStart: relayLeg.Config = { ...config, openingFlow: relayLeg.MAX_OPENING_FLOW }

  it('reads the gap to a ghostline from the engine and leaves overtakes to its events', () => {
    // #given a quick-starting ghost and its verified ghostline in the courier's config
    const ghostRun = playBotLeg(quickStart, { fork: 'safe' })
    const legConfig: relayLeg.Config = { ...config, ghostline: relayLeg.deriveGhostline(quickStart, ghostRun.trace) }
    const cues: RaceCue[] = []
    const controller = new RelayLegController(legConfig, {
      mode: 'relay',
      openingMs: 0,
      catchMs: 0,
      maxFrameMs: 1e9,
      ghost: { config: quickStart, trace: ghostRun.trace, name: 'MARIANA', timeMs: ghostRun.result.timeMs },
      autopilot: createBot({ fork: 'risk' }),
    })
    controller.onCue(cue => cues.push(cue))
    // #when the courier races the whole leg
    runUntil(controller, () => controller.getSnapshot().phase === 'finished', 250)
    // #then the gap followed the engine, overtakes came as engine events, and no named overtake cue was added
    const events = cues.reduce((mask, cue) => (cue.kind === 'events' ? mask | cue.events : mask), 0)
    expect(events & relayLeg.EVENT.GHOST_OVERTAKE).not.toBe(0)
    expect(cues.some(cue => cue.kind === 'overtake' || cue.kind === 'overtaken')).toBe(false)
    expect(controller.getSnapshot().leader).toBe('you')
  })

  it('measures a ghost raced without a ghostline from its replay and names the overtake', () => {
    // #given a quick-starting ghost and no ghostline, as an official Daily issues it
    const ghostRun = playBotLeg(quickStart, { fork: 'safe' })
    const cues: RaceCue['kind'][] = []
    const controller = new RelayLegController(config, {
      mode: 'daily',
      openingMs: 0,
      catchMs: 0,
      ghost: { config: quickStart, trace: ghostRun.trace, name: 'MARIANA', timeMs: ghostRun.result.timeMs },
      autopilot: createBot({ fork: 'risk' }),
    })
    controller.onCue(cue => cues.push(cue.kind))
    // #when the courier falls behind early and passes her later
    runUntil(controller, () => controller.getSnapshot().phase === 'finished', 250)
    // #then the lead changes are named cues and the courier leads at the finish
    expect(cues).toContain('overtake')
    expect(controller.getRenderSnapshot().ghostDelta).toBeLessThan(0)
    expect(cues.at(-1)).toBe('finish')
  })

  it('reports the ghost ahead of a slower courier', () => {
    // #given a fast ghost and a courier that never steers or jumps
    const fast = playBotLeg(config, { fork: 'risk' })
    const controller = new RelayLegController(config, {
      mode: 'relay',
      openingMs: 0,
      catchMs: 0,
      ghost: { config, trace: fast.trace, name: 'MARIANA', timeMs: fast.result.timeMs },
      autopilot: () => ({ shift: 0, nudge: 0, action: 0 }),
    })
    // #when fifteen seconds of race pass
    runUntil(controller, () => controller.getRenderSnapshot().state.tick >= 900, 250)
    // #then the ghost is ahead
    expect(controller.getRenderSnapshot().ghostDelta).toBeGreaterThan(0)
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
      ghost: { config, trace: [[5, 0, 0, 0]], name: 'MARIANA', timeMs: 40000 },
    })
    // #then the leg runs without a ghost
    expect(controller.ghostRun).toBeNull()
  })
})
