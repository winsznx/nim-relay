import { describe, expect, it } from 'vitest'
import { replay, scoreState } from '@nim-relay/game-engine'
import { GameController } from './controller'

function playing() {
  const controller = new GameController('stabilize')
  controller.start()
  controller.frame(0)
  controller.frame(3000)
  return controller
}

describe('fixed-tick client input lifecycle', () => {
  it('combines multiple pointers and keyboard without releasing another source', () => {
    const controller = playing()
    controller.pointer(1, true); controller.pointer(2, true)
    controller.frame(3020)
    controller.pointer(1, false)
    expect(controller.getSnapshot().held).toBe(true)
    controller.keyboard(true); controller.pointer(2, false)
    expect(controller.getSnapshot().held).toBe(true)
    controller.keyboard(false)
    expect(controller.getSnapshot().held).toBe(false)
  })
  it('clears input on pause and restart, never simulates the wall-time pause', () => {
    const controller = playing()
    controller.pointer(1, true); controller.frame(3100)
    const tick = controller.getRenderSnapshot().state.tick
    controller.pause(); controller.frame(100000)
    expect(controller.getSnapshot().state.tick).toBe(tick)
    expect(controller.getSnapshot().held).toBe(false)
    controller.resume(); controller.frame(200000); controller.frame(200020)
    expect(controller.getRenderSnapshot().state.tick).toBeLessThan(tick + 3)
    expect(controller.getRenderSnapshot().state.lastInput).toBe(0)
    controller.start()
    expect(controller.getSnapshot().state.tick).toBe(0)
    expect(controller.getSnapshot().trace).toEqual([])
    expect(controller.getSnapshot().held).toBe(false)
  })
  it('keeps published snapshots stable between frame notifications', () => {
    const controller = playing()
    const published = controller.getSnapshot()
    const before = JSON.stringify(published)
    controller.frame(3001)
    expect(JSON.stringify(published)).toBe(before)
  })
  it('catches up delayed frames without dropping ticks and replays the same breakdown', () => {
    const controller = playing()
    controller.keyboard(true); controller.frame(4200)
    controller.keyboard(false); controller.frame(8700)
    controller.keyboard(true); controller.frame(12000)
    controller.keyboard(false); controller.frame(24000)
    const snapshot = controller.getSnapshot()
    expect(snapshot.phase).toBe('results')
    expect(snapshot.state.tick).toBe(1200)
    const result = replay({ ...controller.config, inputTrace: snapshot.trace })
    expect(snapshot.result).toEqual(result)
    expect(scoreState(snapshot.state)).toEqual({ score: result.score, breakdown: result.breakdown })
    expect(snapshot.held).toBe(false)
  })
})
