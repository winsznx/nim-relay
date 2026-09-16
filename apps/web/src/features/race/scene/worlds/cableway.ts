import * as THREE from 'three'
import type { WorldFrame } from './types'

/**
 * Suspended transit: straight cable spans between towers with lit cabins
 * gliding along them. Used for the coast's harbour line and alpine cable cars.
 */

export interface CableSpan {
  from: THREE.Vector3
  to: THREE.Vector3
}

export interface CablewayOptions {
  spans: readonly CableSpan[]
  cabinsPerSpan: number
  speed: number
  /** How far each tower extends below its cable anchor, metres. */
  towerDepth: number
  towerColor: string
  cabinColor: string
  lightColor: THREE.Color
  cableColor: THREE.Color
}

export function createCableway(options: CablewayOptions): { group: THREE.Group; update(frame: WorldFrame): void; dispose(): void } {
  const group = new THREE.Group()
  group.name = 'cableway'
  const box = new THREE.BoxGeometry(1, 1, 1)
  const towerMaterial = new THREE.MeshStandardMaterial({ color: options.towerColor, roughness: 0.7, metalness: 0.4 })
  const cableMaterial = new THREE.MeshBasicMaterial({ color: options.cableColor })
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: options.cabinColor, roughness: 0.35, metalness: 0.5 })
  const lightMaterial = new THREE.MeshBasicMaterial({ color: options.lightColor })

  const transform = new THREE.Object3D()
  const towers = new THREE.InstancedMesh(box, towerMaterial, options.spans.length * 2)
  const cables = new THREE.InstancedMesh(box, cableMaterial, options.spans.length)
  const cabinCount = options.spans.length * options.cabinsPerSpan
  const cabins = new THREE.InstancedMesh(box, cabinMaterial, Math.max(1, cabinCount))
  const windows = new THREE.InstancedMesh(box, lightMaterial, Math.max(1, cabinCount))
  for (const mesh of [towers, cables, cabins, windows]) {
    mesh.frustumCulled = false
    group.add(mesh)
  }

  const direction = new THREE.Vector3()
  options.spans.forEach((span, index) => {
    for (const [k, end] of [span.from, span.to].entries()) {
      transform.position.set(end.x, end.y - options.towerDepth / 2, end.z)
      transform.rotation.set(0, 0, 0)
      transform.scale.set(1.6, options.towerDepth, 1.6)
      transform.updateMatrix()
      towers.setMatrixAt(index * 2 + k, transform.matrix)
    }
    direction.subVectors(span.to, span.from)
    const length = direction.length()
    transform.position.addVectors(span.from, span.to).multiplyScalar(0.5)
    transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize())
    transform.scale.set(0.12, 0.12, length)
    transform.updateMatrix()
    cables.setMatrixAt(index, transform.matrix)
  })
  towers.instanceMatrix.needsUpdate = true
  cables.instanceMatrix.needsUpdate = true

  return {
    group,
    update(frame) {
      let index = 0
      options.spans.forEach((span, spanIndex) => {
        direction.subVectors(span.to, span.from)
        const length = direction.length()
        direction.normalize()
        const yaw = Math.atan2(direction.x, direction.z)
        for (let c = 0; c < options.cabinsPerSpan; c++) {
          const t = ((frame.time * options.speed) / length + c / options.cabinsPerSpan + spanIndex * 0.37) % 1
          transform.position.copy(span.from).addScaledVector(direction, t * length)
          transform.position.y -= 3.2
          transform.rotation.set(0, yaw, Math.sin(frame.time * 0.7 + c) * 0.03)
          transform.scale.set(3.4, 2.8, 4.6)
          transform.updateMatrix()
          cabins.setMatrixAt(index, transform.matrix)
          transform.scale.set(3.5, 0.7, 4.7)
          transform.position.y += 0.35
          transform.updateMatrix()
          windows.setMatrixAt(index, transform.matrix)
          index++
        }
      })
      cabins.instanceMatrix.needsUpdate = true
      windows.instanceMatrix.needsUpdate = true
    },
    dispose() {
      group.removeFromParent()
      for (const mesh of [towers, cables, cabins, windows]) mesh.dispose()
      box.dispose()
      towerMaterial.dispose()
      cableMaterial.dispose()
      cabinMaterial.dispose()
      lightMaterial.dispose()
    },
  }
}
