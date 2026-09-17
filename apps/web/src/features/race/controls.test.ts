import { describe, expect, it } from 'vitest'
import { NUDGE_LIMIT, RelayControls, nudgeSpanForWidth, type ControlSink } from './controls'

class RecordingSink implements ControlSink {
  nudge = 0
  nudges: number[] = []
  shifts: (-1 | 1)[] = []
  jumps = 0
  slides = 0
  pauses = 0
  shift(direction: -1 | 1): void {
    this.shifts.push(direction)
  }
  setNudge(nudge: number): void {
    this.nudge = nudge
    this.nudges.push(nudge)
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

function setup(fullNudgePx = 48) {
  const sink = new RecordingSink()
  const controls = new RelayControls(sink, { fullNudgePx })
  return { sink, controls }
}

/** Moves a pointer in 16ms steps along a straight line; returns the end time. */
function drag(controls: RelayControls, id: number, from: [number, number], to: [number, number], startMs: number, durationMs: number): number {
  const steps = Math.max(1, Math.round(durationMs / 16))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    controls.pointerMove(id, from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, startMs + (durationMs * i) / steps)
  }
  return startMs + durationMs
}

describe('RelayControls lane flicks', () => {
  it('shifts one lane per quick horizontal flick, whichever way it goes', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 600, 0)
    // #when it flicks right and lifts, then a new touch flicks left
    let t = drag(controls, 1, [200, 600], [260, 604], 0, 96)
    controls.pointerUp(1, 260, 604, t)
    controls.pointerDown(2, 220, 620, 400)
    t = drag(controls, 2, [220, 620], [170, 612], 400, 80)
    controls.pointerUp(2, 170, 612, t)
    // #then one shift each way fires and nothing nudges
    expect(sink.shifts).toEqual([1, -1])
    expect(sink.nudges.filter(value => value !== 0)).toEqual([])
  })

  it('fires a single shift for one long fast swipe', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 40, 600, 0)
    // #when it sweeps across most of the screen in one quick stroke
    const t = drag(controls, 1, [40, 600], [340, 600], 0, 192)
    controls.pointerUp(1, 340, 600, t)
    // #then it is still one lane
    expect(sink.shifts).toEqual([1])
  })

  it('reads a quick zig-zag in one touch as two flicks', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 600, 0)
    // #when it flicks right and immediately back left without lifting
    let t = drag(controls, 1, [200, 600], [250, 600], 0, 80)
    t = drag(controls, 1, [250, 600], [190, 600], t, 96)
    controls.pointerUp(1, 190, 600, t)
    // #then both flicks shift
    expect(sink.shifts).toEqual([1, -1])
  })

  it('shifts twice for two flicks inside 150 ms', () => {
    // #given two quick taps-and-flicks to the right, 130 ms apart
    const { sink, controls } = setup()
    controls.pointerDown(1, 150, 600, 0)
    let t = drag(controls, 1, [150, 600], [190, 600], 0, 48)
    controls.pointerUp(1, 190, 600, t)
    controls.pointerDown(2, 160, 600, 130)
    t = drag(controls, 2, [160, 600], [200, 600], 130, 48)
    controls.pointerUp(2, 200, 600, t)
    // #then each flick is its own shift
    expect(sink.shifts).toEqual([1, 1])
  })

  it('never shifts lanes on a vertical flick with sideways drift', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 600, 0)
    // #when it flicks up with drift, lifts, and a new touch flicks down with drift
    let t = drag(controls, 1, [200, 600], [226, 530], 0, 96)
    controls.pointerUp(1, 226, 530, t)
    controls.pointerDown(2, 200, 500, 500)
    t = drag(controls, 2, [200, 500], [178, 565], 500, 96)
    controls.pointerUp(2, 178, 565, t)
    // #then it jumps and slides without a shift
    expect({ jumps: sink.jumps, slides: sink.slides, shifts: sink.shifts }).toEqual({ jumps: 1, slides: 1, shifts: [] })
  })

  it('does not shift on a slow sideways drag', () => {
    // #given a finger down
    const { sink, controls } = setup()
    controls.pointerDown(1, 200, 600, 0)
    // #when it creeps sideways further than a flick travels
    const t = drag(controls, 1, [200, 600], [260, 600], 0, 900)
    controls.pointerUp(1, 260, 600, t)
    // #then there is no shift
    expect(sink.shifts).toEqual([])
  })
})

