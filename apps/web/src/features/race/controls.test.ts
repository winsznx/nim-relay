import { describe, expect, it } from 'vitest'
import { RelayControls, STEER_LIMIT, fullLockForWidth, type ControlSink } from './controls'

class RecordingSink implements ControlSink {
  steer = 0
  steers: number[] = []
  jumps = 0
  slides = 0
  pauses = 0
  setSteer(target: number): void {
    this.steer = target
    this.steers.push(target)
  }
  jump(): void {
    this.jumps++
  }
  slide(): void {
    this.slides++
  }
  pause(): void {
    this.pauses++
  }
}

function setup(fullLockPx = 90) {
  const sink = new RecordingSink()
  const controls = new RelayControls(sink, { fullLockPx })
  return { sink, controls }
}

/** Moves a pointer in 16ms steps along a straight line. */
function drag(controls: RelayControls, id: number, from: [number, number], to: [number, number], startMs: number, durationMs: number): number {
  const steps = Math.max(1, Math.round(durationMs / 16))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    controls.pointerMove(id, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, startMs + (durationMs * i) / steps)
  }
  return startMs + durationMs
}

describe('RelayControls touch steering', () => {
  it('maps horizontal drag distance to a steer target, full lock at the configured distance', () => {
    // #given a finger down with a 90px full lock
    const { sink, controls } = setup(90)
    controls.pointerDown(1, 200, 600, 0)
    // #when it drags half and then all of the full-lock distance
    drag(controls, 1, [200, 600], [245, 600], 0, 300)
    const half = sink.steer
    drag(controls, 1, [245, 600], [290, 600], 300, 300)
    // #then the target is half lock, then full lock
    expect(half).toBe(32)
    expect(sink.steer).toBe(STEER_LIMIT)
  })

  it('suits a 390px phone', () => {
    // #given a 390px wide screen
    // #when the full lock distance is chosen
    const fullLock = fullLockForWidth(390)
    // #then a thumb reaches full lock in under 100px
    expect(fullLock).toBeGreaterThan(80)
    expect(fullLock).toBeLessThan(100)
  })

  it('re-anchors past full lock so returning the finger responds immediately', () => {
    // #given a finger dragged far beyond full lock
    const { sink, controls } = setup(90)
    controls.pointerDown(1, 100, 600, 0)
    let t = drag(controls, 1, [100, 600], [300, 600], 0, 500)
    // #when it comes back by half the full-lock distance, then by the rest
    t = drag(controls, 1, [300, 600], [255, 600], t, 300)
    const halfway = sink.steer
    drag(controls, 1, [255, 600], [210, 600], t, 300)
    // #then steering follows straight away instead of waiting for the overshoot
    expect(halfway).toBe(32)
    expect(sink.steer).toBe(0)
  })

  it('continues from the current target when the finger touches down again', () => {
    // #given a steer target left by a previous drag
    const { sink, controls } = setup(90)
    controls.pointerDown(1, 100, 600, 0)
    drag(controls, 1, [100, 600], [145, 600], 0, 300)
    controls.pointerUp(1, 145, 600, 300)
    // #when a new finger lands elsewhere and nudges right
    controls.pointerDown(2, 20, 700, 1000)
    controls.pointerMove(2, 21, 700, 1016)
    // #then steering continues from the old target instead of snapping
    expect(sink.steer).toBe(33)
  })

  it('ignores a second finger while one is captured', () => {
    // #given one captured finger
    const { sink, controls } = setup()
    controls.pointerDown(1, 100, 600, 0)
    // #when a second finger lands and drags
    const captured = controls.pointerDown(2, 300, 600, 10)
    controls.pointerMove(2, 390, 600, 40)
    // #then it is refused and steers nothing
    expect(captured).toBe(false)
    expect(sink.steers).toEqual([])
  })
})

