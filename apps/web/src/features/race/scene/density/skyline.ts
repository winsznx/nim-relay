import * as THREE from 'three'
import { createWindowMaterial, instancedField, ringPlacements, towerGeometry, type Random, type WindowStyle } from '../worlds/common'

/**
 * A far skyline with lit windows on a ring that drifts at a fraction of the
 * camera's motion: nearer than the painted horizon, farther than the props
 * beside the road, so the city layers into depth as the courier moves.
 */

const PARALLAX = 0.82

export interface Skyline {
  group: THREE.Group
  update(camera: THREE.Camera): void
  dispose(): void
}

export function createSkyline(count: number, radius: number, floorY: number, windows: WindowStyle, random: Random): Skyline {
  const group = new THREE.Group()
  group.name = 'density-skyline'
  const box = towerGeometry()
  const material = createWindowMaterial(windows)
  const mesh = instancedField(box, material, ringPlacements(random, count, radius, radius * 0.25, floorY, r => {
    const width = 26 + r() * 40
    return new THREE.Vector3(width, 90 + r() * r() * 260, width * (0.7 + r() * 0.6))
  }))
  group.add(mesh)
  return {
    group,
    update(camera) {
      group.position.set(camera.position.x * PARALLAX, 0, camera.position.z * PARALLAX)
    },
    dispose() {
      group.removeFromParent()
      mesh.dispose()
      box.dispose()
      material.dispose()
    },
  }
}