describe('RelayControls nudge', () => {
  it('nudges with a slow drag relative to touch-down, full at the configured distance', () => {
    // #given a finger down with a 48px full nudge
    const { sink, controls } = setup(48)
    controls.pointerDown(1, 200, 600, 0)
    // #when it drags half and then all of the full-nudge distance slowly
    const t = drag(controls, 1, [200, 600], [224, 600], 0, 400)
    const half = sink.nudge
    drag(controls, 1, [224, 600], [248, 600], t, 400)
    // #then the nudge is half, then full
    expect(half).toBe(NUDGE_LIMIT / 2)
    expect(sink.nudge).toBe(NUDGE_LIMIT)
    expect(sink.shifts).toEqual([])
  })

  it('magnetizes back to the lane centre when the finger lifts', () => {
    // #given a finger holding a nudge to the left
    const { sink, controls } = setup(48)
    controls.pointerDown(1, 200, 600, 0)
    const t = drag(controls, 1, [200, 600], [170, 600], 0, 500)
    const held = sink.nudge
    // #when it lifts
    controls.pointerUp(1, 170, 600, t)
    // #then the nudge returns to zero
    expect(held).toBe(-5)
    expect(sink.nudge).toBe(0)
  })

  it('re-anchors past a full nudge so returning the finger responds immediately', () => {
    // #given a finger dragged far beyond a full nudge
    const { sink, controls } = setup(48)
    controls.pointerDown(1, 100, 600, 0)
    const t = drag(controls, 1, [100, 600], [220, 600], 0, 1000)
    // #when it comes back by half the full-nudge distance
    drag(controls, 1, [220, 600], [196, 600], t, 400)
    // #then the nudge follows straight away instead of waiting for the overshoot
    expect(sink.nudge).toBe(NUDGE_LIMIT / 2)
  })

  it('keeps the held nudge through a lane flick in the same touch', () => {
    // #given a finger holding a nudge to the right
    const { sink, controls } = setup(48)
    controls.pointerDown(1, 200, 600, 0)
    const t = drag(controls, 1, [200, 600], [218, 600], 0, 400)
    const held = sink.nudge
    // #when it flicks right from there and pauses
    drag(controls, 1, [218, 600], [268, 600], t + 50, 64)
    // #then the shift fires and the nudge is the one held before the flick
    expect(sink.shifts).toEqual([1])
    expect(sink.nudge).toBe(held)
  })

  it('suits a 390px phone', () => {
    // #given a 390px wide screen
    // #when the full nudge distance is chosen
    const span = nudgeSpanForWidth(390)
    // #then a thumb reaches a full nudge in a short drag
    expect(span).toBeGreaterThan(40)
    expect(span).toBeLessThan(60)
  })

  it('ignores a second finger while one is captured', () => {
    // #given one captured finger
    const { sink, controls } = setup()
    controls.pointerDown(1, 100, 600, 0)
    // #when a second finger lands and flicks
    const captured = controls.pointerDown(2, 300, 600, 10)
    controls.pointerMove(2, 390, 600, 40)
    // #then it is refused and does nothing
    expect(captured).toBe(false)
    expect({ shifts: sink.shifts, nudges: sink.nudges }).toEqual({ shifts: [], nudges: [] })
  })
})

describe('RelayControls keyboard', () => {
  it('shifts a lane per tap of the arrows or A/D, ignoring auto-repeat', () => {
    // #given the controls
    const { sink, controls } = setup()
    // #when left, right, D and an auto-repeat of D are pressed
    const handled = controls.keyDown('ArrowLeft')
    controls.keyDown('ArrowRight')
    controls.keyDown('d')
    controls.keyDown('d', true)
    controls.keyDown('A')
    // #then each tap shifts once
    expect(handled).toBe(true)
    expect(sink.shifts).toEqual([-1, 1, 1, -1])
  })

  it('nudges while Shift and an arrow are held, and magnetizes on release', () => {
    // #given 20ms frames
    const { sink, controls } = setup()
    const frames = (ms: number) => {
      for (let t = 0; t < ms; t += 20) controls.update(20)
    }
    // #when Shift+Right is held long enough, then the arrow is released
    controls.keyDown('ArrowRight', false, true)
    frames(60)
    const partway = sink.nudge
    frames(200)
    const full = sink.nudge
    controls.keyUp('ArrowRight')
    frames(200)
    // #then the nudge ramps to full, never shifts, and returns to zero
    expect(partway).toBeGreaterThan(0)
    expect(partway).toBeLessThan(NUDGE_LIMIT)
    expect(full).toBe(NUDGE_LIMIT)
    expect(sink.nudge).toBe(0)
    expect(sink.shifts).toEqual([])
  })

  it('drops a held nudge when Shift is released', () => {
    // #given Shift+A held to a full left nudge
    const { sink, controls } = setup()
    controls.keyDown('A', false, true)
    controls.update(100)
    controls.update(100)
    // #when Shift is released while A stays down
    controls.keyUp('Shift')
    controls.update(100)
    controls.update(100)
    // #then the nudge returns to zero
    expect(sink.nudges).toContain(-NUDGE_LIMIT)
    expect(sink.nudge).toBe(0)
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

  it('releases held keys and fingers on reset', () => {
    // #given a held nudge key and a finger
    const { sink, controls } = setup()
    controls.keyDown('d', false, true)
    controls.update(200)
    // #when the controls reset (blur or pause) and frames continue
    controls.reset()
    controls.update(500)
    // #then the nudge is back at zero and stays there
    expect(sink.nudge).toBe(0)
    expect(controls.pointerActive).toBe(false)
  })
})
