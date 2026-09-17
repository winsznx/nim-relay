import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import type { BatonAppearance } from '../../baton/baton-appearance'
import { createBatonObject, type BatonObject } from '../../baton/baton-mesh'
import { BatonTether } from '../../baton/baton-tether'
import type { Courier } from './courier'
import { Trail } from './effects'
import type { QualityTier } from './quality'
import type { Route } from './route'
import type { CourierView } from './visual-state'

/**
 * The baton as the thing being carried. Every frame it is bound to the courier
 * by a short strand of its own energy running to a mount between the shoulder
 * blades, throws warm light on the runner and the deck (high tier), and drags a
 * comet trail that lengthens with FLOW and blazes through Relay Rush and relay
 * cuts. When the courier goes over an open edge it is the baton that saves them:
 * a golden tether snaps out of it to the deck edge and hauls them back up. After
 * a finish it leaves the hand and hovers at the courier's shoulder, rising as the
 * handoff arms, until the launch takes it.
 */

export type HoverStage = 'none' | 'finish' | 'armed' | 'frozen'

export interface BatonPresenceFrame {
  time: number
  dt: number
  camera: THREE.PerspectiveCamera
  courier: Courier
  view: CourierView
  /** Events of the ticks stepped this frame. */
  events: number
  /** The race is on (not the opening, not after the finish). */
  racing: boolean
  /** 0..1 baton blazing: Relay Rush or a relay cut in flight. */
  blaze: number
  /** Where the carried baton should hover after the finish, or 'none' to keep it in hand. */
  hover: HoverStage
}

const GOLD_LIGHT = new THREE.Color(1, 0.62, 0.22)
const TRAIL_GOLD = new THREE.Color(2.4, 1.5, 0.45)
/** Shoulder-side hover spots in the courier's frame (-Z forward, +X right). */
const HOVER_FINISH = new THREE.Vector3(0.62, 1.55, -0.2)
const HOVER_ARMED = new THREE.Vector3(0.42, 1.95, -0.75)
const TETHER_SNAP_SECONDS = 0.16

export class BatonPresence {
  /** Where the baton is this frame: in the hand, or hovering. */
  readonly batonWorld = new THREE.Vector3()
  readonly trail: Trail
  private readonly mount = new BatonTether()
  private readonly save = new BatonTether(new THREE.Color(3.2, 2.1, 0.7))
  private readonly light: THREE.PointLight | null
  private readonly hoverBaton: BatonObject
  private readonly anchor = new THREE.Vector3()
  private readonly hoverTarget = new THREE.Vector3()
  private readonly local = new THREE.Vector3()
  private hovering = false
  private hoverBlend = 0
  private flicker = 0
  private tetherTime = -1
  private tier: QualityTier

  constructor(
    private readonly route: Route,
    scene: THREE.Scene,
    appearance: BatonAppearance,
    tier: QualityTier,
  ) {
    this.tier = tier
    this.trail = new Trail(16, 0.1, TRAIL_GOLD, 1.8)
    this.trail.mesh.visible = tier !== 'low'
    // Created only on high tier, and never removed: adding or removing a light recompiles every lit material.
    this.light = tier === 'high' ? new THREE.PointLight(GOLD_LIGHT, 0, 6, 2) : null
    this.hoverBaton = createBatonObject(appearance, { length: 0.62, glow: 0.8 })
    this.hoverBaton.object.visible = false
    scene.add(this.trail.mesh, this.mount.mesh, this.save.mesh, this.hoverBaton.object)
    if (this.light) scene.add(this.light)
  }

