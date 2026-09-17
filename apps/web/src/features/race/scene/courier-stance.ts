import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import type { CourierDrive } from './courier'
import type { BodyInstance } from './courier-model'

/**
 * Procedural board stance for the model courier. The CC0 animation library has
 * no board riding, so the race poses are solved here in the body's model space
 * (+Y up, facing +Z, left side at +X): a crouched carve with the baton hand
 * forward and the free arm back for balance, a knees-up tuck in the air,
 * compression on landing and a lean into steering. Spine and head are posed by
 * angle; legs and arms by two-bone IK towards feet planted on the board and
 * hands placed for balance. The pose blends over the clip mixer's output, so
 * moving to and from library clips (slide, catch, victory) stays continuous.
 *
 * v6 layers ride on top: a dip and lean into each lane change that snaps back
 * upright when the lane is held, a wobble on the shoulder, the edge grind
 * (leaning away from the rail, baton arm swung out over it), the Relay Rush
 * tuck with both arms swept back so the blazing baton trails behind, limbs
 * thrown wide while falling, hanging from the baton through a tether save and
 * kneeling with the baton held close when the leg has failed.
 */

type JointName =
  | 'root' | 'pelvis' | 'spine_01' | 'spine_02' | 'spine_03' | 'neck_01' | 'Head'
  | 'clavicle_l' | 'upperarm_l' | 'lowerarm_l' | 'hand_l' | 'clavicle_r' | 'upperarm_r' | 'lowerarm_r' | 'hand_r'
  | 'thigh_l' | 'calf_l' | 'foot_l' | 'thigh_r' | 'calf_r' | 'foot_r'

class MissingJointError extends Error {
  constructor(name: string) {
    super(`Courier skeleton has no ${name} bone`)
    this.name = 'MissingJointError'
  }
}

interface Joint {
  bone: THREE.Bone
  restPosition: THREE.Vector3
  restQuaternion: THREE.Quaternion
  /** Solved model-space position and rotation. */
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** Solved rotation relative to the parent joint. */
  local: THREE.Quaternion
}

interface Limb {
  upper: Joint
  lower: Joint
  end: Joint
  upperLength: number
  lowerLength: number
  /** Inverse rest basis (hinge axis, bone direction) of each segment. */
  upperRestBasis: THREE.Quaternion
  lowerRestBasis: THREE.Quaternion
}

/** Ankle height above the sole. */
const ANKLE = 0.085
/** Hips turn towards the right foot; the chest turns back so the baton hand leads. */
const HIP_YAW = -0.26
const CHEST_TWIST = 0.3
const FOOT_YAW = -0.22
const TUCK_LIFT = 0.22
const LEFT_FOOT = new THREE.Vector3(0.13, ANKLE, 0.15)
const RIGHT_FOOT = new THREE.Vector3(-0.14, ANKLE, -0.13)
const LEFT_KNEE_POLE = new THREE.Vector3(0.3, 0.1, 1)
const RIGHT_KNEE_POLE = new THREE.Vector3(-0.2, 0.1, 1)
/**
 * Shoulder-relative hand targets. The right hand carries the baton low and out beside the hip, where the chase
 * camera sees it clear of the body.
 */
