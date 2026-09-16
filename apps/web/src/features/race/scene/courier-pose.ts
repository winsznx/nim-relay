import * as THREE from 'three'
import { HIP_HEIGHT, SHIN_LENGTH, THIGH_LENGTH, type CourierRig } from './courier-rig'

/**
 * Pose parameters blend into bone rotations every frame. Legs are solved with
 * two-bone IK so feet stay planted on the board through crouches, landings and
 * slides; the torso and arms are layered forward kinematics.
 */

export interface PoseParams {
  /** 0..1 knee bend beyond the riding stance. */
  crouch: number
  /** -1..1 bank, positive leans right. */
  lean: number
  /** 0..1 torso pitched forward into speed. */
  pitch: number
  /** -1..1 upper-body twist into steering. */
  twist: number
  /** 0..1 knees drawn up in the air. */
  tuck: number
  /** 0..1 low slide with a hand on the deck. */
  slide: number
  /** Landing compression spring, ~0..1. */
  compress: number
  /** Near-miss flinch spring, -1..1 away from the threat side. */
  flinch: number
  /** 0..1 hit wobble. */
  stumble: number
  /** 0..1 balance arms out. */
  armsOut: number
  /** 0..1 baton raised overhead. */
  batonUp: number
  /** 0..1 throw swing progress. */
  throwSwing: number
  /** 0..1 rear arm reaching up and back for the incoming baton. */
  reach: number
  /** 0..1 both arms up. */
  victory: number
  /** 0..1 compact aerodynamic stance at high FLOW. */
  tucked: number
  boardPitch: number
  boardRoll: number
}

export function neutralPose(): PoseParams {
  return {
    crouch: 0, lean: 0, pitch: 0.2, twist: 0, tuck: 0, slide: 0, compress: 0, flinch: 0, stumble: 0,
    armsOut: 0.6, batonUp: 0, throwSwing: 0, reach: 0, victory: 0, tucked: 0, boardPitch: 0, boardRoll: 0,
  }
}

const FRONT_FOOT = new THREE.Vector3(-0.02, 0.1, -0.27)
const BACK_FOOT = new THREE.Vector3(0.04, 0.1, 0.28)
const STANCE_YAW = -0.78

const euler = new THREE.Euler(0, 0, 0, 'YXZ')
const q = {
  hips: new THREE.Quaternion(),
  spine: new THREE.Quaternion(),
  chest: new THREE.Quaternion(),
  neck: new THREE.Quaternion(),
  thigh: new THREE.Quaternion(),
  shin: new THREE.Quaternion(),
  scratch: new THREE.Quaternion(),
  inverse: new THREE.Quaternion(),
}
const v = {
  socket: new THREE.Vector3(),
  target: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
  pole: new THREE.Vector3(),
  thighDir: new THREE.Vector3(),
  knee: new THREE.Vector3(),
  shinDir: new THREE.Vector3(),
  x: new THREE.Vector3(),
  y: new THREE.Vector3(),
  z: new THREE.Vector3(),
  offset: new THREE.Vector3(),
}
const basis = new THREE.Matrix4()

function setEuler(target: THREE.Quaternion, x: number, y: number, z: number): THREE.Quaternion {
  euler.set(x, y, z, 'YXZ')
  return target.setFromEuler(euler)
}

/** Root-space rotation whose local -Y runs along `limb` and local -Z faces `front`. */
function limbRotation(limb: THREE.Vector3, front: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  v.y.copy(limb).multiplyScalar(-1).normalize()
  v.z.copy(front).addScaledVector(v.y, -front.dot(v.y))
  if (v.z.lengthSq() < 1e-6) v.z.set(0, 0, 1)
  v.z.normalize().multiplyScalar(-1)
  v.x.crossVectors(v.y, v.z).normalize()
  v.z.crossVectors(v.x, v.y).normalize()
  basis.makeBasis(v.x, v.y, v.z)
  return out.setFromRotationMatrix(basis)
}

