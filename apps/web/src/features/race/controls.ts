import { relayLeg } from '@nim-relay/game-engine'

/**
 * Touch and keyboard controls for a relay leg.
 *
 * Lanes are the courier's language. A quick horizontal flick is one lane shift,
 * however far the finger travels; flick again (or reverse) for another lane.
 * Pressing and dragging sideways nudges within the lane relative to where the
 * finger touched down, and lifting the finger lets the courier magnetize back
 * to the lane centre. Flicking up jumps and flicking down slides; a vertical
 * flick never shifts lanes, and no flick leaves a nudge jerk behind.
 */

export interface ControlSink {
  /** One lane shift impulse. */
  shift(direction: -1 | 1): void
  /** Held fine offset inside the lane, -NUDGE_LIMIT..NUDGE_LIMIT; 0 magnetizes to the lane centre. */
  setNudge(nudge: number): void
  jump(): void
  slide(): void
  pause(): void
}

export interface ControlOptions {
  /** Horizontal drag in CSS pixels from touch-down to a full nudge. */
  fullNudgePx?: number
}

export const NUDGE_LIMIT = relayLeg.NUDGE_RANGE
/** Shortest travel inside the flick window that counts as a flick, per axis. */
export const SHIFT_FLICK_PX = 30
export const ACTION_FLICK_PX = 40
export const FLICK_WINDOW_MS = 140
/** A flick's axis must dominate the other by this factor. */
const DOMINANCE = 1.3
/** Finger speed (px/ms) above which movement is treated as a possible flick and does not nudge. */
const FAST_PX_PER_MS = 0.32
const HOLD_WINDOW_MS = 60
const MIN_STEP_MS = 8
/** A gap between pointer events this long means the finger rested in between. */
const REST_MS = 40
/** A stroke that already flicked stays latched until the finger slows below this speed, reverses or lifts. */
const RELEASE_PX_PER_MS = 0.12
/** Held Shift + arrow reaches a full nudge in this long. */
const KEY_NUDGE_FULL_MS = 120
const HISTORY = 32

type Axis = 'x' | 'y'
type Latch = { axis: Axis; direction: -1 | 1 } | null

/** Full nudge drag for a screen width: ~50px on a 390px phone. */
export function nudgeSpanForWidth(widthPx: number): number {
  return Math.max(36, Math.min(80, widthPx * 0.13))
}

interface PointerSample {
  t: number
  x: number
  y: number
  nudge: number
}

/** Finger speed from `previous` to (x, y) at `timeMs`, px/ms. Coalesced events count as a short step, not an instant one. */
function stepSpeed(previous: PointerSample, x: number, y: number, timeMs: number): number {
  return Math.hypot(x - previous.x, y - previous.y) / Math.max(MIN_STEP_MS, timeMs - previous.t)
}

function clampNudge(value: number): number {
  return Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, value))
}

export class RelayControls {
  private nudge = 0
  private sent = 0
  private pointerId: number | null = null
  private anchorX = 0
  private latch: Latch = null
  private readonly history: PointerSample[] = Array.from({ length: HISTORY }, () => ({ t: 0, x: 0, y: 0, nudge: 0 }))
  private historyStart = 0
  private historyLength = 0
  private readonly held = new Set<'left' | 'right'>()
  private unitsPerPx: number

  constructor(
    private readonly sink: ControlSink,
    options: ControlOptions = {},
  ) {
    this.unitsPerPx = NUDGE_LIMIT / (options.fullNudgePx ?? 50)
  }

  get nudgeTarget(): number {
    return this.sent
  }

  get pointerActive(): boolean {
    return this.pointerId !== null
  }

  setFullNudge(px: number): void {
    if (Number.isFinite(px) && px > 0) this.unitsPerPx = NUDGE_LIMIT / px
  }

  /** Returns true when this pointer was captured. */
  pointerDown(id: number, x: number, y: number, timeMs: number): boolean {
    if (this.pointerId !== null) return false
    this.pointerId = id
    this.anchorX = x - this.nudge / this.unitsPerPx
    this.latch = null
    this.historyLength = 0
    this.record(timeMs, x, y)
    return true
  }

  pointerMove(id: number, x: number, y: number, timeMs: number): void {
    if (id !== this.pointerId) return
    this.record(timeMs, x, y)
    this.releaseLatch(timeMs)
    if (this.detectFlick(x, y, timeMs)) return

    const previous = this.sampleBack(1)
    if (stepSpeed(previous, x, y, timeMs) > FAST_PX_PER_MS || this.latch !== null) {
      // A possible flick, or the tail of one: the nudge holds and the anchor travels with the finger.
      this.anchorX += x - previous.x
      return
    }

    let offset = (x - this.anchorX) * this.unitsPerPx
    if (offset > NUDGE_LIMIT) {
      this.anchorX = x - NUDGE_LIMIT / this.unitsPerPx
      offset = NUDGE_LIMIT
    } else if (offset < -NUDGE_LIMIT) {
      this.anchorX = x + NUDGE_LIMIT / this.unitsPerPx
      offset = -NUDGE_LIMIT
    }
    this.applyNudge(offset)
  }

  pointerUp(id: number, x: number, y: number, timeMs: number): void {
    if (id !== this.pointerId) return
    this.record(timeMs, x, y)
    this.detectFlick(x, y, timeMs)
    this.release()
  }

  /** Pointer cancelled or capture lost: release without treating it as a flick. */
  pointerCancel(id: number): void {
    if (id !== this.pointerId) return
    this.release()
  }