const BATON_HAND = new THREE.Vector3(-0.3, -0.36, 0.06)
const BATON_HAND_TUCK = new THREE.Vector3(-0.24, -0.2, 0.2)
const BALANCE_HAND = new THREE.Vector3(0.17, -0.26, -0.35)
const BALANCE_HAND_TUCK = new THREE.Vector3(0.14, -0.32, 0.14)
const BATON_ELBOW_POLE = new THREE.Vector3(-0.7, -0.6, -0.3)
const BALANCE_ELBOW_POLE = new THREE.Vector3(0.5, -0.3, -0.8)
/** Relay Rush: both hands swept back and low, the baton trailing beside the hip. */
const BATON_HAND_RUSH = new THREE.Vector3(-0.2, -0.36, -0.3)
const BALANCE_HAND_RUSH = new THREE.Vector3(0.22, -0.32, -0.4)
/** Hanging from the tether: the baton hand straight up, the free hand reaching for it. */
const BATON_HAND_HANG = new THREE.Vector3(-0.04, 0.58, 0.06)
const BALANCE_HAND_HANG = new THREE.Vector3(0.12, 0.42, 0.12)
/** Falling: both arms thrown wide. */
const BATON_HAND_TUMBLE = new THREE.Vector3(-0.46, 0.12, 0.08)
const BALANCE_HAND_TUMBLE = new THREE.Vector3(0.46, 0.22, -0.06)
/** Failed: the baton held close to the chest, the free hand on the forward knee. */
const BATON_HAND_KNEEL = new THREE.Vector3(-0.02, -0.16, 0.26)
const BALANCE_HAND_KNEEL = new THREE.Vector3(0.1, -0.5, 0.3)
/** Kneeling feet: the left foot planted forward, the right knee down behind. */
const LEFT_FOOT_KNEEL = new THREE.Vector3(0.15, ANKLE, 0.34)
const RIGHT_FOOT_KNEEL = new THREE.Vector3(-0.16, ANKLE * 0.6, -0.4)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
/** Rest hinge axes: the knee bends forward about +X, elbows flex forward about ±Y. */
const KNEE_HINGE = X_AXIS
const RIGHT_ELBOW_HINGE = Y_AXIS
const LEFT_ELBOW_HINGE = new THREE.Vector3(0, -1, 0)
const FEET = [
  { foot: LEFT_FOOT, knee: LEFT_KNEE_POLE },
  { foot: RIGHT_FOOT, knee: RIGHT_KNEE_POLE },
] as const
const HANDS = [
  { ride: BALANCE_HAND, tucked: BALANCE_HAND_TUCK, rush: BALANCE_HAND_RUSH, hang: BALANCE_HAND_HANG, tumble: BALANCE_HAND_TUMBLE, kneel: BALANCE_HAND_KNEEL, elbow: BALANCE_ELBOW_POLE, balance: 1, side: 1 },
  { ride: BATON_HAND, tucked: BATON_HAND_TUCK, rush: BATON_HAND_RUSH, hang: BATON_HAND_HANG, tumble: BATON_HAND_TUMBLE, kneel: BATON_HAND_KNEEL, elbow: BATON_ELBOW_POLE, balance: 0, side: -1 },
] as const
const KNEEL_FEET = [LEFT_FOOT_KNEEL, RIGHT_FOOT_KNEEL] as const

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt))
}

export class CourierStance {
  private readonly joints: Record<JointName, Joint>
  private readonly legs: readonly [Limb, Limb]
  private readonly arms: readonly [Limb, Limb]
  private readonly pelvisLocalPosition = new THREE.Vector3()
  private readonly lowerJoints: readonly Joint[]
  private readonly upperJoints: readonly Joint[]

  private tuck = 0
  private compress = 0
  private compressVelocity = 0
  private flinch = 0
  private flinchVelocity = 0
  private lean = 0
  private wobble = 0
  private flow = 0
  private rail = 0
  private settle = 0
  private settleVelocity = 0
  private grind = 0
  private grindSide: -1 | 1 = 1
  private shoulder = 0
  private rush = 0
  private hang = 0
  private tumble = 0
  private kneel = 0
  /** Board roll in model space, for tilting the board with the carve. */
  boardRoll = 0

  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly v4 = new THREE.Vector3()
  private readonly v5 = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly pole = new THREE.Vector3()
  private readonly q1 = new THREE.Quaternion()
  private readonly q2 = new THREE.Quaternion()
  private readonly body = new THREE.Quaternion()
  private readonly chest = new THREE.Quaternion()
  private readonly basisMatrix = new THREE.Matrix4()
  private readonly euler = new THREE.Euler(0, 0, 0, 'ZYX')

  /** Captures the rest pose; call before any animation has moved the skeleton. Null when a joint is missing. */
  static create(body: BodyInstance): CourierStance | null {
    try {
      return new CourierStance(body)
    } catch (error) {
      if (error instanceof MissingJointError) return null
      throw error
    }
  }

