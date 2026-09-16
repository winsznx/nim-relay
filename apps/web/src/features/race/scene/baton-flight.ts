import * as THREE from 'three'
import type { BatonAppearance } from '../../baton/baton-appearance'
import { createBatonObject, type BatonObject } from '../../baton/baton-mesh'
import { Trail } from './effects'

/**
 * A baton in flight: arriving from the previous runner during the opening, or
 * leaving the launch platform in the handoff ceremony. It follows a quadratic
 * arc to a moving target and draws a comet trail.
 */

export class BatonFlight {
  readonly object: THREE.Group
  private readonly baton: BatonObject
  readonly trail: Trail
  private readonly from = new THREE.Vector3()
  private readonly control = new THREE.Vector3()
  private readonly position = new THREE.Vector3()
  private active = false

  constructor(appearance: BatonAppearance, trailColor: THREE.Color) {
    this.baton = createBatonObject(appearance, { length: 0.7 })
    this.object = new THREE.Group()
    this.object.name = 'baton-flight'
    this.object.add(this.baton.object)
    this.object.visible = false
    this.trail = new Trail(34, 0.55, trailColor, 26)
    this.trail.mesh.visible = false
  }

  get flying(): boolean {
    return this.active
  }

  get worldPosition(): THREE.Vector3 {
    return this.position
  }

  /** Begins a flight from `from`, bending through `lift` metres above the midpoint. */
  launch(from: THREE.Vector3, to: THREE.Vector3, lift: number): void {
    this.from.copy(from)
    this.control.copy(from).lerp(to, 0.5)
    this.control.y += lift
    this.position.copy(from)
    this.active = true
    this.object.visible = true
    this.trail.mesh.visible = true
    this.trail.reset()
  }

  /** Places the baton at progress `t` (0..1) toward `to`; returns false once landed. */
  update(t: number, to: THREE.Vector3, time: number, cameraPosition: THREE.Vector3): boolean {
    if (!this.active) return false
    const u = Math.max(0, Math.min(1, t))
    const a = (1 - u) * (1 - u)
    const b = 2 * (1 - u) * u
    const c = u * u
    this.position.set(
      a * this.from.x + b * this.control.x + c * to.x,
      a * this.from.y + b * this.control.y + c * to.y,
      a * this.from.z + b * this.control.z + c * to.z,
    )
    this.object.position.copy(this.position)
    this.object.rotation.set(time * 9, time * 4, 0)
    this.baton.update(time, 1)
    this.trail.update(this.position, cameraPosition, 1)
    if (u >= 1) {
      this.land()
      return false
    }
    return true
  }

  land(): void {
    this.active = false
    this.object.visible = false
    this.trail.mesh.visible = false
  }

  dispose(): void {
    this.object.removeFromParent()
    this.baton.dispose()
    this.trail.dispose()
  }
}
