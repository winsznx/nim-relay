import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import type { CourierAct, CourierDrive } from './courier'
import type { BodyInstance } from './courier-model'
import { CourierStance } from './courier-stance'

/**
 * Animation for the model courier: library clips for standing, sliding, the
 * catch, the throw and the celebration, and the procedural board stance for
 * riding, jumping and landing, blended by what the simulation says the courier
 * is doing.
 */

type LoopClip = 'idle' | 'ride' | 'air' | 'slide' | 'victory'
type OneShotClip = 'jump-start' | 'land' | 'slide-start' | 'hit' | 'throw'
const LOOPS: readonly LoopClip[] = ['idle', 'ride', 'air', 'slide', 'victory']
const ONE_SHOTS: readonly OneShotClip[] = ['jump-start', 'land', 'slide-start', 'hit', 'throw']
/** Windup frame of the overhand throw, held while the baton is raised. */
const THROW_WINDUP_SECONDS = 0.42

interface OneShot {
  action: THREE.AnimationAction
  weight: number
  active: boolean
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

/** How much of the lower body (pelvis and legs) and upper body the board stance owns in each act. */
function stanceWeights(drive: CourierDrive): { lower: number; upper: number } {
  switch (drive.act) {
    case 'ride':
      return drive.sliding ? { lower: 0, upper: 0 } : { lower: 1, upper: 1 }
    case 'anticipate':
      return { lower: 1, upper: 1 }
    case 'catch':
    case 'prepare':
      return { lower: 1, upper: 0 }
    case 'throw':
      return { lower: 0.6, upper: 0 }
    default:
      return { lower: 0, upper: 0 }
  }
}

export class CourierMotion {
  private readonly mixer: THREE.AnimationMixer
  private readonly loops = new Map<LoopClip, { action: THREE.AnimationAction; weight: number }>()
  private readonly shots = new Map<OneShotClip, OneShot>()
  private readonly pelvis: THREE.Bone | null
  private readonly spine: THREE.Bone | null
  private readonly neck: THREE.Bone | null
  private readonly footL: THREE.Bone | null
  private readonly footR: THREE.Bone | null
  private readonly stance: CourierStance | null
  private stanceLower = 0
  private stanceUpper = 0
  private lean = 0
  private flinch = 0
  private flinchVelocity = 0
  private wobble = 0
  private lastAct: CourierAct = 'idle'
  private readonly axis = new THREE.Vector3()
  private readonly worldQuaternion = new THREE.Quaternion()
  private readonly parentQuaternion = new THREE.Quaternion()
  private readonly inverseParent = new THREE.Quaternion()
  private readonly delta = new THREE.Quaternion()
  private readonly scratch = new THREE.Vector3()
  private readonly scratchB = new THREE.Vector3()