  private constructor(body: BodyInstance) {
    body.root.updateMatrixWorld(true)
    const inverseRoot = new THREE.Matrix4().copy(body.root.matrixWorld).invert()
    const model = new THREE.Matrix4()
    const scale = new THREE.Vector3()
    const joint = (name: JointName): Joint => {
      const bone = body.bone(name)
      if (!bone) throw new MissingJointError(name)
      const restPosition = new THREE.Vector3()
      const restQuaternion = new THREE.Quaternion()
      model.multiplyMatrices(inverseRoot, bone.matrixWorld).decompose(restPosition, restQuaternion, scale)
      return { bone, restPosition, restQuaternion, position: restPosition.clone(), quaternion: restQuaternion.clone(), local: bone.quaternion.clone() }
    }
    const j: Record<JointName, Joint> = {
      root: joint('root'),
      pelvis: joint('pelvis'),
      spine_01: joint('spine_01'),
      spine_02: joint('spine_02'),
      spine_03: joint('spine_03'),
      neck_01: joint('neck_01'),
      Head: joint('Head'),
      clavicle_l: joint('clavicle_l'),
      upperarm_l: joint('upperarm_l'),
      lowerarm_l: joint('lowerarm_l'),
      hand_l: joint('hand_l'),
      clavicle_r: joint('clavicle_r'),
      upperarm_r: joint('upperarm_r'),
      lowerarm_r: joint('lowerarm_r'),
      hand_r: joint('hand_r'),
      thigh_l: joint('thigh_l'),
      calf_l: joint('calf_l'),
      foot_l: joint('foot_l'),
      thigh_r: joint('thigh_r'),
      calf_r: joint('calf_r'),
      foot_r: joint('foot_r'),
    }
    this.joints = j
    this.legs = [this.limb(j.thigh_l, j.calf_l, j.foot_l, KNEE_HINGE), this.limb(j.thigh_r, j.calf_r, j.foot_r, KNEE_HINGE)]
    this.arms = [this.limb(j.upperarm_l, j.lowerarm_l, j.hand_l, LEFT_ELBOW_HINGE), this.limb(j.upperarm_r, j.lowerarm_r, j.hand_r, RIGHT_ELBOW_HINGE)]
    this.lowerJoints = [j.pelvis, j.thigh_l, j.calf_l, j.foot_l, j.thigh_r, j.calf_r, j.foot_r]
    this.upperJoints = [j.spine_01, j.spine_02, j.spine_03, j.neck_01, j.Head, j.clavicle_l, j.upperarm_l, j.lowerarm_l, j.hand_l, j.clavicle_r, j.upperarm_r, j.lowerarm_r, j.hand_r]
  }

  /** Advances springs and smoothing from what the courier is doing, then blends the stance over the current pose. */
  apply(drive: CourierDrive, lowerWeight: number, upperWeight: number): void {
    this.advance(drive)
    if (lowerWeight < 0.001 && upperWeight < 0.001) {
      this.boardRoll = 0
      return
    }
    this.solve(drive.time)
    this.boardRoll *= lowerWeight
    for (const joint of this.lowerJoints) joint.bone.quaternion.slerp(joint.local, lowerWeight)
    this.joints.pelvis.bone.position.lerp(this.pelvisLocalPosition, lowerWeight)
    for (const joint of this.upperJoints) joint.bone.quaternion.slerp(joint.local, upperWeight)
  }

