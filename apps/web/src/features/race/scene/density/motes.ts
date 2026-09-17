import * as THREE from 'three'

/**
 * Atmosphere you fly through: slow motes of dust or sea haze drifting in the
 * low sun around the camera. One point cloud that wraps around the camera, so
 * the air always has depth and speed reads against it.
 */

const BOX = { x: 70, y: 30, z: 110 }

export interface Motes {
  points: THREE.Points
  update(camera: THREE.Camera, dt: number): void
  dispose(): void
}

function wrap(value: number, size: number): number {
  return ((((value + size / 2) % size) + size) % size) - size / 2
}

export function createMotes(count: number, color: THREE.Color, random: () => number): Motes {
  const offsets = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = (random() - 0.5) * BOX.x
    offsets[i * 3 + 1] = (random() - 0.5) * BOX.y
    offsets[i * 3 + 2] = (random() - 0.5) * BOX.z
  }
  const positions = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  const material = new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
  const points = new THREE.Points(geometry, material)
  points.name = 'density-motes'
  points.frustumCulled = false
  let clock = 0
  return {
    points,
    update(camera, dt) {
      clock += dt
      const origin = camera.position
      for (let i = 0; i < count; i++) {
        const sway = Math.sin(clock * 0.3 + i) * 0.8
        positions[i * 3] = origin.x + wrap(offsets[i * 3]! + sway - origin.x, BOX.x)
        positions[i * 3 + 1] = origin.y + wrap(offsets[i * 3 + 1]! + clock * 0.25 - origin.y, BOX.y)
        positions[i * 3 + 2] = origin.z + wrap(offsets[i * 3 + 2]! - origin.z, BOX.z)
      }
      geometry.attributes.position!.needsUpdate = true
    },
    dispose() {
      points.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
