import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { createRouteFrame, type Route } from './route'

/**
 * The race camera. A chase rig that trails lane changes with a controlled lag,
 * leans into steering, widens with FLOW and gets restless at high FLOW, plus
 * authored shots for the arrival, the catch, the finish and the handoff
 * ceremony. Mid-race it reads the courier's motion: grinding an edge it tilts
 * toward the drop, over the edge it holds at the lip and looks down after the
 * courier, and it follows the tether back up. A relay cut in flight swings to a
 * brief side angle on the arc while input stays live. Shots blend into each
 * other; juice (landing compression, impact kicks, the Rush punch) layers on
 * top of whatever shot is active.
 */

export type CameraShot = 'arrival-relay' | 'arrival-short' | 'catch' | 'chase' | 'finish' | 'failed' | 'armed' | 'frozen' | 'launch' | 'departed'

export interface CameraInput {
  dt: number
  time: number
  shot: CameraShot
  /** 0..1 progress through timed shots (arrival, catch, launch, departed). */
  shotProgress: number
  /** Visual route distance and lateral position (from the main centre line) of the courier. */
  dist: number
  lateral: number
  /** Centre line of the path the courier is on, so the chase rig follows that path through the fork. */
  pathCentre: number
  /** Board height above the deck in metres, including hover, ramps, rails and jumps. */
  height: number
  /** Metres per second. */
  speed: number
  /** Lateral velocity in m/s. */
  lateralVelocity: number
  flow: number
  /** World position the launch shot follows. */
  focus: THREE.Vector3
  /** The ghost's world position while it races close by on the same path, so the chase can keep it in frame. */
  companion: THREE.Vector3 | null
  motion: relayLeg.Motion
  /** -1 left, 1 right, 0 none: the edge being ground or fallen from. */
  edgeSide: -1 | 0 | 1
  /** Lateral position of the road edge on `edgeSide` from the main centre line, metres. */
  edgeLateral: number
  /** 0..1 Relay Rush. */
  rush: number
  /** 0..1 a relay cut in flight. */
  cut: number
  /** Side the cut's path peels off toward. */
  cutSide: -1 | 1
}

interface Pose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
  roll: number
}

function createPose(): Pose {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 62, roll: 0 }
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

/** Chase framing: the courier's torso sits this far below the screen centre, as a share of the half height (62% from the top). */
const COURIER_SCREEN_DROP = 0.24
/**
 * Ceremony framing: where the courier and the hovering baton sit, as a share of the half height above the centre.
 * The handoff sheet covers the bottom of a phone screen and the results header the top, so they sit in the band between.
 */
const CEREMONY_SUBJECT_Y = 0.27
/** Board to torso centre of the crouched courier. */
const COURIER_CENTRE = 0.75
const HOVER_HEIGHT = 0.26
const CHASE_DISTANCE = 5.5
const CHASE_HEIGHT = 2.3
/** Share of a jump's height the camera climbs; the aim follows the rest so the courier never leaves frame. */
const CHASE_LIFT = 0.5
/** Share of the aim that looks at the road ahead instead of the courier, for bends. */
const ROAD_AIM = 0.15
/** Largest yaw the chase borrows to keep a nearby ghost in frame. */
const COMPANION_YAW = 0.05

/** Catmull-Rom through route-space keys [dist, lateral, height]. */
function spline(keys: readonly (readonly [number, number, number])[], t: number, out: THREE.Vector3): THREE.Vector3 {
  const segments = keys.length - 1
  const scaled = Math.max(0, Math.min(0.9999, t)) * segments
  const i = Math.floor(scaled)
  const local = scaled - i
  const p0 = keys[Math.max(0, i - 1)]!
  const p1 = keys[i]!
  const p2 = keys[Math.min(segments, i + 1)]!
  const p3 = keys[Math.min(segments, i + 2)]!
  const component = (k: 0 | 1 | 2): number => {
    const a = p1[k]
    const b = p2[k]
    const m1 = (p2[k] - p0[k]) * 0.5
    const m2 = (p3[k] - p1[k]) * 0.5
    const t2 = local * local
    const t3 = t2 * local
    return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + local) * m1 + (-2 * t3 + 3 * t2) * b + (t3 - t2) * m2
  }
  return out.set(component(0), component(1), component(2))
}

/**
 * Opening flight paths in route space [dist, lateral, height] relative to the
 * courier. Portrait screens have a narrow horizontal field of view, so close
 * keys stay within a metre or two of the courier's line and never cross it.
 */