  private advance(drive: CourierDrive): void {
    const { dt, events } = drive
    const riding = drive.act === 'ride'
    const motion = drive.motion ?? 'riding'
    if (riding) {
      if (events & relayLeg.EVENT.LAND) this.compressVelocity += events & relayLeg.EVENT.CLEAN_LAND ? 2.4 : 3.4
      if (events & relayLeg.EVENT.HARD_LANDING) this.compressVelocity += 2.2
      if (events & relayLeg.EVENT.JUMP) this.compressVelocity -= 2
      if (events & (relayLeg.EVENT.HIT | relayLeg.EVENT.FALL)) this.flinchVelocity += 7
      if (events & relayLeg.EVENT.NEAR_MISS) this.flinchVelocity += 2.2
      // A lane change dips and throws the weight toward the new lane; holding it snaps back upright.
      if (events & relayLeg.EVENT.LANE_SHIFT) {
        this.compressVelocity += 1.2
        this.settleVelocity += Math.sign(drive.laneShift ?? 0) * 3.2
      }
      if (events & relayLeg.EVENT.LANE_ACQUIRED) this.settleVelocity -= this.lean * 4 + this.settle * 6
      if (events & relayLeg.EVENT.EDGE_SAVE) this.settleVelocity -= this.grindSide * 3
    }
    this.compressVelocity += (-95 * this.compress - 12 * this.compressVelocity) * dt
    this.compress = THREE.MathUtils.clamp(this.compress + this.compressVelocity * dt, -0.7, 1.2)
    this.flinchVelocity += (-80 * this.flinch - 10 * this.flinchVelocity) * dt
    this.flinch = THREE.MathUtils.clamp(this.flinch + this.flinchVelocity * dt, -1, 1)
    this.settleVelocity += (-70 * this.settle - 9 * this.settleVelocity) * dt
    this.settle = THREE.MathUtils.clamp(this.settle + this.settleVelocity * dt, -1, 1)
    const airborne = riding && drive.airborne && !drive.sliding && motion === 'riding'
    this.tuck = damp(this.tuck, airborne ? 1 : 0, airborne ? 9 : 18, dt)
    this.lean = damp(this.lean, riding && motion === 'riding' ? THREE.MathUtils.clamp(drive.lateralVelocity / 7, -1, 1) : 0, 7, dt)
    this.wobble = damp(this.wobble, drive.stumbling ? 1 : 0, 10, dt)
    this.flow = damp(this.flow, riding ? drive.flow : 0, 3, dt)
    this.rail = damp(this.rail, drive.railing ? 1 : 0, 10, dt)
    if (drive.edgeSide) this.grindSide = drive.edgeSide
    this.grind = damp(this.grind, riding && motion === 'grinding' ? 1 : 0, 12, dt)
    this.shoulder = damp(this.shoulder, riding ? (drive.shoulder ?? 0) : 0, 6, dt)
    this.rush = damp(this.rush, riding ? (drive.rush ?? 0) : 0, 4, dt)
    this.hang = damp(this.hang, motion === 'tethering' ? 1 : 0, 7, dt)
    this.tumble = damp(this.tumble, motion === 'falling' || (motion === 'failed' && drive.act !== 'failed') ? 1 : 0, 8, dt)
    this.kneel = damp(this.kneel, drive.act === 'failed' ? 1 : 0, 5, dt)
  }