  /**
   * Returns true when the key is a race control and the browser default should be suppressed.
   * `shiftKey` turns the arrows (or A/D) into a held nudge instead of a lane shift.
   */
  keyDown(key: string, repeat = false, shiftKey = false): boolean {
    const direction = keyDirection(key)
    if (direction) {
      if (shiftKey) this.held.add(direction)
      else if (!repeat) this.sink.shift(direction === 'left' ? -1 : 1)
      return true
    }
    const normalized = key.length === 1 ? key.toLowerCase() : key
    if (normalized === 'ArrowUp' || normalized === 'w' || normalized === ' ') {
      if (!repeat) this.sink.jump()
      return true
    }
    if (normalized === 'ArrowDown' || normalized === 's') {
      if (!repeat) this.sink.slide()
      return true
    }
    if (normalized === 'Escape') {
      this.reset()
      this.sink.pause()
      return true
    }
    return false
  }

  keyUp(key: string): void {
    const direction = keyDirection(key)
    if (direction) this.held.delete(direction)
    if (key === 'Shift') this.held.clear()
  }

  /** Advances the held-key nudge. Call once per animation frame. */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || this.pointerId !== null) return
    const target = ((this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0)) * NUDGE_LIMIT
    if (target === this.nudge) return
    const step = (NUDGE_LIMIT / KEY_NUDGE_FULL_MS) * Math.min(dtMs, 100)
    this.applyNudge(this.nudge + Math.max(-step, Math.min(step, target - this.nudge)))
  }

  /** Releases fingers and keys (blur, pause); the courier magnetizes back to its lane centre. */
  reset(): void {
    this.held.clear()
    this.release()
  }

  private release(): void {
    this.pointerId = null
    this.historyLength = 0
    this.latch = null
    this.applyNudge(0)
  }

  /**
   * A stroke that already flicked may flick again only after slowing, reversing or lifting. The next
   * flick is measured from the release, so a quick zig-zag reads as two flicks.
   */
  private releaseLatch(timeMs: number): void {
    const latch = this.latch
    if (!latch) return
    const recent = this.sampleAt(timeMs - HOLD_WINDOW_MS)
    const latest = this.sampleBack(0)
    const travel = latch.axis === 'x' ? latest.x - recent.x : latest.y - recent.y
    const dt = Math.max(1, latest.t - recent.t)
    if (travel * latch.direction > 0 && Math.abs(travel) / dt >= RELEASE_PX_PER_MS) return
    this.latch = null
    this.historyLength = 0
    this.record(latest.t, latest.x, latest.y)
  }

  private detectFlick(x: number, y: number, timeMs: number): boolean {
    const start = this.sampleAt(timeMs - FLICK_WINDOW_MS)
    const dx = x - start.x
    const dy = y - start.y
    let axis: Axis
    if (Math.abs(dx) >= SHIFT_FLICK_PX && Math.abs(dx) >= Math.abs(dy) * DOMINANCE) axis = 'x'
    else if (Math.abs(dy) >= ACTION_FLICK_PX && Math.abs(dy) >= Math.abs(dx) * DOMINANCE) axis = 'y'
    else return false
    const direction: -1 | 1 = (axis === 'x' ? dx : dy) < 0 ? -1 : 1
    if (this.latch && this.latch.axis === axis && this.latch.direction === direction) return false

    const restored = this.nudgeBeforeFastRun()
    this.latch = { axis, direction }
    this.anchorX = x - restored / this.unitsPerPx
    this.applyNudge(restored)
    if (axis === 'x') this.sink.shift(direction)
    else if (direction < 0) this.sink.jump()
    else this.sink.slide()
    this.historyLength = 0
    this.record(timeMs, x, y)
    return true
  }

  private applyNudge(value: number): void {
    this.nudge = clampNudge(value)
    const rounded = Math.round(this.nudge)
    if (rounded !== this.sent) {
      this.sent = rounded
      this.sink.setNudge(rounded)
    }
  }

  private record(t: number, x: number, y: number): void {
    const index = (this.historyStart + this.historyLength) % HISTORY
    const sample = this.history[index]!
    sample.t = t
    sample.x = x
    sample.y = y
    sample.nudge = this.nudge
    if (this.historyLength < HISTORY) this.historyLength++
    else this.historyStart = (this.historyStart + 1) % HISTORY
  }

  /**
   * The nudge from just before the finger started moving fast. Each sample stores the nudge as it
   * was before that sample's movement applied, so the run's first sample holds the value to restore.
   * The first event after the finger rested spans the rest too and reads slow, so it joins the run.
   */
  private nudgeBeforeFastRun(): number {
    let runStart = this.historyLength - 1
    for (let i = this.historyLength - 1; i > 0; i--) {
      const current = this.history[(this.historyStart + i) % HISTORY]!
      const previous = this.history[(this.historyStart + i - 1) % HISTORY]!
      const fromRest = current.t - previous.t >= REST_MS
      if (stepSpeed(previous, current.x, current.y, current.t) <= FAST_PX_PER_MS && !fromRest) break
      runStart = i
      if (fromRest) break
    }
    return this.history[(this.historyStart + Math.max(0, runStart)) % HISTORY]!.nudge
  }

  /** Latest-but-`back` sample. */
  private sampleBack(back: number): PointerSample {
    const offset = Math.max(0, this.historyLength - 1 - back)
    return this.history[(this.historyStart + offset) % HISTORY]!
  }

  /** Oldest recorded sample at or after `timeMs`, i.e. the start of a window ending now. */
  private sampleAt(timeMs: number): PointerSample {
    for (let i = 0; i < this.historyLength; i++) {
      const sample = this.history[(this.historyStart + i) % HISTORY]!
      if (sample.t >= timeMs) return sample
    }
    return this.sampleBack(0)
  }
}

function keyDirection(key: string): 'left' | 'right' | null {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left'
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right'
  return null
}