const RELAY_ARRIVAL_POSITION = [
  [-70, -30, 46],
  [-20, 20, 20],
  [14, 7, 5.5],
  [6.5, 3.2, 2.4],
  [-1.5, 2.6, 2.1],
  [-4.8, 1.1, 2.0],
] as const
const RELAY_ARRIVAL_TARGET = [
  [140, 0, 0],
  [40, 0, 0],
  [0, 0, 1.1],
  [0, 0, 1.1],
  [1, 0, 1.0],
  [5, 0, 0.9],
] as const
const SHORT_ARRIVAL_POSITION = [
  [5.4, 0.9, 1.35],
  [3.4, 2.2, 1.7],
  [-1.4, 2.0, 2.0],
  [-4.8, 0.9, 2.1],
] as const
const SHORT_ARRIVAL_TARGET = [
  [0, 0, 1.0],
  [0, 0, 1.0],
  [2, 0, 1.0],
  [5, 0, 0.9],
] as const

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private readonly route: Route
  private readonly frame = createRouteFrame()
  private readonly desired = createPose()
  private readonly previous = createPose()
  private readonly scratch = new THREE.Vector3()
  private readonly routeKey = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly courierPoint = new THREE.Vector3()
  private readonly roadPoint = new THREE.Vector3()
  private shot: CameraShot = 'arrival-short'
  private blend = 1
  private followLateral = 0
  private followHeight = CHASE_HEIGHT
  private followDistance = CHASE_DISTANCE
  private followLift = 0
  private companionYaw = 0
  private lean = 0
  private dip = 0
  private dipVelocity = 0
  private shake = 0
  private kick = 0
  private orbit = 0
  private grind = 0
  private overEdge = 0
  private cinematic = 0
  private rushWiden = 0
  private jolt = 0
  private joltVelocity = 0
  private readonly lip = new THREE.Vector3()
  private readonly cinematicPosition = new THREE.Vector3()
  private readonly cinematicTarget = new THREE.Vector3()

  constructor(route: Route, aspect: number) {
    this.route = route
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 3200)
  }

  land(strength: number): void {
    this.dipVelocity -= 2.2 * strength
  }

  hit(): void {
    this.shake = 1
    this.joltVelocity += 3
  }

  boost(): void {
    this.kick = Math.min(1, this.kick + 0.5)
  }

  /** Relay Rush ignites: a hard FOV punch that settles into the wider Rush view. */
  rush(): void {
    this.kick = 1.6
    this.shake = Math.max(this.shake, 0.35)
  }

  /** Drops every in-flight blend so the chase frames the courier where it is now: a respawn is an edit, not a pan. */
  cut(): void {
    this.blend = 1
    this.overEdge = 0
    this.cinematic = 0
    this.grind = 0
    this.dip = 0
    this.dipVelocity = 0
    this.jolt = 0
    this.joltVelocity = 0
  }

  update(input: CameraInput): void {
    const { dt } = input
    if (input.shot !== this.shot) {
      this.previous.position.copy(this.camera.position)
      this.previous.target.copy(this.desired.target)
      this.previous.fov = this.camera.fov
      this.previous.roll = this.desired.roll
      this.shot = input.shot
      this.blend = input.shot === 'chase' && this.shotWasOpening() ? 0.35 : 0
    }
    this.blend = Math.min(1, this.blend + dt / (this.shot === 'chase' ? 0.55 : 0.9))

    this.composeShot(input)
    const weight = smooth(this.blend)
    const camera = this.camera
    camera.position.copy(this.previous.position).lerp(this.desired.position, weight)
    this.scratch.copy(this.previous.target).lerp(this.desired.target, weight)
    const fov = this.previous.fov + (this.desired.fov - this.previous.fov) * weight
    const roll = this.previous.roll + (this.desired.roll - this.previous.roll) * weight

    this.dipVelocity += (-60 * this.dip - 9 * this.dipVelocity) * dt
    this.dip += this.dipVelocity * dt
    this.joltVelocity += (-90 * this.jolt - 11 * this.joltVelocity) * dt
    this.jolt += this.joltVelocity * dt
    this.shake = Math.max(0, this.shake - dt * 3.2)
    this.kick = Math.max(0, this.kick - dt * 1.6)
    camera.position.y += this.dip * 0.4
    // An impact knocks the camera back along the route for a beat.
    if (Math.abs(this.jolt) > 1e-4) camera.position.addScaledVector(this.route.frame(input.dist, this.frame).forward, -this.jolt * 0.35)
    if (this.shake > 0) {
      const amount = this.shake * this.shake * 0.16
      camera.position.x += Math.sin(input.time * 71) * amount
      camera.position.y += Math.sin(input.time * 53 + 1.3) * amount
      this.scratch.x += Math.sin(input.time * 61 + 2.1) * amount * 0.6
    }
    if (this.shot === 'chase') {
      // High FLOW and Relay Rush make the rig restless: a fine, fast tremor that says speed.
      const energy = THREE.MathUtils.smoothstep(input.flow, 0.75, 1) * 0.008 + input.rush * 0.016
      camera.position.x += Math.sin(input.time * 37.3) * energy
      camera.position.y += Math.sin(input.time * 43.1 + 0.7) * energy
    }

    this.up.set(0, 1, 0)
    camera.up.copy(this.up)
    camera.lookAt(this.scratch)
    camera.rotateZ(roll)
    const nextFov = fov + this.kick * 5
    if (Math.abs(camera.fov - nextFov) > 0.01) {
      camera.fov = nextFov
      camera.updateProjectionMatrix()
    }
  }

  private shotWasOpening(): boolean {
    return this.previous.position.lengthSq() > 0
  }

  private routePoint(d: number, lateral: number, height: number, out: THREE.Vector3): THREE.Vector3 {
    return this.route.point(d, lateral, height, out)
  }

  private composeShot(input: CameraInput): void {
    const pose = this.desired
    const { dt, dist, lateral } = input
    switch (this.shot) {
      case 'arrival-relay':
      case 'arrival-short': {
        const positions = this.shot === 'arrival-relay' ? RELAY_ARRIVAL_POSITION : SHORT_ARRIVAL_POSITION
        const targets = this.shot === 'arrival-relay' ? RELAY_ARRIVAL_TARGET : SHORT_ARRIVAL_TARGET
        const t = this.shot === 'arrival-relay' ? easeInOutSoft(input.shotProgress) : smooth(input.shotProgress)
        spline(positions, t, this.routeKey)
        this.routePoint(dist + this.routeKey.x, lateral + this.routeKey.y, this.routeKey.z, pose.position)
        spline(targets, t, this.routeKey)
        this.routePoint(dist + this.routeKey.x, lateral + this.routeKey.y, this.routeKey.z, pose.target)
        pose.fov = this.shot === 'arrival-relay' ? 58 - 8 * (1 - t) : 54
        pose.roll = 0
        this.resetFollow(lateral)
        return
      }
      case 'catch': {
        const t = smooth(input.shotProgress)
        this.routePoint(dist - 4.2 - t * (CHASE_DISTANCE - 4.2), lateral + 1.0 - t * 0.9, 1.95 + t * (CHASE_HEIGHT - 1.95), pose.position)
        this.routePoint(dist + 5 + t * 5, lateral * 0.9, 0.95, pose.target)
        pose.fov = 56 + t * 4
        pose.roll = 0
        this.resetFollow(lateral)
        return
      }
      case 'chase': {
        const speedFactor = Math.max(0, Math.min(1, (input.speed - 26) / 24))
        const lift = Math.max(0, input.height - HOVER_HEIGHT)
        this.grind = damp(this.grind, input.motion === 'grinding' ? 1 : 0, 6, dt)
        this.overEdge = damp(this.overEdge, input.motion === 'falling' || input.motion === 'tethering' || input.motion === 'failed' ? 1 : 0, 5, dt)
        this.cinematic = damp(this.cinematic, input.cut, 4, dt)
        this.rushWiden = damp(this.rushWiden, input.rush, 3, dt)
        const side = input.edgeSide
        this.followDistance = damp(this.followDistance, CHASE_DISTANCE + speedFactor * 0.55 - this.grind * 0.6, 2.5, dt)
        // Lane changes: the camera trails the courier with a deliberate lag, and leans out over the drop on a grind.
        const followTarget = input.pathCentre + (lateral - input.pathCentre) * 0.9 + side * this.grind * 0.3
        this.followLateral = damp(this.followLateral, followTarget, 4.2, dt)
        this.followHeight = damp(this.followHeight, CHASE_HEIGHT + input.flow * 0.15 + this.grind * 0.25, 3, dt)
        this.followLift = damp(this.followLift, input.height > 0 ? lift * CHASE_LIFT : 0, 3.2, dt)
        this.lean = damp(this.lean, Math.max(-1, Math.min(1, input.lateralVelocity / 8)), 5, dt)
        this.routePoint(dist - this.followDistance, this.followLateral, this.followHeight + this.followLift, pose.position)
        pose.fov = 58 + input.flow * 7 + speedFactor * 3 + this.rushWiden * 7
        pose.roll = -this.lean * 0.04 * (1 - this.grind) + side * this.grind * 0.045
        this.aimAtCourier(input, pose)
        if (this.overEdge > 0.001) this.composeOverEdge(input, pose)
        if (this.cinematic > 0.001) this.composeCut(input, pose)
        return
      }
      case 'finish': {
        this.orbit += dt * 0.12
        const angle = 0.95 + Math.sin(this.orbit) * 0.22
        this.routePoint(dist + Math.cos(angle) * 7.2, lateral - Math.sin(angle) * 7.2, 1.25, pose.position)
        this.routePoint(dist + 0.6, lateral, 0.45, pose.target)
        pose.fov = 52
        pose.roll = 0
        return
      }
      case 'failed': {
        // Kneeling at the lip: a low three-quarter view from ahead, the drop behind the courier.
        this.orbit += dt * 0.1
        const side = input.edgeSide === 0 ? 1 : input.edgeSide
        this.routePoint(dist + 6.2, lateral - side * (3.6 + Math.sin(this.orbit) * 0.4), 1.5, pose.position)
        this.routePoint(dist - 0.4, lateral + side * 0.4, 0.55, pose.target)
        pose.fov = 54
        pose.roll = 0
        return
      }
      case 'armed': {
        // High behind the courier's left shoulder, far enough back that the courier and the baton raised over it
        // sit together between the results header and the handoff sheet.
        this.orbit += dt * 0.08
        this.routePoint(dist - 7.6, lateral - 3 + Math.sin(this.orbit) * 0.3, 3.4, pose.position)
        pose.fov = 54
        pose.roll = 0.02
        this.frameSubject(this.routePoint(dist + 0.3, lateral + 0.2, HOVER_HEIGHT + 1.1, this.courierPoint), CEREMONY_SUBJECT_Y, pose)
        return
      }
      case 'frozen': {
        // Time nearly stops and the camera eases in on the lifting baton, keeping it and the courier above the sheet.
        const t = smooth(input.shotProgress)
        this.routePoint(dist - 7.6 + t * 1.8, lateral - 3 + t * 0.6, 3.4 - t * 0.7, pose.position)
        pose.fov = 54 - t * 4
        pose.roll = 0.02
        this.frameSubject(this.courierPoint.copy(input.focus).setY(input.focus.y - 1), CEREMONY_SUBJECT_Y, pose)
        return
      }
      case 'launch': {
        const t = smooth(input.shotProgress)
        this.routePoint(dist - 5.8 - t * 1.6, lateral - 2.4 - t * 2.6, 2.7 + t * t * 25, pose.position)
        pose.fov = 54 + t * 16
        pose.roll = 0
        this.frameSubject(input.focus, CEREMONY_SUBJECT_Y * (1 - t), pose)
        return
      }
      case 'departed': {
        const t = smooth(input.shotProgress)
        this.routePoint(dist - 7 + t * 20, lateral - 5, 28 + t * 90, pose.position)
        this.scratch.copy(input.focus)
        pose.target.copy(this.scratch).setY(this.scratch.y + 30 + t * 80)
        pose.fov = 70
        pose.roll = 0
        return
      }
    }
  }

  /** Aims straight at `subject` horizontally and pitches so it lands at `screenY` (-1 bottom, 1 top) whatever the FOV. */
  private frameSubject(subject: THREE.Vector3, screenY: number, pose: Pose): void {
    const eye = pose.position
    const dx = subject.x - eye.x
    const dz = subject.z - eye.z
    const reach = Math.max(0.001, Math.hypot(dx, dz))
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2)
    const pitch = Math.atan2(subject.y - eye.y, reach) - Math.atan(screenY * tanHalf)
    const distance = Math.max(1, Math.hypot(reach, subject.y - eye.y))
    const flat = Math.cos(pitch) * distance
    pose.target.set(eye.x + (dx / reach) * flat, eye.y + Math.sin(pitch) * distance, eye.z + (dz / reach) * flat)
  }

  /**
   * Aims the chase so the courier's torso lands at a fixed point in the lower
   * middle of the frame whatever the camera's lag, borrowing a little yaw for
   * the road ahead on bends and for a ghost racing close by.
   */
  private aimAtCourier(input: CameraInput, pose: Pose): void {
    const eye = pose.position
    const courier = this.routePoint(input.dist, input.lateral, input.height + COURIER_CENTRE, this.courierPoint)
    const road = this.routePoint(input.dist + 14, input.pathCentre + (input.lateral - input.pathCentre) * 0.85, 0.8, this.roadPoint)
    const cx = courier.x - eye.x
    const cz = courier.z - eye.z
    const courierReach = Math.max(0.001, Math.hypot(cx, cz))
    const rx = road.x - eye.x
    const rz = road.z - eye.z
    const roadReach = Math.max(0.001, Math.hypot(rx, rz))
    let aimX = (cx / courierReach) * (1 - ROAD_AIM) + (rx / roadReach) * ROAD_AIM
    let aimZ = (cz / courierReach) * (1 - ROAD_AIM) + (rz / roadReach) * ROAD_AIM
    const aimLength = Math.max(0.001, Math.hypot(aimX, aimZ))
    aimX /= aimLength
    aimZ /= aimLength

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2)
    let companionYaw = 0
    if (input.companion) {
      const gx = input.companion.x - eye.x
      const gz = input.companion.z - eye.z
      const angle = Math.atan2(aimX * gz - aimZ * gx, aimX * gx + aimZ * gz)
      const halfWidth = Math.atan(tanHalf * this.camera.aspect)
      const excess = Math.abs(angle) - halfWidth * 0.78
      if (excess > 0 && Math.abs(angle) < halfWidth * 2.4) companionYaw = Math.sign(angle) * Math.min(COMPANION_YAW, excess)
    }
    this.companionYaw = damp(this.companionYaw, companionYaw, 2.5, input.dt)
    const cos = Math.cos(this.companionYaw)
    const sin = Math.sin(this.companionYaw)
    const yawX = aimX * cos - aimZ * sin
    const yawZ = aimX * sin + aimZ * cos

    const pitch = Math.atan2(courier.y - eye.y, courierReach) + Math.atan(COURIER_SCREEN_DROP * tanHalf)
    const reach = 20
    pose.target.set(eye.x + yawX * Math.cos(pitch) * reach, eye.y + Math.sin(pitch) * reach, eye.z + yawZ * Math.cos(pitch) * reach)
  }

  /**
   * Over the edge: the camera swings out over the drop just behind where the courier went over and looks down
   * after them, then follows them back up the tether. It hangs outside the edge line, so the deck never comes
   * between it and the courier. Blended over the chase by how far over the edge the courier is.
   */
  private composeOverEdge(input: CameraInput, pose: Pose): void {
    const side = input.edgeSide === 0 ? 1 : input.edgeSide
    this.routePoint(input.dist - 5.2, input.edgeLateral + side * 2.4, 3.2, this.lip)
    const weight = smooth(this.overEdge)
    pose.position.lerp(this.lip, weight)
    this.routePoint(input.dist, input.lateral, input.height + COURIER_CENTRE, this.courierPoint)
    pose.target.lerp(this.courierPoint, weight)
    pose.fov += (60 - pose.fov) * weight
    pose.roll += (side * 0.06 - pose.roll) * weight
  }

  /** A relay cut in flight: a low side angle ahead of the courier, looking back across the arc. */
  private composeCut(input: CameraInput, pose: Pose): void {
    this.routePoint(input.dist + 2, input.lateral - input.cutSide * 4.8, input.height * 0.5 + 1.6, this.cinematicPosition)
    this.routePoint(input.dist - 0.5, input.lateral, input.height + COURIER_CENTRE, this.cinematicTarget)
    const weight = smooth(this.cinematic)
    pose.position.lerp(this.cinematicPosition, weight)
    pose.target.lerp(this.cinematicTarget, weight)
    pose.fov += (54 - pose.fov) * weight
    pose.roll *= 1 - weight
  }

  private resetFollow(lateral: number): void {
    this.followLateral = lateral * 0.9
    this.followHeight = CHASE_HEIGHT
    this.followDistance = CHASE_DISTANCE
    this.followLift = 0
    this.companionYaw = 0
  }
}

function easeInOutSoft(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2
}