  private solve(time: number): void {
    const j = this.joints
    const sway = Math.sin(time * 2.1) * 0.6 + Math.sin(time * 3.7 + 1.3) * 0.4
    const loose = Math.max(this.hang, this.tumble)
    const roll =
      this.lean * 0.3 +
      this.settle * 0.16 +
      Math.sin(time * 17) * this.wobble * 0.1 +
      Math.sin(time * 7.3) * this.shoulder * 0.07 -
      this.grindSide * this.grind * 0.36 +
      Math.sin(time * 43) * this.grind * 0.018 +
      Math.sin(time * 2.6) * this.hang * 0.12
    const crouch = 0.29 + this.flow * 0.04 + this.compress * 0.12 + this.rail * 0.03 - this.tuck * 0.06 + sway * 0.006 + this.grind * 0.08 + this.rush * 0.07 + this.kneel * 0.16 - loose * 0.2
    const pitch = 0.55 + this.flow * 0.1 + this.compress * 0.18 + this.tuck * 0.12 - this.flinch * 0.5 + this.rush * 0.22 + this.kneel * 0.3 - this.hang * 0.5 - this.tumble * 0.2

    const pelvis = j.pelvis
    const height = pelvis.restPosition.y - crouch
    pelvis.position.set(-Math.sin(roll) * height, Math.cos(roll) * height, pelvis.restPosition.z - 0.02)
    this.orient(pelvis, roll, HIP_YAW, pitch * 0.45)
    this.chain(j.spine_01, pelvis, roll, HIP_YAW + CHEST_TWIST * 0.33, pitch * 0.65)
    this.chain(j.spine_02, j.spine_01, roll, HIP_YAW + CHEST_TWIST * 0.66, pitch * 0.85)
    this.chain(j.spine_03, j.spine_02, roll, HIP_YAW + CHEST_TWIST, pitch)
    this.chain(j.neck_01, j.spine_03, roll * 0.7, 0.02, pitch * 0.45)
    this.chain(j.Head, j.neck_01, roll * 0.45, 0, 0.05 + pitch * 0.1)
    const chestYaw = HIP_YAW + CHEST_TWIST
    this.chain(j.clavicle_l, j.spine_03, roll, chestYaw, pitch)
    this.chain(j.clavicle_r, j.spine_03, roll, chestYaw, pitch)

    // The board tips its rail-side edge down into the grind and twists loose while falling.
    this.boardRoll = roll * 0.55 + this.grindSide * this.grind * 0.42 + Math.sin(time * 9) * this.tumble * 0.5
    this.euler.set(0, 0, this.boardRoll)
    this.body.setFromEuler(this.euler)
    const lift = this.tuck * TUCK_LIFT
    for (let index = 0; index < 2; index++) {
      const leg = this.legs[index]!
      const { foot, knee } = FEET[index]!
      this.chain(leg.upper, pelvis, roll, HIP_YAW, pitch * 0.45)
      this.target.copy(foot).applyQuaternion(this.body)
      this.target.y += lift
      if (loose > 0.001) {
        // Hanging or falling, the feet leave the deck and swing under the hips.
        this.v2.set(pelvis.position.x + (index === 0 ? 0.13 : -0.13), pelvis.position.y - 0.62 - this.hang * 0.18, pelvis.position.z + (index === 0 ? 0.12 : -0.08) * (1 + this.tumble))
        this.target.lerp(this.v2, loose)
      }
      if (this.kneel > 0.001) this.target.lerp(KNEEL_FEET[index]!, this.kneel)
      this.solveLimb(leg, this.target, this.pole.copy(knee))
      this.orient(leg.end, this.boardRoll * (1 - this.kneel), FOOT_YAW, 0)
    }

    this.euler.set(0, chestYaw, roll)
    this.chest.setFromEuler(this.euler)
    const flinchLift = this.flinch * 0.12
    for (let index = 0; index < 2; index++) {
      const arm = this.arms[index]!
      const hand = HANDS[index]!
      this.chain(arm.upper, index === 0 ? j.clavicle_l : j.clavicle_r, roll, chestYaw, pitch)
      this.v1.copy(hand.ride).lerp(hand.tucked, this.tuck).lerp(hand.rush, this.rush)
      this.v1.x += this.rail * 0.06 * hand.balance
      this.v1.y += flinchLift + sway * 0.012
      // Grinding, the rail-side arm (and with the right arm, the baton) swings out and down over the rail; the other lifts for balance.
      const railSide = hand.side === -this.grindSide ? 1 : 0
      this.v1.x += this.grind * hand.side * (railSide ? 0.24 : 0.08)
      this.v1.y += this.grind * (railSide ? -0.1 : 0.26)
      this.v1.x += this.shoulder * hand.side * 0.1
      this.v1.y += this.shoulder * 0.08 * Math.sin(time * 7.3 + index * Math.PI)
      this.v1.lerp(hand.tumble, this.tumble).lerp(hand.hang, this.hang).lerp(hand.kneel, this.kneel)
      this.target.copy(this.v1).applyQuaternion(this.chest).add(arm.upper.position)
      this.solveLimb(arm, this.target, this.pole.copy(hand.elbow).applyQuaternion(this.chest))
    }

    this.localise(pelvis, j.root)
    this.pelvisLocalPosition.subVectors(pelvis.position, j.root.restPosition).applyQuaternion(this.q1.copy(j.root.restQuaternion).invert())
    this.localise(j.spine_01, pelvis)
    this.localise(j.spine_02, j.spine_01)
    this.localise(j.spine_03, j.spine_02)
    this.localise(j.neck_01, j.spine_03)
    this.localise(j.Head, j.neck_01)
    this.localise(j.clavicle_l, j.spine_03)
    this.localise(j.clavicle_r, j.spine_03)
    for (let index = 0; index < 2; index++) {
      const leg = this.legs[index]!
      this.localise(leg.upper, pelvis)
      this.localise(leg.lower, leg.upper)
      this.localise(leg.end, leg.lower)
      const arm = this.arms[index]!
      this.localise(arm.upper, index === 0 ? j.clavicle_l : j.clavicle_r)
      this.localise(arm.lower, arm.upper)
      this.localise(arm.end, arm.lower)
    }
  }

