import * as THREE from 'three'
import { OVERVIEW } from './layout'
import type { FocusFrame } from './types'

export interface CameraRig {
  readonly focused: boolean
  setViewport(width: number, height: number): void
  setReducedMotion(reduced: boolean): void
  focus(frame: FocusFrame | null): void
  /** Drag deltas in CSS pixels. */
  orbit(dx: number, dy: number): void
  zoom(factor: number): void
  tick(time: number, delta: number): void
}

interface Pose {
  position: THREE.Vector3
  target: THREE.Vector3
  /** Fraction of the viewport height the image is shifted up, clearing room for the card. */
  shift: number
}

interface Limits {
  yaw: number
  pitchDown: number
  pitchUp: number
  zoomIn: number
  zoomOut: number
}

const OVERVIEW_LIMITS: Limits = { yaw: 0.5, pitchDown: 0.2, pitchUp: 0.26, zoomIn: 0.72, zoomOut: 1.25 }
const FOCUS_LIMITS: Limits = { yaw: 0.34, pitchDown: 0.12, pitchUp: 0.14, zoomIn: 0.8, zoomOut: 1.3 }
const TRANSITION_SECONDS = 1.2
const DRIFT_RESUME_SECONDS = 3.5
const MIN_POLAR = 0.25
const MAX_POLAR = 1.5

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function createCameraRig(camera: THREE.PerspectiveCamera, reducedMotion: boolean): CameraRig {
  let width = 1
  let height = 1
  let reduced = reducedMotion
  let focused = false
  let limits = OVERVIEW_LIMITS

  const from: Pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), shift: 0 }
  const to: Pose = { position: new THREE.Vector3(), target: new THREE.Vector3(), shift: 0 }
  let focusFrame: FocusFrame | null = null
  let transitionStart = 0
  let clock = 0
  let placed = false
  let lastInteraction = -Infinity
  let driftAmount = reducedMotion ? 0 : 1

  const offset = { yaw: 0, pitch: 0, zoom: 1 }
  const goal = { yaw: 0, pitch: 0, zoom: 1 }

  const basePosition = new THREE.Vector3()
  const baseTarget = new THREE.Vector3()
  const spherical = new THREE.Spherical()
  const scratch = new THREE.Vector3()
  let appliedShift = Number.NaN

  function fieldOfView(): number {
    return width / height < 0.8 ? 52 : 42
  }

  function overviewPose(pose: Pose): void {
    const halfTan = Math.tan(THREE.MathUtils.degToRad(fieldOfView()) / 2)
    const aspect = width / height
    const portrait = aspect < 0.8
    const halfHeight = portrait ? OVERVIEW.halfHeight : OVERVIEW.landscapeHalfHeight
    const distance = clamp(Math.max(halfHeight / halfTan, OVERVIEW.halfWidth / (halfTan * aspect)), 14, 38)
    pose.target.copy(OVERVIEW.target)
    pose.position.set(0, Math.sin(OVERVIEW.pitch), Math.cos(OVERVIEW.pitch)).multiplyScalar(distance).add(OVERVIEW.target)
    pose.shift = portrait ? OVERVIEW.portraitShift : 0
  }

  function focusPose(frame: FocusFrame, pose: Pose): void {
    const aspect = width / height
    const portrait = aspect < 0.8
    const halfTan = Math.tan(THREE.MathUtils.degToRad(fieldOfView()) / 2)
    const usableHeight = portrait ? 0.54 : 0.56
    const usableWidth = portrait ? 0.9 : 0.62
    const distance = Math.max(frame.height / usableHeight / (2 * halfTan), frame.width / usableWidth / (2 * halfTan * aspect)) + 0.3
    scratch.copy(frame.normal).setY(frame.elevation).normalize()
    pose.target.copy(frame.center)
    pose.position.copy(frame.center).addScaledVector(scratch, distance)
    pose.shift = portrait ? 0.16 : 0.14
  }

  function destination(pose: Pose): void {
    if (focusFrame) focusPose(focusFrame, pose)
    else overviewPose(pose)
  }

  function applyShift(shift: number): void {
    if (Math.abs(shift - appliedShift) < 1e-4) return
    appliedShift = shift
    if (shift === 0) camera.clearViewOffset()
    else camera.setViewOffset(width, height, 0, shift * height, width, height)
  }

  return {
    get focused() {
      return focused
    },
    setViewport(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth)
      height = Math.max(1, nextHeight)
      camera.aspect = width / height
      camera.fov = fieldOfView()
      appliedShift = Number.NaN
      destination(to)
      if (!placed) {
        placed = true
        from.position.copy(to.position)
        from.target.copy(to.target)
        from.shift = to.shift
        baseTarget.copy(to.target)
      }
      camera.updateProjectionMatrix()
    },
    setReducedMotion(next) {
      reduced = next
    },
    focus(frame) {
      from.position.copy(camera.position)
      from.target.copy(baseTarget)
      from.shift = Number.isNaN(appliedShift) ? 0 : appliedShift
      focusFrame = frame
      focused = frame !== null
      limits = focused ? FOCUS_LIMITS : OVERVIEW_LIMITS
      destination(to)
      offset.yaw = offset.pitch = goal.yaw = goal.pitch = 0
      offset.zoom = goal.zoom = 1
      driftAmount = 0
      lastInteraction = clock
      transitionStart = clock
    },
    orbit(dx, dy) {
      goal.yaw = clamp(goal.yaw - dx * 0.0055, -limits.yaw, limits.yaw)
      goal.pitch = clamp(goal.pitch + dy * 0.004, -limits.pitchDown, limits.pitchUp)
      lastInteraction = clock
    },
    zoom(factor) {
      goal.zoom = clamp(goal.zoom * factor, limits.zoomIn, limits.zoomOut)
      lastInteraction = clock
    },
    tick(time, delta) {
      clock = time
      const progress = reduced ? 1 : clamp((time - transitionStart) / TRANSITION_SECONDS, 0, 1)
      const eased = easeInOutCubic(progress)
      basePosition.lerpVectors(from.position, to.position, eased)
      baseTarget.lerpVectors(from.target, to.target, eased)
      if (progress < 1) basePosition.y += Math.sin(Math.PI * eased) * Math.min(2.5, from.position.distanceTo(to.position) * 0.1)

      const follow = 1 - Math.exp(-delta * 9)
      offset.yaw += (goal.yaw - offset.yaw) * follow
      offset.pitch += (goal.pitch - offset.pitch) * follow
      offset.zoom += (goal.zoom - offset.zoom) * follow

      const wantsDrift = !reduced && time - lastInteraction > DRIFT_RESUME_SECONDS ? 1 : 0
      driftAmount += (wantsDrift - driftAmount) * (1 - Math.exp(-delta * (wantsDrift ? 0.6 : 6)))
      const driftYaw = (0.05 * Math.sin(time * 0.083) + 0.012 * Math.sin(time * 0.21)) * driftAmount * (focused ? 0.35 : 1)
      const driftPitch = 0.018 * Math.sin(time * 0.117 + 1.3) * driftAmount * (focused ? 0.35 : 1)

      spherical.setFromVector3(scratch.subVectors(basePosition, baseTarget))
      spherical.theta += offset.yaw + driftYaw
      spherical.phi = clamp(spherical.phi - offset.pitch - driftPitch, MIN_POLAR, MAX_POLAR)
      spherical.radius *= offset.zoom
      camera.position.setFromSpherical(spherical).add(baseTarget)
      camera.lookAt(baseTarget)
      applyShift(from.shift + (to.shift - from.shift) * eased)
    },
  }
}