describe('RelayControls flicks', () => {
  it('jumps on a fast upward flick without moving the steer target', () => {
    // #given a finger that has steered and paused
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 600, 0)
    let t = drag(controls, 1, [200, 600], [230, 600], 0, 400)
    const before = sink.steer
    // #when it flicks up with some sideways drift
    t = drag(controls, 1, [230, 600], [244, 540], t + 100, 96)
    controls.pointerUp(1, 244, 540, t)
    // #then the courier jumps and the steer target is unchanged
    expect(sink.jumps).toBe(1)
    expect(sink.slides).toBe(0)
    expect(sink.steer).toBe(before)
  })

  it('slides on a fast downward flick', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 500, 0)
    // #when it flicks down
    const t = drag(controls, 1, [200, 500], [196, 560], 50, 96)
    controls.pointerUp(1, 196, 560, t)
    // #then the courier slides without steering
    expect(sink.slides).toBe(1)
    expect(sink.jumps).toBe(0)
    expect(sink.steer).toBe(0)
  })

  it('does not treat a slow vertical drag as a flick', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 600, 0)
    // #when it creeps upwards slowly
    const t = drag(controls, 1, [200, 600], [200, 520], 0, 900)
    controls.pointerUp(1, 200, 520, t)
    // #then nothing fires
    expect(sink.jumps).toBe(0)
    expect(sink.slides).toBe(0)
  })

  it('keeps steering responsive after a flick in the same touch', () => {
    // #given a flick that already jumped
    const { sink, controls } = setup(90)
    controls.pointerDown(1, 200, 600, 0)
    const afterFlick = drag(controls, 1, [200, 600], [206, 540], 0, 96)
    // #when the same finger then drags sideways
    drag(controls, 1, [206, 540], [251, 540], afterFlick + 300, 300)
    // #then it steers normally
    expect(sink.jumps).toBe(1)
    expect(sink.steer).toBe(32)
  })

  it('does not fire twice for one long flick', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 800, 0)
    // #when it makes one long fast upward stroke
    const t = drag(controls, 1, [200, 800], [200, 640], 0, 160)
    controls.pointerUp(1, 200, 640, t)
    // #then only one jump fires
    expect(sink.jumps).toBe(1)
  })
})

describe('RelayControls keyboard', () => {
  it('steers while arrows or A/D are held and keeps the target on release', () => {
    // #given frame updates of 25ms
    const { sink, controls } = setup()
    const frames = (ms: number) => {
      for (let t = 0; t < ms; t += 25) controls.update(25)
    }
    // #when right is held, released, then A is held briefly
    const handled = controls.keyDown('ArrowRight')
    frames(250)
    const held = sink.steer
    controls.keyUp('ArrowRight')
    frames(250)
    const released = sink.steer
    controls.keyDown('a')
    frames(125)
    controls.keyUp('a')
    // #then steering sweeps, holds on release and sweeps back
    expect(handled).toBe(true)
    expect(held).toBe(64)
    expect(released).toBe(64)
    expect(sink.steer).toBe(32)
  })

  it('limits a single long frame so a hitch cannot swing the courier across the track', () => {
    // #given a held steer key
    const { sink, controls } = setup()
    controls.keyDown('d')
    // #when one two-second frame arrives
    controls.update(2000)
    // #then the target moves less than full lock
    expect(sink.steer).toBeLessThan(STEER_LIMIT)
  })

  it('maps jump, slide and pause keys, ignoring auto-repeat for actions', () => {
    // #given the controls
    const { sink, controls } = setup()
    // #when action keys are pressed, one of them auto-repeating
    controls.keyDown('ArrowUp')
    controls.keyDown('w', true)
    controls.keyDown(' ')
    controls.keyDown('W')
    controls.keyDown('ArrowDown')
    controls.keyDown('s')
    controls.keyDown('Escape')
    const unrelated = controls.keyDown('q')
    // #then each press fires once, repeats are ignored and other keys pass through
    expect(sink.jumps).toBe(3)
    expect(sink.slides).toBe(2)
    expect(sink.pauses).toBe(1)
    expect(unrelated).toBe(false)
  })

  it('releases held keys on reset', () => {
    // #given a held steer key
    const { sink, controls } = setup()
    controls.keyDown('d')
    // #when the controls reset (blur or pause) and frames continue
    controls.reset()
    controls.update(500)
    // #then nothing steers
    expect(sink.steers).toEqual([])
  })
})