  private limb(upper: Joint, lower: Joint, end: Joint, hinge: THREE.Vector3): Limb {
    const upperDirection = new THREE.Vector3().subVectors(lower.restPosition, upper.restPosition)
    const lowerDirection = new THREE.Vector3().subVectors(end.restPosition, lower.restPosition)
    return {
      upper,
      lower,
      end,
      upperLength: upperDirection.length(),
      lowerLength: lowerDirection.length(),
      upperRestBasis: this.basis(hinge, upperDirection, new THREE.Quaternion()).invert(),
      lowerRestBasis: this.basis(hinge, lowerDirection, new THREE.Quaternion()).invert(),
    }
  }

  /** Rotation whose columns are the hinge (made perpendicular), the bone direction and their cross product. */
  private basis(hinge: THREE.Vector3, direction: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
    const y = this.v3.copy(direction).normalize()
    const x = this.v4.copy(hinge).addScaledVector(y, -hinge.dot(y)).normalize()
    const z = this.v5.crossVectors(x, y)
    this.basisMatrix.makeBasis(x, y, z)
    return out.setFromRotationMatrix(this.basisMatrix)
  }

  /** Sets a joint's model rotation to its rest rotation turned by pitch (about X), then yaw (Y), then roll (Z). */
  private orient(joint: Joint, roll: number, yaw: number, pitch: number): void {
    this.euler.set(pitch, yaw, roll)
    joint.quaternion.setFromEuler(this.euler).multiply(joint.restQuaternion)
  }

  /** Places a joint rigidly under its solved parent, then orients it. */
  private chain(joint: Joint, parent: Joint, roll: number, yaw: number, pitch: number): void {
    this.q2.copy(parent.restQuaternion).invert().premultiply(parent.quaternion)
    joint.position.subVectors(joint.restPosition, parent.restPosition).applyQuaternion(this.q2).add(parent.position)
    this.orient(joint, roll, yaw, pitch)
  }

  /** Two-bone IK from the limb's solved root towards `target`, bending towards `pole`. */
  private solveLimb(limb: Limb, target: THREE.Vector3, pole: THREE.Vector3): void {
    const root = limb.upper.position
    const upperLength = limb.upperLength
    const lowerLength = limb.lowerLength
    const toTarget = this.v1.subVectors(target, root)
    const reach = THREE.MathUtils.clamp(toTarget.length(), Math.abs(upperLength - lowerLength) + 0.001, (upperLength + lowerLength) * 0.999)
    const axis = toTarget.lengthSq() > 1e-10 ? toTarget.normalize() : toTarget.copy(Y_AXIS).negate()
    const bend = this.v2.copy(pole).addScaledVector(axis, -pole.dot(axis))
    if (bend.lengthSq() < 1e-8) bend.copy(Z_AXIS).addScaledVector(axis, -axis.z)
    bend.normalize()
    const cosine = (upperLength * upperLength + reach * reach - lowerLength * lowerLength) / (2 * upperLength * reach)
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine))
    const middle = limb.lower.position.copy(root).addScaledVector(axis, upperLength * cosine).addScaledVector(bend, upperLength * sine)
    limb.end.position.copy(root).addScaledVector(axis, reach)
    const hinge = this.pole.crossVectors(bend, axis).normalize()

    this.basis(hinge, this.target.subVectors(middle, root), this.q1).multiply(limb.upperRestBasis)
    limb.upper.quaternion.copy(this.q1).multiply(limb.upper.restQuaternion)
    this.basis(hinge, this.target.subVectors(limb.end.position, middle), this.q1).multiply(limb.lowerRestBasis)
    limb.lower.quaternion.copy(this.q1).multiply(limb.lower.restQuaternion)
    limb.end.quaternion.copy(this.q1).multiply(limb.end.restQuaternion)
  }

  private localise(joint: Joint, parent: Joint): void {
    joint.local.copy(parent.quaternion).invert().multiply(joint.quaternion)
  }
}