function solveLeg(rig: CourierRig, side: -1 | 1, foot: THREE.Vector3, footYaw: number): void {
  const bones = rig.bones
  const thigh = side === -1 ? bones.thighL : bones.thighR
  const knee = side === -1 ? bones.kneeL : bones.kneeR
  const footBone = side === -1 ? bones.footL : bones.footR

  v.socket.copy(thigh.position).applyQuaternion(q.hips).add(bones.hips.position)
  v.target.copy(foot)
  v.toTarget.subVectors(v.target, v.socket)
  const reach = THIGH_LENGTH + SHIN_LENGTH - 0.002
  const distance = Math.max(0.08, Math.min(reach, v.toTarget.length()))
  v.toTarget.normalize()

  v.pole.set(side * 0.35, 0, -1).applyQuaternion(q.hips)
  v.pole.addScaledVector(v.toTarget, -v.pole.dot(v.toTarget)).normalize()

  const cosHip = (THIGH_LENGTH * THIGH_LENGTH + distance * distance - SHIN_LENGTH * SHIN_LENGTH) / (2 * THIGH_LENGTH * distance)
  const hipAngle = Math.acos(Math.max(-1, Math.min(1, cosHip)))
  v.thighDir.copy(v.toTarget).multiplyScalar(Math.cos(hipAngle)).addScaledVector(v.pole, Math.sin(hipAngle)).normalize()
  v.knee.copy(v.socket).addScaledVector(v.thighDir, THIGH_LENGTH)
  v.shinDir.subVectors(v.socket.addScaledVector(v.toTarget, distance), v.knee).normalize()

  limbRotation(v.thighDir, v.pole, q.thigh)
  thigh.quaternion.copy(q.inverse.copy(q.hips).invert().multiply(q.thigh))
  limbRotation(v.shinDir, v.pole, q.shin)
  knee.quaternion.copy(q.inverse.copy(q.thigh).invert().multiply(q.shin))
  setEuler(q.scratch, 0, footYaw, 0)
  footBone.quaternion.copy(q.inverse.copy(q.shin).invert().multiply(q.scratch))
}

export function applyPose(rig: CourierRig, pose: PoseParams, time: number): void {
  const bones = rig.bones
  const breathe = Math.sin(time * 2.1) * 0.012
  const wobble = pose.stumble * Math.sin(time * 19) * 0.22

  setEuler(bones.root.quaternion, pose.boardPitch, 0, pose.boardRoll + wobble * 0.3)

  const hipDrop = 0.2 + pose.crouch * 0.15 + pose.compress * 0.13 + pose.slide * 0.3 + pose.tuck * 0.12 + pose.tucked * 0.06
  bones.hips.position.set(pose.lean * 0.07 + pose.flinch * 0.05, Math.max(0.38, HIP_HEIGHT - hipDrop + breathe), pose.slide * 0.05)
  setEuler(q.hips, 0.12 + pose.pitch * 0.2 + pose.slide * 0.25, STANCE_YAW + pose.twist * 0.12, -pose.lean * 0.2 + wobble)
  bones.hips.quaternion.copy(q.hips)

  const spinePitch = 0.08 + pose.pitch * 0.28 + pose.tucked * 0.2 + pose.slide * 0.3 - pose.victory * 0.25 - pose.batonUp * 0.12
  setEuler(q.spine, spinePitch, 0.32 + pose.twist * 0.18, -pose.lean * 0.12 - pose.flinch * 0.15)
  bones.spine.quaternion.copy(q.spine)
  setEuler(q.chest, pose.pitch * 0.12 + pose.tucked * 0.1 + breathe * 2, 0.24 + pose.twist * 0.14 - pose.throwSwing * 0.5, -pose.lean * 0.08)
  bones.chest.quaternion.copy(q.chest)

  q.scratch.copy(q.hips).multiply(q.spine).multiply(q.chest)
  setEuler(q.neck, -0.12 - pose.slide * 0.2, pose.lean * 0.1, 0)
  q.neck.premultiply(q.inverse.copy(q.scratch).invert())
  bones.neck.quaternion.copy(q.neck)
  bones.head.quaternion.set(0, 0, 0, 1)

  solveLeg(rig, -1, v.offset.copy(FRONT_FOOT), -1.3)
  solveLeg(rig, 1, v.offset.copy(BACK_FOOT), -1.75)

  const armsOut = pose.armsOut * (1 - pose.victory)
  const leadPitch = 0.55 * armsOut + pose.slide * 0.9 + pose.tucked * -0.2 + pose.victory * 2.7
  const leadOut = 0.35 + 0.55 * armsOut + pose.flinch * 0.3 - pose.slide * 0.1 + pose.victory * 0.35
  setEuler(bones.shoulderL.quaternion, leadPitch, 0, -leadOut)
  setEuler(bones.elbowL.quaternion, 0.45 + pose.slide * 0.2 - pose.victory * 0.3, 0, 0)

  const carry = 1 - Math.max(pose.batonUp, pose.reach, pose.victory)
  const rearPitch = -0.6 * carry - 0.2 * pose.tucked + pose.batonUp * 2.9 + pose.reach * 2.4 + pose.victory * 2.8 - pose.throwSwing * 3.6
  const rearOut = 0.5 * carry + pose.batonUp * 0.25 + pose.reach * 0.55 + pose.victory * 0.35 + pose.throwSwing * 0.2
  setEuler(bones.shoulderR.quaternion, rearPitch, 0, rearOut)
  setEuler(bones.elbowR.quaternion, 0.28 * carry + pose.batonUp * 0.12 + pose.reach * 0.15, 0, 0)
  setEuler(bones.handR.quaternion, -0.3, 0, 0)
  setEuler(bones.handL.quaternion, 0.2, 0, 0)
}
