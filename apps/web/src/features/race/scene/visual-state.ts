import { relayLeg } from '@nim-relay/game-engine'
import { fromQ, type Route } from './route'
import { RAIL_RIDE_LIFT, rampSurfaceHeight } from './track-features'

/**
 * Turns simulation states into smooth presentation values for one courier:
 * interpolated route position, visual lift over ramps and rails, lateral
 * velocity for banking, the lane change in progress, the locomotion phase with
 * its progress, and a short freeze on impact.
 */

export const HOVER_HEIGHT = 0.26
/** A jump in route position larger than this between ticks is a respawn (tether save), not motion. */
const RESPAWN_METRES = 6
/** Seconds drafting, which the engine raises on every tick it lasts, keeps reading as on after it was last seen. */
const DRAFT_HOLD_SECONDS = 0.12

export interface CourierView {
  dist: number
  lateral: number
  /** Height of the board above the deck, including hover, ramps and rails; below 0 while falling. */
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
  motion: relayLeg.Motion
  /** -1 left, 1 right, 0 none: the edge being ground or fallen from. */
  edgeSide: -1 | 0 | 1
  /** 0..1 through the current timed motion (grind window, fall, tether). */
  motionProgress: number
  /** -1..1: a lane change under way, signed toward the new lane, 0 once the lane is held. */
  laneShift: number
  /** 0..1 Relay Rush, fading out over its last half second. */
  rush: number
  /** 0..1 riding the shoulder outside the lanes. */
  shoulder: number
  /** 0..1 drafting the previous runner's ghostline. */
  drafting: number
}

export function createCourierView(): CourierView {
  return {
    dist: 0, lateral: 0, height: HOVER_HEIGHT, air: 0, lateralVelocity: 0, speed: 0, flow: 0, path: 'main', airborne: false, sliding: false,
    stumbling: false, railing: false, motion: 'riding', edgeSide: 0, motionProgress: 0, laneShift: 0, rush: 0, shoulder: 0, drafting: 0,
  }
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

export class CourierViewDriver {
  readonly view = createCourierView()
  private rampCarry = 0
  private railLift = 0
  private fallDip = 0
  private fallVelocity = 0
  private freezeMs = 0
  private motionLength = 0
  private lastMotion: relayLeg.Motion = 'riding'
  private draftSeen = Number.NEGATIVE_INFINITY
  private clock = 0

  constructor(private readonly route: Route) {}

  /** Starts a visual-only hold of the current pose; the simulation keeps running. */
  freeze(ms: number): void {
    this.freezeMs = Math.max(this.freezeMs, ms)
  }

  get frozen(): boolean {
    return this.freezeMs > 0
  }

  /** World lateral of a state: its offset from its own path's centre line, placed on that path. */
  private worldLateral(state: relayLeg.State, dist: number): number {
    return this.route.pathOffset(this.route.activePath(state.path, dist), dist) + fromQ(state.x)
  }

  update(previous: relayLeg.State, state: relayLeg.State, alpha: number, dt: number, events: number): void {
    this.clock += dt
    if (events & relayLeg.EVENT.DRAFTING) this.draftSeen = this.clock
    if (this.freezeMs > 0) {
      this.freezeMs -= dt * 1000
      return
    }
    const view = this.view
    const respawn = Math.abs(fromQ(state.dist - previous.dist)) > RESPAWN_METRES
    const t = respawn ? 1 : alpha
    const lerp = (a: number, b: number): number => a + (b - a) * t
    const dist = fromQ(lerp(previous.dist, state.dist))
    const lateral = lerp(this.worldLateral(previous, fromQ(previous.dist)), this.worldLateral(state, fromQ(state.dist)))
    const path = t < 0.5 ? previous.path : state.path
    const air = fromQ(lerp(previous.y, state.y))
    const falling = state.motion === 'falling' || state.motion === 'failed' || (state.motion === 'tethering' && state.y < 0)

    if (events & relayLeg.EVENT.HARD_LANDING) this.fallVelocity -= 9
    this.fallVelocity += (-80 * this.fallDip - 10 * this.fallVelocity) * dt
    this.fallDip += this.fallVelocity * dt

    const surface = falling ? 0 : rampSurfaceHeight(this.route, dist, lateral, path)
    this.rampCarry = state.y > 0 ? Math.max(surface, this.rampCarry - dt * 1.4) : surface
    this.railLift += ((state.railing ? RAIL_RIDE_LIFT : 0) - this.railLift) * (1 - Math.exp(-18 * dt))

    const velocity = dt > 0 && !respawn ? (lateral - view.lateral) / dt : 0
    view.lateralVelocity += (Math.max(-14, Math.min(14, velocity)) - view.lateralVelocity) * (1 - Math.exp(-10 * dt))
    view.dist = dist
    view.lateral = lateral
    view.air = air
    view.height = falling ? HOVER_HEIGHT + air : HOVER_HEIGHT + Math.max(air + surface, this.rampCarry) + this.railLift + Math.min(0, this.fallDip)
    view.speed = fromQ(state.speed) * relayLeg.TICK_RATE
    view.flow = fromQ(lerp(previous.flow, state.flow))
    view.path = path
    view.airborne = state.y > 0 || (state.vy !== 0 && !falling)
    view.sliding = state.slideTicks > 0
    view.stumbling = state.stumbleTicks > 0
    view.railing = state.railing === 1

    if (state.motion !== this.lastMotion) {
      this.lastMotion = state.motion
      this.motionLength = Math.max(1, state.motionTicks)
    }
    view.motion = state.motion
    view.edgeSide = state.edgeSide
    view.motionProgress = this.motionLength > 0 ? Math.max(0, Math.min(1, 1 - state.motionTicks / this.motionLength)) : 0
    view.laneShift = damp(view.laneShift, this.laneShiftOf(state, dist), 14, dt)
    view.rush = damp(view.rush, state.rushTicks > 0 ? Math.min(1, state.rushTicks / 30) : 0, 6, dt)
    const shoulder = state.motion === 'riding' && Math.abs(fromQ(state.x)) > this.route.laneSpan(this.route.activePath(state.path, dist), dist)
    view.shoulder = damp(view.shoulder, shoulder ? 1 : 0, 8, dt)
    view.drafting = damp(view.drafting, this.clock - this.draftSeen < DRAFT_HOLD_SECONDS ? 1 : 0, 5, dt)
  }

  /** How much of a lane change is left, signed toward the target lane. */
  private laneShiftOf(state: relayLeg.State, dist: number): number {
    if (state.lane === state.targetLane || state.motion !== 'riding') return 0
    const path = this.route.activePath(state.path, dist)
    const from = this.route.slotLateral(path, state.lane, dist) - this.route.pathOffset(path, dist)
    const to = this.route.slotLateral(path, state.targetLane, dist) - this.route.pathOffset(path, dist)
    const span = to - from
    if (Math.abs(span) < 1e-3) return 0
    const remaining = Math.max(0, Math.min(1, 1 - (fromQ(state.x) - from) / span))
    return Math.sign(span) * remaining
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
    view.motion = 'finished'
    view.laneShift = damp(view.laneShift, 0, 10, dt)
    view.rush = damp(view.rush, 0, 3, dt)
    view.shoulder = 0
    view.drafting = damp(view.drafting, 0, 4, dt)
  }
}
