import { relayLeg } from '@nim-relay/game-engine'
import { fromQ, type Route } from './route'
import { RAIL_RIDE_LIFT, rampSurfaceHeight } from './track-features'

/**
 * Turns simulation states into smooth presentation values for one courier:
 * interpolated route position, visual lift over ramps and rails, lateral
 * velocity for banking, and a short freeze on impact.
 */

export const HOVER_HEIGHT = 0.26

export interface CourierView {
  dist: number
  lateral: number
  /** Height of the board above the deck, including hover, ramps and rails. */
  height: number
  /** Simulation height above ground, metres. */
  air: number
  lateralVelocity: number
  speed: number
  flow: number
  path: relayLeg.Path
  airborne: boolean
  sliding: boolean
  stumbling: boolean
  railing: boolean
}

export function createCourierView(): CourierView {
  return { dist: 0, lateral: 0, height: HOVER_HEIGHT, air: 0, lateralVelocity: 0, speed: 0, flow: 0, path: 'main', airborne: false, sliding: false, stumbling: false, railing: false }
}

export class CourierViewDriver {
  readonly view = createCourierView()
  private rampCarry = 0
  private railLift = 0
  private fallDip = 0
  private fallVelocity = 0
  private freezeMs = 0

  constructor(private readonly route: Route) {}

  /** Starts a visual-only hold of the current pose; the simulation keeps running. */
  freeze(ms: number): void {
    this.freezeMs = Math.max(this.freezeMs, ms)
  }

  get frozen(): boolean {
    return this.freezeMs > 0
  }

  update(previous: relayLeg.State, state: relayLeg.State, alpha: number, dt: number, events: number): void {
    if (this.freezeMs > 0) {
      this.freezeMs -= dt * 1000
      return
    }
    const view = this.view
    const lerp = (a: number, b: number): number => a + (b - a) * alpha
    const dist = fromQ(lerp(previous.dist, state.dist))
    const x = fromQ(lerp(previous.x, state.x))
    const path = alpha < 0.5 ? previous.path : state.path
    const lateral = this.route.pathOffset(path, dist) + x
    const air = fromQ(lerp(previous.y, state.y))

    if (events & relayLeg.EVENT.FALL) this.fallVelocity -= 9
    this.fallVelocity += (-80 * this.fallDip - 10 * this.fallVelocity) * dt
    this.fallDip += this.fallVelocity * dt

    const surface = rampSurfaceHeight(this.route, dist, lateral, path)
    this.rampCarry = state.y > 0 ? Math.max(surface, this.rampCarry - dt * 1.4) : surface
    this.railLift += ((state.railing ? RAIL_RIDE_LIFT : 0) - this.railLift) * (1 - Math.exp(-18 * dt))

    const velocity = dt > 0 ? (lateral - view.lateral) / dt : 0
    view.lateralVelocity += (Math.max(-14, Math.min(14, velocity)) - view.lateralVelocity) * (1 - Math.exp(-10 * dt))
    view.dist = dist
    view.lateral = lateral
    view.air = air
    view.height = HOVER_HEIGHT + Math.max(air + surface, this.rampCarry) + this.railLift + Math.min(0, this.fallDip)
    view.speed = fromQ(state.speed) * relayLeg.TICK_RATE
    view.flow = fromQ(lerp(previous.flow, state.flow))
    view.path = path
    view.airborne = state.y > 0 || state.vy !== 0
    view.sliding = state.slideTicks > 0
    view.stumbling = state.stumbleTicks > 0
    view.railing = state.railing === 1
  }

  /** Drives the view directly (opening and finish glide), with the same smoothing. */
  place(dist: number, lateral: number, dt: number, speed: number): void {
    const view = this.view
    const velocity = dt > 0 ? (lateral - view.lateral) / dt : 0
    view.lateralVelocity += (Math.max(-8, Math.min(8, velocity)) - view.lateralVelocity) * (1 - Math.exp(-6 * dt))
    view.dist = dist
    view.lateral = lateral
    view.air = 0
    view.height = HOVER_HEIGHT
    view.speed = speed
    view.airborne = false
    view.sliding = false
    view.stumbling = false
    view.railing = false
  }
}
