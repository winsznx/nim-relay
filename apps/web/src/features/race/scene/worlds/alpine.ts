import * as THREE from 'three'
import { createCableway } from './cableway'
import { createGround, createWeather } from './atmosphere'
import {
  HorizonRing,
  hashString,
  instancedField,
  mountainGeometry,
  ringPlacements,
  scatterBeside,
  seededRandom,
} from './common'
import { WORLD_STYLES } from './styles'
import type { WorldContext, WorldFrame, WorldKit, WorldLayer } from './types'

/**
 * Cloudline Alps at blue hour: a skyway through a glacial valley. Layered
 * snow peaks, ridges rising beside the deck, pine forests far below, cable cars
 * crossing the valley and steady snowfall.
 */

function pineGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.ConeGeometry(0.5, 0.55, 7).translate(0, 0.45, 0),
    new THREE.ConeGeometry(0.4, 0.45, 7).translate(0, 0.7, 0),
    new THREE.ConeGeometry(0.28, 0.35, 7).translate(0, 0.92, 0),
    new THREE.CylinderGeometry(0.06, 0.08, 0.25, 5).translate(0, 0.12, 0),
  ]
  const colors = [new THREE.Color('#15231f'), new THREE.Color('#1a2a26'), new THREE.Color('#dfe7f0'), new THREE.Color('#2a1f18')]
  const positions: number[] = []
  const normals: number[] = []
  const vertexColors: number[] = []
  parts.forEach((part, index) => {
    const flat = part.toNonIndexed()
    flat.computeVertexNormals()
    const position = flat.getAttribute('position')
    const normal = flat.getAttribute('normal')
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i))
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i))
      const snowy = index === 2 || (index < 2 && position.getY(i) > 0.62 + index * 0.2)
      const color = snowy ? colors[2]! : colors[index]!
      vertexColors.push(color.r, color.g, color.b)
    }
    flat.dispose()
    part.dispose()
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3))
  return geometry
}

function build(context: WorldContext): WorldLayer {
  const { scene, route, quality, floorY } = context
  const random = seededRandom(hashString(`alpine:${route.track.finishDist}`))
  const group = new THREE.Group()
  group.name = 'world-alpine'
  scene.add(group)
  const disposables: { dispose(): void }[] = []

  const ground = createGround({ base: '#7f93b1', accent: '#d6e1ef', pattern: 'snow', lightColor: '#ffffff', lightStrength: 0 }, floorY)
  group.add(ground.mesh)
  disposables.push(ground)

  const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true })
  const horizonMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, fog: false })
  const farPeak = mountainGeometry(random, 0.5, '#2c3a55', '#b9c8de')
  const midPeak = mountainGeometry(random, 0.55, '#253043', '#e7eef7')
  const ridge = mountainGeometry(random, 0.78, '#1f2838', '#cfdbea')
  disposables.push(rockMaterial, horizonMaterial, farPeak, midPeak, ridge)

  const peaks = new HorizonRing(
    instancedField(farPeak, horizonMaterial, ringPlacements(random, 36, 1750, 360, floorY - 40, r => {
      const radius = 280 + r() * 240
      return new THREE.Vector3(radius, 220 + r() * 260, radius * (0.8 + r() * 0.4))
    })),
  )
  group.add(peaks.group)
  const mid = scatterBeside(route, random, {
    spacing: 140, jitter: 70, minLateral: 420, maxLateral: 820, base: 'floor', floorY: floorY - 20, density: 0.85,
    scale: r => {
      const radius = 150 + r() * 160
      return new THREE.Vector3(radius, 190 + r() * 220, radius * (0.8 + r() * 0.4))
    },
  })
  group.add(instancedField(midPeak, rockMaterial, mid))
  const ridges = scatterBeside(route, random, {
    spacing: 55, jitter: 30, minLateral: 95, maxLateral: 170, base: 'floor', floorY: floorY - 6, density: 0.8 * quality.propDensity + 0.2,
    scale: r => {
      const radius = 50 + r() * 45
      return new THREE.Vector3(radius, 70 + r() * 60, radius * (0.8 + r() * 0.5))
    },
  })
  group.add(instancedField(ridge, rockMaterial, ridges))

  const pine = pineGeometry()
  const pineMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  disposables.push(pine, pineMaterial)
  const pines = scatterBeside(route, random, {
    spacing: 7, jitter: 8, minLateral: 14, maxLateral: 90, base: 'floor', floorY, density: 0.8 * quality.propDensity,
    scale: r => {
      const height = 12 + r() * 16
      return new THREE.Vector3(height * 0.45, height, height * 0.45)
    },
  })
  group.add(instancedField(pine, pineMaterial, pines))

  const spans = []
  const deckY = route.point(0, 0, 0, new THREE.Vector3()).y
  for (let d = 150; d < route.maxDist; d += 420) {
    const from = route.flatPoint(d - 60, -150, new THREE.Vector3()).setY(deckY + 30)
    const to = route.flatPoint(d + 60, 150, new THREE.Vector3()).setY(deckY + 44)
    spans.push({ from, to })
  }
  const cableway = createCableway({
    spans, cabinsPerSpan: 2, speed: 9, towerDepth: 140, towerColor: '#3a4150', cabinColor: '#b3202c',
    lightColor: new THREE.Color(2.4, 2.0, 1.4), cableColor: new THREE.Color(0.9, 0.95, 1.1),
  })
  group.add(cableway.group)
  disposables.push(cableway)

  const snow = createWeather('snow', quality.weather, '#eef4ff', random, route)
  group.add(snow.object)
  disposables.push(snow)

  return {
    update(frame: WorldFrame) {
      ground.update(frame.camera, frame.time)
      peaks.follow(frame.camera)
      cableway.update(frame)
      snow.update(frame.camera, frame.dt, frame.dist)
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

export const alpineKit: WorldKit = { style: WORLD_STYLES.alpine, build }