  constructor(
    private readonly body: BodyInstance,
    clips: readonly THREE.AnimationClip[],
    private readonly container: THREE.Object3D,
  ) {
    this.stance = CourierStance.create(body)
    this.mixer = new THREE.AnimationMixer(body.root)
    const byName = new Map(clips.map(clip => [clip.name, clip]))
    for (const name of LOOPS) {
      const clip = byName.get(name)
      if (!clip) continue
      const action = this.mixer.clipAction(clip)
      action.setEffectiveWeight(name === 'idle' ? 1 : 0).play()
      this.loops.set(name, { action, weight: name === 'idle' ? 1 : 0 })
    }
    for (const name of ONE_SHOTS) {
      const clip = byName.get(name)
      if (!clip) continue
      const action = this.mixer.clipAction(clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.setEffectiveWeight(0)
      this.shots.set(name, { action, weight: 0, active: false })
    }
    this.pelvis = body.bone('pelvis')
    this.spine = body.bone('spine_02')
    this.neck = body.bone('neck_01')
    this.footL = body.bone('ball_l')
    this.footR = body.bone('ball_r')
  }

  private trigger(name: OneShotClip, timeScale = 1): void {
    const shot = this.shots.get(name)
    if (!shot) return
    shot.action.reset()
    shot.action.timeScale = timeScale
    shot.action.play()
    shot.active = true
  }

  private holdWindup(): void {
    const shot = this.shots.get('throw')
    if (!shot) return
    if (!shot.active) {
      shot.action.reset().play()
      shot.active = true
    }
    shot.action.time = THROW_WINDUP_SECONDS
    shot.action.timeScale = 0
  }

  update(drive: CourierDrive): void {
    const { dt, act, events } = drive
    if (act === 'ride') {
      if (events & relayLeg.EVENT.SLIDE) this.trigger('slide-start', 1.5)
      if (!this.stance) {
        if (events & relayLeg.EVENT.JUMP) this.trigger('jump-start', 1.6)
        if (events & relayLeg.EVENT.LAND) this.trigger('land', 1.8)
      }
      if (events & (relayLeg.EVENT.HIT | relayLeg.EVENT.FALL) && (drive.sliding || !this.stance)) this.trigger('hit', 1.2)
      if (events & relayLeg.EVENT.NEAR_MISS) this.flinchVelocity += (drive.lateralVelocity >= 0 ? -1 : 1) * 7
    }
    if (act === 'throw' && this.lastAct !== 'throw') this.trigger('throw', 1.1)
    if (act === 'prepare' || act === 'catch') this.holdWindup()
    this.lastAct = act

    const targets: Record<LoopClip, number> = { idle: 0, ride: 0, air: 0, slide: 0, victory: 0 }
    if (act === 'ride') {
      if (drive.sliding) targets.slide = 1
      else if (drive.airborne) targets.air = 1
      else targets.ride = 1
    } else if (act === 'victory' || act === 'finish') {
      targets.victory = 1
    } else if (act === 'anticipate' || act === 'catch' || act === 'prepare') {
      targets.ride = 1
    } else {
      targets.idle = 1
    }

    let shotWeight = 0
    for (const [name, shot] of this.shots) {
      const clipDuration = shot.action.getClip().duration
      const running = shot.active && (name === 'throw' ? act === 'throw' || act === 'prepare' || act === 'catch' : shot.action.time < clipDuration * 0.92)
      if (!running) shot.active = false
      const cap = name === 'throw' ? (act === 'catch' ? 0.8 : 1) : name === 'hit' ? 0.85 : 0.7
      shot.weight = damp(shot.weight, running ? cap : 0, running ? 18 : 7, dt)
      shotWeight = Math.max(shotWeight, shot.weight)
    }
    const loopShare = Math.max(0, 1 - shotWeight)
    let loopTotal = 0
    for (const [name, loop] of this.loops) {
      loop.weight = damp(loop.weight, targets[name], 10, dt)
      loopTotal += loop.weight
    }
    for (const loop of this.loops.values()) loop.action.setEffectiveWeight((loopTotal > 0 ? loop.weight / loopTotal : 0) * loopShare)
    let shotTotal = 0
    for (const shot of this.shots.values()) shotTotal += shot.weight
    for (const shot of this.shots.values()) shot.action.setEffectiveWeight(shotTotal > 0 ? (shot.weight / shotTotal) * Math.min(1, shotWeight) : 0)

    this.mixer.update(dt)

    const stance = this.stance ? stanceWeights(drive) : { lower: 0, upper: 0 }
    this.stanceLower = damp(this.stanceLower, stance.lower, 9, dt)
    this.stanceUpper = damp(this.stanceUpper, stance.upper, 9, dt)
    this.stance?.apply(drive, this.stanceLower, this.stanceUpper)

    this.flinchVelocity += (-80 * this.flinch - 10 * this.flinchVelocity) * dt
    this.flinch += this.flinchVelocity * dt
    this.lean = damp(this.lean, act === 'ride' ? Math.max(-1, Math.min(1, drive.lateralVelocity / 7)) : 0, 8, dt)
    this.wobble = damp(this.wobble, drive.stumbling ? 1 : 0, 10, dt)
    this.body.root.updateMatrixWorld(true)
    const clipShare = 1 - Math.max(this.stanceLower, this.stanceUpper)
    const roll = (-this.lean * 0.32 + this.flinch * 0.25 + Math.sin(drive.time * 18) * this.wobble * 0.12) * clipShare
    this.rotateInModelSpace(this.pelvis, this.axis.set(0, 0, 1), roll)
    this.rotateInModelSpace(this.spine, this.axis.set(0, 0, 1), -roll * 0.35)
    this.rotateInModelSpace(this.spine, this.axis.set(1, 0, 0), act === 'ride' ? (0.08 + drive.flow * 0.12) * clipShare : 0)
    this.rotateInModelSpace(this.neck, this.axis.set(0, 0, 1), roll * 0.5)
  }

  /** Roll of the board under the carve, in the body's model space. */
  get boardRoll(): number {
    return this.stance?.boardRoll ?? 0
  }

  /** World position between the balls of the feet, for placing the board. */
  feetCentre(out: THREE.Vector3): THREE.Vector3 {
    if (!this.footL || !this.footR) return out.set(0, 0, 0)
    this.footL.getWorldPosition(this.scratch)
    this.footR.getWorldPosition(this.scratchB)
    return out.addVectors(this.scratch, this.scratchB).multiplyScalar(0.5)
  }

  /** Rotates a bone about an axis given in the body's model space (+Y up, facing +Z). */
  private rotateInModelSpace(bone: THREE.Bone | null, axis: THREE.Vector3, angle: number): void {
    if (!bone || !bone.parent || Math.abs(angle) < 1e-5) return
    this.container.getWorldQuaternion(this.worldQuaternion)
    axis.applyQuaternion(this.worldQuaternion)
    bone.parent.getWorldQuaternion(this.parentQuaternion)
    this.delta.setFromAxisAngle(axis, angle)
    this.inverseParent.copy(this.parentQuaternion).invert()
    bone.quaternion.premultiply(this.parentQuaternion).premultiply(this.delta).premultiply(this.inverseParent)
    bone.updateMatrixWorld(true)
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.body.root)
  }
}
