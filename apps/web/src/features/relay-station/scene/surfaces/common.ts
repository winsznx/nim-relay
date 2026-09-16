import * as THREE from 'three'
import type { StationKit } from '../kit'
import type { FocusFrame } from '../types'

/**
 * An invisible pick volume in the surface's local space. It is never rendered
 * (no draw call) but still raycasts, so it can be far larger than the object.
 */
export function createHitTarget(kit: StationKit, root: THREE.Object3D, size: THREE.Vector3Tuple, center: THREE.Vector3Tuple): THREE.Mesh {
  const geometry = kit.track(new THREE.BoxGeometry(...size))
  const mesh = new THREE.Mesh(geometry, kit.track(new THREE.MeshBasicMaterial({ visible: false })))
  mesh.position.set(...center)
  mesh.visible = false
  root.add(mesh)
  mesh.updateMatrixWorld(true)
  return mesh
}

/** Rounded rectangle slab, centred on the origin, front face towards +Z. */
export function roundedSlab(width: number, height: number, depth: number, radius: number, bevel = 0.02): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  const x = -width / 2
  const y = -height / 2
  const r = Math.min(radius, width / 2, height / 2)
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 })
  geometry.translate(0, 0, -(depth - bevel * 2) / 2)
  return geometry
}

export interface FocusApproach {
  /** Swings the viewpoint around the display, in radians from straight on. */
  turn?: number
  elevation?: number
}

/** Focus frame for a display at `localCenter` facing the surface's +Z. */
export function focusFrame(root: THREE.Object3D, localCenter: THREE.Vector3Tuple, width: number, height: number, approach: FocusApproach = {}): FocusFrame {
  root.updateMatrixWorld(true)
  const turn = approach.turn ?? 0
  const center = new THREE.Vector3(...localCenter).applyMatrix4(root.matrixWorld)
  const normal = new THREE.Vector3(Math.sin(turn), 0, Math.cos(turn)).transformDirection(root.matrixWorld)
  return { center, normal, elevation: approach.elevation ?? 0.14, width, height }
}

function translation(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z)
}

/** Surface matrix followed by a local translation. */
export function at(surface: THREE.Matrix4, x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().multiplyMatrices(surface, translation(x, y, z))
}

/** Smoothly approaches `target`; frame-rate independent. */
export function approach(current: number, target: number, delta: number, rate = 6): number {
  return current + (target - current) * (1 - Math.exp(-delta * rate))
}
