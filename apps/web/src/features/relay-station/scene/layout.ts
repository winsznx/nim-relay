import * as THREE from 'three'
import type { StationSurfaceId } from '../view-model'

export interface SurfacePlacement {
  /** Base of the surface on the deck. */
  position: THREE.Vector3
  /** Rotation about +Y; 0 faces +Z, towards the overview camera. */
  yaw: number
  /** Light-line tag, so focus can brighten this surface's lines. */
  tag: number
}

/**
 * A terraced crescent read from the courier outwards: you, your history, then
 * the boards and the vault, then the world on the raised terrace behind them.
 * Portrait phones see it top to bottom.
 */
export const PLACEMENT: Record<StationSurfaceId, SurfacePlacement> = {
  courier: { position: new THREE.Vector3(0, 0, 2.8), yaw: 0, tag: 1 },
  chronicle: { position: new THREE.Vector3(0, 0, -1.2), yaw: 0, tag: 2 },
  departures: { position: new THREE.Vector3(-2.3, 0, -3.6), yaw: 0.42, tag: 3 },
  vault: { position: new THREE.Vector3(2.45, 0, -3.5), yaw: -0.5, tag: 4 },
  rankings: { position: new THREE.Vector3(-3.7, 1.1, -9.2), yaw: 0.5, tag: 5 },
  live: { position: new THREE.Vector3(3.65, 1.1, -9.2), yaw: -0.5, tag: 6 },
  world: { position: new THREE.Vector3(0, 1.1, -12.1), yaw: 0, tag: 7 },
}

export const DECK = {
  halfWidth: 6.9,
  front: 9.5,
  back: -14.8,
  corner: 3.4,
  thickness: 1.3,
} as const

/** The raised rear terrace that lifts the far row above the boards in front of it. */
export const TERRACE = {
  front: -7.0,
  height: 1.1,
  stairHalfWidth: 1.7,
  steps: 4,
} as const

export const OVERVIEW = {
  target: new THREE.Vector3(0, 0.9, -4.6),
  /** Elevation of the camera above the target, in radians. */
  pitch: 0.36,
  /** Half extents around the target that must stay in frame. */
  halfWidth: 5.4,
  halfHeight: 6.4,
  /** Wide screens are limited by height; the terrace and window need more of it. */
  landscapeHalfHeight: 8.4,
  /** Portrait framing sits a little low, trading empty foreground deck for sky. */
  portraitShift: -0.06,
} as const

/** Places `root` on its spot and returns the local-to-world matrix for static batching. */
export function placeSurface(id: StationSurfaceId, root: THREE.Object3D): THREE.Matrix4 {
  const placement = PLACEMENT[id]
  root.position.copy(placement.position)
  root.rotation.set(0, placement.yaw, 0)
  root.updateMatrix()
  root.updateMatrixWorld(true)
  return root.matrix
}
