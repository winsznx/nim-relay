import * as THREE from 'three'
import { createGround, createWeather } from './atmosphere'
import {
  HorizonRing,
  hashString,
  instancedField,
  ringPlacements,
  scatterBeside,
  seededRandom,
  type Placement,
} from './common'
import { WORLD_STYLES } from './styles'
import type { WorldContext, WorldFrame, WorldKit, WorldLayer } from './types'

/**
 * Solar Frontier at last light: a skyway across a high desert. The sun sits on
 * the horizon ahead, mesas stand in silhouette, mirror arrays catch the sky and
 * wind turbines turn slowly with red tip lights.
 */

function mesaGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.72, 1, 1, 7, 2)
  geometry.translate(0, 0.5, 0)
  return geometry
}

function bladeGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.BoxGeometry(0.9, 24, 0.25)
    blade.translate(0, 12.5, 0)
    blade.rotateZ((i / 3) * Math.PI * 2)
    blades.push(blade)
  }
  const hub = new THREE.SphereGeometry(1.1, 8, 6)
  const positions: number[] = []
  const normals: number[] = []
  for (const part of [...blades, hub]) {
    const flat = part.toNonIndexed()
    const position = flat.getAttribute('position')
    const normal = flat.getAttribute('normal')
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i))
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i))
    }
    flat.dispose()
    part.dispose()
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
}

function build(context: WorldContext): WorldLayer {
  const { scene, route, quality, floorY } = context
  const random = seededRandom(hashString(`solar:${route.track.finishDist}`))
  const group = new THREE.Group()
  group.name = 'world-solar'
  scene.add(group)
  const disposables: { dispose(): void }[] = []

  const ground = createGround({ base: '#2a1712', accent: '#5a3020', pattern: 'dunes', lightColor: '#000000', lightStrength: 0 }, floorY)
  group.add(ground.mesh)
  disposables.push(ground)

  const mesa = mesaGeometry()
  const mesaMaterial = new THREE.MeshStandardMaterial({ color: '#3b1e18', roughness: 0.95, metalness: 0, flatShading: true })
  const horizonMaterial = new THREE.MeshBasicMaterial({ color: '#2a1216', fog: false })
  disposables.push(mesa, mesaMaterial, horizonMaterial)
  const mesas = new HorizonRing(
    instancedField(mesa, horizonMaterial, ringPlacements(random, 30, 1500, 420, floorY, r => {
      const radius = 90 + r() * 200
      return new THREE.Vector3(radius, 40 + r() * 110, radius * (0.6 + r() * 0.6))
    })),
  )
  group.add(mesas.group)
  group.add(instancedField(mesa, mesaMaterial, scatterBeside(route, random, {
    spacing: 160, jitter: 80, minLateral: 260, maxLateral: 600, base: 'floor', floorY, density: 0.6,
    scale: r => new THREE.Vector3(50 + r() * 80, 30 + r() * 70, 40 + r() * 70),
  })))

  const panel = new THREE.BoxGeometry(1, 1, 1)
  const panelMaterial = new THREE.MeshStandardMaterial({ color: '#0a1830', roughness: 0.16, metalness: 0.9 })
  const frameMaterial = new THREE.MeshStandardMaterial({ color: '#2a2220', roughness: 0.7, metalness: 0.4 })
  disposables.push(panel, panelMaterial, frameMaterial)
  const panels: Placement[] = []
  const probe = new THREE.Vector3()
  const rowStep = Math.round(11 / Math.max(0.35, quality.propDensity))
  for (let d = route.minDist; d < route.maxDist; d += rowStep) {
    for (const side of [-1, 1] as const) {
      for (let column = 0; column < 7; column++) {
        const lateral = side * (22 + column * 9.5)
        route.flatPoint(d, lateral, probe)
        panels.push({
          position: new THREE.Vector3(probe.x, floorY + 2.4, probe.z),
          rotation: -route.headingAt(d),
          scale: new THREE.Vector3(8.2, 0.18, 4.2),
          random: random(),
          side,
          dist: d,
        })
      }
    }
  }
  const panelMesh = instancedField(panel, panelMaterial, panels)
  const tilt = new THREE.Matrix4()
  const matrix = new THREE.Matrix4()
  for (let i = 0; i < panelMesh.count; i++) {
    panelMesh.getMatrixAt(i, matrix)
    tilt.makeRotationX(-0.42)
    matrix.multiply(tilt)
    panelMesh.setMatrixAt(i, matrix)
  }
  group.add(panelMesh)
  group.add(instancedField(panel, frameMaterial, panels.filter((_, i) => i % 2 === 0).map(p => ({ ...p, position: p.position.clone().setY(floorY + 1.2), scale: new THREE.Vector3(0.3, 2.4, 0.3) }))))

  const towerGeometry = new THREE.CylinderGeometry(0.9, 1.8, 1, 10)
  towerGeometry.translate(0, 0.5, 0)
  const towerMaterial = new THREE.MeshStandardMaterial({ color: '#d9cbbd', roughness: 0.55, metalness: 0.2 })
  const blades = bladeGeometry()
  const tipLight = new THREE.OctahedronGeometry(0.9, 0)
  const tipMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.25, 0.25) })
  disposables.push(towerGeometry, towerMaterial, blades, tipLight, tipMaterial)
  const turbines = scatterBeside(route, random, {
    spacing: 85, jitter: 40, minLateral: 95, maxLateral: 260, base: 'floor', floorY, density: 0.85 * quality.propDensity + 0.15,
    scale: r => new THREE.Vector3(1, 58 + r() * 26, 1),
  })
  group.add(instancedField(towerGeometry, towerMaterial, turbines))
  const rotors = new THREE.InstancedMesh(blades, towerMaterial, Math.max(1, turbines.length))
  rotors.count = turbines.length
  rotors.frustumCulled = false
  group.add(rotors)
  const tips = instancedField(tipLight, tipMaterial, turbines.map(t => ({ ...t, position: t.position.clone().setY(t.position.y + t.scale.y + 2.2), scale: new THREE.Vector3(1, 1, 1) })))
  group.add(tips)
  const transform = new THREE.Object3D()

  const dust = createWeather('dust', Math.round(quality.weather * 0.5), '#ffb78a', random, route)
  group.add(dust.object)
  disposables.push(dust)

  return {
    update(frame: WorldFrame) {
      ground.update(frame.camera, frame.time)
      mesas.follow(frame.camera)
      dust.update(frame.camera, frame.dt, frame.dist)
      turbines.forEach((turbine, index) => {
        transform.position.copy(turbine.position).setY(turbine.position.y + turbine.scale.y + 0.4)
        transform.position.x += Math.sin(turbine.rotation) * 1.6
        transform.position.z += Math.cos(turbine.rotation) * 1.6
        transform.rotation.set(0, turbine.rotation + Math.PI, frame.time * (0.55 + turbine.random * 0.3) + index)
        transform.updateMatrix()
        rotors.setMatrixAt(index, transform.matrix)
      })
      rotors.instanceMatrix.needsUpdate = true
      tipMaterial.color.setRGB(3.2 * (0.25 + 0.75 * Math.max(0, Math.sin(frame.time * 1.6))), 0.22, 0.22)
    },
    dispose() {
      group.removeFromParent()
      for (const item of disposables) item.dispose()
      group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose()
      })
    },
  }
}

export const solarKit: WorldKit = { style: WORLD_STYLES.solar, build }