  /** True on the frame the baton leaves the courier's hand. */
  update(frame: BatonPresenceFrame): boolean {
    const { courier, view, dt, time, camera } = frame
    const knocked = (frame.events & (relayLeg.EVENT.HIT | relayLeg.EVENT.HARD_LANDING | relayLeg.EVENT.FALL)) !== 0
    if (knocked) this.flicker = 1
    this.flicker = Math.max(0, this.flicker - dt / 0.7)

    const separated = this.updateHover(frame)
    this.batonWorld.copy(this.hoverBlend > 0.001 ? this.hoverBaton.object.position : courier.batonWorld)
    if (courier.baton) courier.baton.object.visible = courier.baton.object.visible && !this.hovering

    const energy = Math.max(view.flow, frame.blaze)
    if (this.hovering) {
      this.mount.update(this.batonWorld, courier.batonWorld, { sag: 0.12, strength: 0.55 * this.hoverBlend, width: 0.03, time, cameraPosition: camera.position })
    } else if (courier.baton?.object.visible) {
      this.mount.update(courier.batonWorld, courier.holsterWorld, {
        sag: 0.08,
        strength: 0.45 + energy * 0.45 + frame.blaze * 0.5,
        width: 0.045 + frame.blaze * 0.025,
        flicker: this.flicker,
        time,
        cameraPosition: camera.position,
      })
    } else {
      this.mount.hide()
    }

    this.updateTether(frame)

    const trailStrength = frame.racing ? 0.25 + view.flow * 0.5 + frame.blaze * 0.6 : 0.15
    this.trail.maxLength = 1.4 + view.flow * 1.6 + frame.blaze * 1.8
    this.trail.width = 0.1 + frame.blaze * 0.06
    this.trail.update(this.batonWorld, camera.position, Math.min(1.4, trailStrength) * (1 - this.flicker * 0.5))

    if (this.light) {
      this.light.position.copy(this.batonWorld)
      const on = this.tier === 'high' && (courier.baton?.object.visible || this.hovering)
      const tether = this.save.mesh.visible ? 5 : 0
      this.light.intensity = on ? (1.2 + energy * 2 + frame.blaze * 2.5 + tether) * (1 - this.flicker * 0.7) : 0
      this.light.distance = 5 + frame.blaze * 2
    }
    return separated
  }

  /** A cut to a new place (a respawn, the failed kneel): trails start over instead of streaking across the gap. */
  cut(): void {
    this.trail.reset()
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier
    this.trail.mesh.visible = tier !== 'low'
  }

  dispose(): void {
    this.trail.dispose()
    this.mount.dispose()
    this.save.dispose()
    this.hoverBaton.dispose()
    this.light?.removeFromParent()
    this.light?.dispose()
  }

  private updateHover(frame: BatonPresenceFrame): boolean {
    const { courier, dt, time } = frame
    const wanted = frame.hover !== 'none'
    const separated = wanted && !this.hovering
    if (separated) {
      this.hoverBaton.object.position.copy(courier.batonWorld)
      this.hoverBlend = 0
    }
    this.hovering = wanted
    this.hoverBlend = wanted ? Math.min(1, this.hoverBlend + dt * 2.2) : 0
    this.hoverBaton.object.visible = wanted
    if (!wanted) return false
    const spot = frame.hover === 'finish' ? HOVER_FINISH : HOVER_ARMED
    const tremble = frame.hover === 'frozen' ? 0.012 : 0
    this.local.set(spot.x + Math.sin(time * 31) * tremble, spot.y + Math.sin(time * 1.9) * 0.05, spot.z + Math.cos(time * 27) * tremble)
    courier.group.localToWorld(this.hoverTarget.copy(this.local))
    this.hoverBaton.object.position.lerp(this.hoverTarget, 1 - Math.exp(-5 * dt))
    this.hoverBaton.object.rotation.set(0.35, time * 0.9, 0.2)
    this.hoverBaton.update(time, frame.hover === 'finish' ? 0.55 : 1, { blaze: frame.hover === 'frozen' ? 0.5 : 0 })
    return separated
  }

  /**
   * The tether save. It snaps out of the baton to the deck edge above the fall on TETHER_SAVE and stays taut while
   * the courier is hauled up; the respawn that follows ends it.
   */
  private updateTether(frame: BatonPresenceFrame): void {
    const { view, events, dt, time, camera, courier } = frame
    if (events & relayLeg.EVENT.TETHER_SAVE) {
      this.tetherTime = 0
      const path = this.route.activePath(view.path, view.dist)
      const edge = this.route.pathOffset(path, view.dist) + view.edgeSide * (this.route.halfWidth(path, view.dist) - 0.15)
      this.route.point(view.dist, edge, 0.2, this.anchor)
    }
    if (this.tetherTime < 0 || view.motion !== 'tethering') {
      this.tetherTime = -1
      this.save.hide()
      return
    }
    this.tetherTime += dt
    const reach = Math.min(1, this.tetherTime / TETHER_SNAP_SECONDS)
    this.save.update(courier.batonWorld, this.anchor, { sag: 0, strength: 1.35, reach, width: 0.07, time, cameraPosition: camera.position })
  }
}
