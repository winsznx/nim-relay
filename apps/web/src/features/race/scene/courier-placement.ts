import * as THREE from 'three'
import type { Courier } from './courier'
import { createRouteFrame, type Route } from './route'
import type { CourierView } from './visual-state'

/**
 * Puts a courier in the world from its view: on its route position, turned into
 * the carve, tumbling about its chest while it falls, swinging under the tether
 * while it is hauled up, and cutting straight to a respawn instead of sweeping
 * through the route to get there.
 */

/** Tumbling turns about the chest, not the board. */
const PIVOT = new THREE.Vector3(0, 0.95, 0)
const RESPAWN_METRES = 6
const CARVE_YAW = 1.4

export class CourierPlacement {
  private readonly frame = createRouteFrame()
  private readonly yaw = new THREE.Quaternion()
  private readonly tumble = new THREE.Quaternion()
  private readonly desired = new THREE.Quaternion()
  private readonly euler = new THREE.Euler(0, 0, 0, 'ZXY')
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly pivotRest = new THREE.Vector3()
  private readonly pivotTurned = new THREE.Vector3()
  private roll = 0
  private pitch = 0
  private spin = 0
  private swingTime = 0
  private lastDist: number | null = null

  private snapPending = false

  constructor(private readonly route: Route) {}

  /** The next placement jumps straight to its pose, as a respawn does. */
  snap(): void {
    this.snapPending = true
  }

  place(target: Courier, view: CourierView, dt: number): void {
    const cut = this.snapPending || (this.lastDist !== null && Math.abs(view.dist - this.lastDist) > RESPAWN_METRES)
    this.snapPending = false
    this.lastDist = view.dist
    this.route.frame(view.dist, this.frame)
    this.route.point(view.dist, view.lateral, view.height, target.group.position)

    const carving = view.speed > 1 && view.motion === 'riding'
    this.yaw.setFromAxisAngle(this.up, carving ? -Math.atan2(view.lateralVelocity, view.speed) * CARVE_YAW : 0)
    this.advanceTumble(view, dt, cut)
    this.euler.set(this.pitch, 0, this.roll, 'ZXY')
    this.tumble.setFromEuler(this.euler)
    this.desired.copy(this.frame.quaternion).multiply(this.yaw).multiply(this.tumble)
    if (cut) target.group.quaternion.copy(this.desired)
    else target.group.quaternion.slerp(this.desired, 1 - Math.exp(-(view.motion === 'falling' ? 30 : 14) * dt))

    // Rotate about the chest: shift the group so the pivot stays where an upright courier's chest would be.
    this.pivotRest.copy(PIVOT).applyQuaternion(this.frame.quaternion)
    this.pivotTurned.copy(PIVOT).applyQuaternion(target.group.quaternion)
    target.group.position.add(this.pivotRest).sub(this.pivotTurned)
  }

  private advanceTumble(view: CourierView, dt: number, cut: boolean): void {
    if (cut) {
      this.roll = 0
      this.pitch = 0
      this.spin = 0
      return
    }
    const side = view.edgeSide === 0 ? 1 : view.edgeSide
    if (view.motion === 'falling' || view.motion === 'failed') {
      // Off the edge the body rolls away over the drop and pitches forward, faster the longer it falls.
      this.spin = Math.min(7.5, this.spin + dt * 9)
      this.roll += side * this.spin * dt
      this.pitch += this.spin * 0.45 * dt
      this.swingTime = 0
      return
    }
    this.spin = 0
    const settle = 1 - Math.exp(-7 * dt)
    this.roll = wrapAngle(this.roll) * (1 - settle)
    this.pitch = wrapAngle(this.pitch) * (1 - settle)
    if (view.motion === 'tethering') {
      // Hauled up on the tether: a pendulum swing that calms as the courier nears the deck.
      this.swingTime += dt
      const calm = 1 - view.motionProgress
      this.roll += Math.sin(this.swingTime * 3.4) * 0.3 * calm * settle * 6
    }
  }
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
