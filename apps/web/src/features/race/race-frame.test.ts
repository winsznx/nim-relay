import { relayLeg } from '@nim-relay/game-engine'
import { describe, expect, it } from 'vitest'
import { RelayLegController, TICK_MS, type RenderSnapshot } from './controller'
import { createBot } from './dev/bot'
import { createRaceFrame, normalizedSpeed, writeRaceFrame } from './race-frame'

const config: relayLeg.Config = {
  engineVersion: '5',
  challenge: 'relay-leg',
  challengeVersion: '5',
  seed: 'race-frame-test',
  world: 'coast',
  tier: 1,
  openingFlow: 0,
}

const MPS = relayLeg.TICK_RATE / 65536

interface ClockSample {
  clock: number
  running: boolean
  phase: RenderSnapshot['phase']
}

function clockOf(controller: RelayLegController): ClockSample {
  const frame = writeRaceFrame(createRaceFrame(), controller.getRenderSnapshot(), 0)
  return { clock: frame.tick + frame.alpha, running: frame.running, phase: controller.getRenderSnapshot().phase }
}

describe('writeRaceFrame clock', () => {
  it('counts up through the opening and crosses zero at the start without a jump', () => {
    // #given a relay leg with a one second arrival and a 1.2 s catch
    const controller = new RelayLegController(config, { mode: 'relay', openingMs: 1000, catchMs: 1200 })
    const samples: ClockSample[] = []
    // #when it runs at 16 ms frames until shortly after the start
    for (let now = 0; samples.filter(sample => sample.phase === 'racing').length < 5; now += 16) {
      controller.frame(now)
      samples.push(clockOf(controller))
    }
    // #then the clock starts 2.2 s before tick 0, never stops and moves the same amount every frame
    const steps = samples.slice(1).map((sample, index) => sample.clock - samples[index]!.clock)
    const firstRacing = samples.find(sample => sample.phase === 'racing')!
    expect(samples[0]!.clock).toBeCloseTo(-2200 / TICK_MS, 9)
    expect(samples.every(sample => sample.running)).toBe(true)
    expect(steps.every(step => Math.abs(step - 16 / TICK_MS) < 1e-6)).toBe(true)
    expect(firstRacing.clock).toBeGreaterThanOrEqual(0)
    expect(firstRacing.clock).toBeLessThan(1)
  })

  it('stops the clock while paused', () => {
    // #given a leg one second into the race
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0, maxFrameMs: 1e9 })
    controller.frame(0)
    controller.frame(TICK_MS * 60)
    // #when it is paused and time passes
    controller.pause()
    controller.frame(TICK_MS * 400)
    const frame = writeRaceFrame(createRaceFrame(), controller.getRenderSnapshot(), 30)
    // #then the clock holds its tick, stops running and reports no motion
    expect(frame).toMatchObject({ tick: 60, running: false, speed01: 0 })
  })

  it('stops the clock on the final tick after the finish', () => {
    // #given a leg raced to the end by the autopilot
    const controller = new RelayLegController(config, { mode: 'practice', openingMs: 0, catchMs: 0, autopilot: createBot({ fork: 'safe' }) })
    for (let now = 0; controller.getSnapshot().phase !== 'finished' && now < 1e6; now += 250) controller.frame(now)
    // #when the frame is written
    const frame = writeRaceFrame(createRaceFrame(), controller.getRenderSnapshot(), 0)
    // #then it holds the finishing tick and is no longer running
    expect(frame).toMatchObject({ tick: controller.getSnapshot().result?.ticks, alpha: 0, running: false })
  })
})

describe('writeRaceFrame courier state', () => {
  function racingSnapshot(overrides: Partial<relayLeg.State>, phase: RenderSnapshot['phase']): RenderSnapshot {
    const base = relayLeg.createState(config)
    const state = { ...base, tick: 120, ...overrides }
    return {
      phase,
      activePhase: 'racing',
      openingElapsedMs: 0,
      openingMs: 0,
      catchMs: 0,
      finishedMs: 0,
      alpha: 0.5,
      state,
      previous: { ...state, tick: 119, flow: 0 },
      ghost: null,
      ghostPrevious: null,
      frameEvents: 0,
      ghostFrameEvents: 0,
      ghostDelta: null,
      approaching: false,
    }
  }

  it('interpolates FLOW and reports a rail grind while racing', () => {
    // #given a courier grinding a rail with FLOW rising from empty to full over the tick
    const snapshot = racingSnapshot({ railing: 1, flow: 65536 }, 'racing')
    // #when the frame is written halfway between ticks
    const frame = writeRaceFrame(createRaceFrame(), snapshot, 40)
    // #then FLOW is halfway and the grind is on
    expect(frame).toMatchObject({ tick: 120, alpha: 0.5, running: true, flow: 0.5, railing: true })
  })

  it('carries the simulation position and ghost gap behind the frame', () => {
    // #given a courier on the risk path with the ghost 0.25 s ahead
    const snapshot = { ...racingSnapshot({ dist: 700 * 65536, path: 'risk' }, 'racing'), ghostDelta: 0.25 }
    // #when the frame is written
    const frame = writeRaceFrame(createRaceFrame(), snapshot, 40)
    // #then it reports exactly that state
    expect(frame).toMatchObject({ tick: 120, dist: 700 * 65536, finishDist: snapshot.state.track.finishDist, path: 'risk', ghostDelta: 0.25 })
  })

  it('drops the grind while paused so held sounds can stop', () => {
    // #given the same grind, paused
    const snapshot = racingSnapshot({ railing: 1 }, 'paused')
    // #when the frame is written
    const frame = writeRaceFrame(createRaceFrame(), snapshot, 40)
    // #then nothing is moving or grinding
    expect(frame).toMatchObject({ running: false, railing: false, speed01: 0 })
  })

  it('maps speed onto the engine range from stumble to top speed', () => {
    // #given the engine's stumble, cruising and top speeds in metres per second
    const stumble = relayLeg.STUMBLE_SPEED * MPS
    const cruise = relayLeg.BASE_SPEED * MPS
    const top = (relayLeg.BASE_SPEED + relayLeg.FLOW_SPEED + relayLeg.RAIL_SPEED + relayLeg.PAD_SPEED) * MPS
    // #then stumble is 0, top is 1, cruising sits between and standing still clamps to 0
    expect(normalizedSpeed(stumble)).toBeCloseTo(0, 9)
    expect(normalizedSpeed(top)).toBeCloseTo(1, 9)
    expect(normalizedSpeed(cruise)).toBeCloseTo((relayLeg.BASE_SPEED - relayLeg.STUMBLE_SPEED) / (top / MPS - relayLeg.STUMBLE_SPEED), 9)
    expect(normalizedSpeed(0)).toBe(0)
  })
})
