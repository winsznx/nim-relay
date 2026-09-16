/**
 * Touch and keyboard controls for a relay leg.
 *
 * Steering is a lateral target on the track (-64..64). One captured finger drags
 * relative to where it touched down, so picking the thumb up and putting it
 * back never snaps the courier. A fast vertical flick jumps or slides, and a
 * flick never leaves a steering jerk behind: steering is held while the finger
 * moves mostly vertically, and restored to its pre-flick value on detection.
 */

export interface ControlSink {
  setSteer(target: number): void
  jump(): void
  slide(): void
  pause(): void
}

export interface ControlOptions {
  /** Horizontal drag in CSS pixels from centre to full lock. */
  fullLockPx?: number
}

export const STEER_LIMIT = 64
export const FLICK_DISTANCE_PX = 40
export const FLICK_WINDOW_MS = 180
const FLICK_COOLDOWN_MS = 220
const VERTICAL_DOMINANCE = 1.3
const VERTICAL_HOLD_SPEED = 0.3
const HOLD_WINDOW_MS = 60
/** Full sweep of the track in half a second while a steer key is held. */
const KEY_STEER_PER_MS = (STEER_LIMIT * 2) / 500
const HISTORY = 16

/** Sensible full-lock drag for a screen width: ~90px on a 390px phone. */
export function fullLockForWidth(widthPx: number): number {
  return Math.max(70, Math.min(140, widthPx * 0.23))
}

interface PointerSample {
  t: number
  x: number
  y: number
  steer: number
}

function clampSteer(value: number): number {
  return Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, value))
}

export class RelayControls {
  private steer = 0
  private sent = 0
  private pointerId: number | null = null
  private anchorX = 0
  private lastFlickAt = Number.NEGATIVE_INFINITY
  private readonly history: PointerSample[] = Array.from({ length: HISTORY }, () => ({ t: 0, x: 0, y: 0, steer: 0 }))
  private historyStart = 0
  private historyLength = 0
  private readonly held = new Set<'left' | 'right'>()
  private stepsPerPx: number

  constructor(
    private readonly sink: ControlSink,
    options: ControlOptions = {},
  ) {
    this.stepsPerPx = STEER_LIMIT / (options.fullLockPx ?? 90)
  }

  get steerTarget(): number {
    return this.sent
  }

  get pointerActive(): boolean {
    return this.pointerId !== null
  }

  setFullLock(px: number): void {
    if (Number.isFinite(px) && px > 0) this.stepsPerPx = STEER_LIMIT / px
  }

  /** Returns true when this pointer was captured for steering. */
  pointerDown(id: number, x: number, y: number, timeMs: number): boolean {
    if (this.pointerId !== null) return false
    this.pointerId = id
    this.anchorX = x - this.steer / this.stepsPerPx
    this.historyLength = 0
    this.record(timeMs, x, y)
    return true
  }

  pointerMove(id: number, x: number, y: number, timeMs: number): void {
    if (id !== this.pointerId) return
    this.record(timeMs, x, y)
    if (this.detectFlick(x, y, timeMs)) return

    const recent = this.sampleAt(timeMs - HOLD_WINDOW_MS)
    const previous = this.sampleBack(1)
    const dt = Math.max(1, timeMs - recent.t)
    const dy = y - recent.y
    const dx = x - recent.x
    if (Math.abs(dy) / dt > VERTICAL_HOLD_SPEED && Math.abs(dy) > Math.abs(dx) * VERTICAL_DOMINANCE) {
      this.anchorX += x - previous.x
      return
    }

    let offset = (x - this.anchorX) * this.stepsPerPx
    if (offset > STEER_LIMIT) {
      this.anchorX = x - STEER_LIMIT / this.stepsPerPx
      offset = STEER_LIMIT
    } else if (offset < -STEER_LIMIT) {
      this.anchorX = x + STEER_LIMIT / this.stepsPerPx
      offset = -STEER_LIMIT
    }
    this.applySteer(offset)
  }

  pointerUp(id: number, x: number, y: number, timeMs: number): void {
    if (id !== this.pointerId) return
    this.record(timeMs, x, y)
    this.detectFlick(x, y, timeMs)
    this.pointerId = null
    this.historyLength = 0
  }

  /** Pointer cancelled or capture lost: release without treating it as a flick. */
  pointerCancel(id: number): void {
    if (id !== this.pointerId) return
    this.pointerId = null
    this.historyLength = 0
  }

  /** Returns true when the key is a race control and the browser default should be suppressed. */
  keyDown(key: string, repeat = false): boolean {
    const direction = keyDirection(key)
    if (direction) {
      this.held.add(direction)
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
  }

  /** Advances held-key steering. Call once per animation frame. */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return
    const direction = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0)
    if (direction === 0) return
    this.applySteer(this.steer + direction * KEY_STEER_PER_MS * Math.min(dtMs, 100))
    if (this.pointerId !== null) {
      const latest = this.sampleBack(0)
      this.anchorX = latest.x - this.steer / this.stepsPerPx
    }
  }

  /** Releases fingers and keys (blur, pause). The steer target stays where it is. */
  reset(): void {
    this.pointerId = null
    this.historyLength = 0
    this.held.clear()
  }

  private detectFlick(x: number, y: number, timeMs: number): boolean {
    if (timeMs - this.lastFlickAt < FLICK_COOLDOWN_MS) return false
    const start = this.sampleAt(timeMs - FLICK_WINDOW_MS)
    const dy = y - start.y
    const dx = x - start.x
    if (Math.abs(dy) < FLICK_DISTANCE_PX || Math.abs(dy) < Math.abs(dx) * VERTICAL_DOMINANCE) return false
    const restored = this.steerBeforeVerticalRun()
    this.lastFlickAt = timeMs
    this.anchorX = x - restored / this.stepsPerPx
    this.applySteer(restored)
    if (dy < 0) this.sink.jump()
    else this.sink.slide()
    this.historyLength = 0
    this.record(timeMs, x, y)
    return true
  }

  private applySteer(value: number): void {
    this.steer = clampSteer(value)
    const rounded = Math.round(this.steer)
    if (rounded !== this.sent) {
      this.sent = rounded
      this.sink.setSteer(rounded)
    }
  }

  private record(t: number, x: number, y: number): void {
    const index = (this.historyStart + this.historyLength) % HISTORY
    const sample = this.history[index]!
    sample.t = t
    sample.x = x
    sample.y = y
    sample.steer = this.steer
    if (this.historyLength < HISTORY) this.historyLength++
    else this.historyStart = (this.historyStart + 1) % HISTORY
  }

  /**
   * Steer target from just before the finger started moving vertically. Each
   * sample stores the target as it was before that sample's movement applied.
   */
  private steerBeforeVerticalRun(): number {
    let runStart = this.historyLength - 1
    for (let i = this.historyLength - 1; i > 0; i--) {
      const current = this.history[(this.historyStart + i) % HISTORY]!
      const previous = this.history[(this.historyStart + i - 1) % HISTORY]!
      const dy = Math.abs(current.y - previous.y)
      if (dy === 0 || dy < Math.abs(current.x - previous.x) * VERTICAL_DOMINANCE) break
      runStart = i
    }
    return this.history[(this.historyStart + Math.max(0, runStart)) % HISTORY]!.steer
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
