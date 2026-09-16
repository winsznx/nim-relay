import * as THREE from 'three'
import { createGround, createWeather } from './atmosphere'
import {
  HorizonRing,
  createWindowMaterial,
  hashString,
  instancedField,
  ringPlacements,
  scatterBeside,
  seededRandom,
  towerGeometry,
  type Placement,
} from './common'
import { WORLD_STYLES } from './styles'
import type { WorldContext, WorldFrame, WorldKit, WorldLayer } from './types'

/**
 * Midnight Metro: a skyway threaded through a dense city in the rain. Warm
 * sodium streets far below, lit towers climbing past the deck, transit lines
 * running beneath it, and a few restrained vertical signs.
 */

const CORRIDOR = 17

function build(context: WorldContext): WorldLayer {
  const { scene, route, quality, floorY } = context
  const random = seededRandom(hashString(`metro:${route.track.finishDist}:${route.track.segments.length}`))
  const group = new THREE.Group()
  group.name = 'world-metro'
  scene.add(group)
  const disposables: { dispose(): void }[] = []
  const box = towerGeometry()
  disposables.push(box)

  const ground = createGround({ base: '#06070b', accent: '#10131b', pattern: 'grid', lightColor: '#ff9a3c', lightStrength: 0.85 }, floorY)
  group.add(ground.mesh)
  disposables.push(ground)

  const nearFacade = createWindowMaterial({ base: '#0b0e15', windowA: '#ffd49a', windowB: '#a9c2ff', lit: 0.3, floorHeight: 3.6, windowWidth: 2.8, intensity: 1.45, crown: 1.6, crownColor: '#ffcf8f' })
  const farFacade = createWindowMaterial({ base: '#090b12', windowA: '#ffc98a', windowB: '#8fa9e6', lit: 0.16, floorHeight: 4.2, windowWidth: 3.4, intensity: 1.1, crown: 1.2, crownColor: '#ffb86e' })
  const skylineFacade = createWindowMaterial({ base: '#06070c', windowA: '#d8a066', windowB: '#6f86b8', lit: 0.12, floorHeight: 4.6, windowWidth: 3.8, intensity: 0.7, crown: 0.8, crownColor: '#ffb86e' })
  skylineFacade.fog = false
  disposables.push(nearFacade, farFacade, skylineFacade)

  const near = scatterBeside(route, random, {
    spacing: 22, jitter: 10, minLateral: CORRIDOR + 6, maxLateral: 95, base: 'floor', floorY, density: 0.95 * quality.propDensity + 0.05,
    scale: (r, _side, lateral) => {
      const maxWidth = Math.max(6, (lateral - CORRIDOR) * 2)
      return new THREE.Vector3(Math.min(maxWidth, 9 + r() * 18), 34 + r() * r() * 150, Math.min(26, 10 + r() * 16))
    },
  })
  const mid = scatterBeside(route, random, {
    spacing: 34, jitter: 18, minLateral: 110, maxLateral: 280, base: 'floor', floorY, density: 0.9 * quality.propDensity + 0.1,
    scale: r => new THREE.Vector3(16 + r() * 26, 70 + r() * r() * 240, 16 + r() * 22),
  })
  group.add(instancedField(box, nearFacade, near))
  group.add(instancedField(box, farFacade, mid))

  const horizon = new HorizonRing(
    instancedField(box, skylineFacade, ringPlacements(random, Math.round(90 * quality.propDensity) + 20, 1150, 260, floorY - 10, r => new THREE.Vector3(30 + r() * 50, 140 + r() * r() * 360, 30 + r() * 40))),
  )
  group.add(horizon.group)

  const detail = quality.tier !== 'low'
  const tall = detail ? [...near, ...mid].filter(placement => placement.position.y + placement.scale.y > floorY + 110).slice(0, 60) : []
  const beaconGeometry = new THREE.OctahedronGeometry(0.9, 0)
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.25, 0.25) })
  disposables.push(beaconGeometry, beaconMaterial)
  const beacons = instancedField(beaconGeometry, beaconMaterial, tall.map(placement => ({ ...placement, position: placement.position.clone().setY(placement.position.y + placement.scale.y + 1.5), scale: new THREE.Vector3(1, 1, 1) })))
  if (detail) group.add(beacons)

  const signGeometry = new THREE.PlaneGeometry(1, 1)
  const signMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  disposables.push(signGeometry, signMaterial)
  const signPalette = [new THREE.Color(1.35, 1.2, 0.95), new THREE.Color(1.0, 1.12, 1.35), new THREE.Color(1.25, 0.3, 0.26), new THREE.Color(1.2, 0.72, 0.3)]
  const signs: Placement[] = near
    .filter((_, index) => detail && index % 5 === 2)
    .map(placement => {
      const heading = placement.rotation
      const towardTrack = -placement.side * (placement.scale.x / 2 + 0.6)
      const offset = new THREE.Vector3(Math.cos(-heading) * towardTrack, 0, Math.sin(-heading) * towardTrack)
      return {
        ...placement,
        position: placement.position.clone().add(offset).setY(floorY + Math.min(placement.scale.y * 0.75, 60)),
        rotation: heading,
        scale: new THREE.Vector3(1.6, 8 + placement.random * 7, 1),
      }
    })
  if (detail) group.add(instancedField(signGeometry, signMaterial, signs, (placement, out) => out.copy(signPalette[Math.floor(placement.random * signPalette.length)]!)))

  const transit = createTransit(context, box, random)
  group.add(transit.group)
  disposables.push(transit)

  const rain = createWeather('rain', quality.weather, '#9db3d6', random, route)
  group.add(rain.object)
  disposables.push(rain)

  return {
    update(frame: WorldFrame) {
      ground.update(frame.camera, frame.time)
      horizon.follow(frame.camera)
      rain.update(frame.camera, frame.dt, frame.dist)
      transit.update(frame)
      beaconMaterial.color.setRGB(3.2 * (0.3 + 0.7 * Math.max(0, Math.sin(frame.time * 2.2))), 0.2, 0.22)
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

interface Transit {
  group: THREE.Group
  update(frame: WorldFrame): void
  dispose(): void
}

/** Two elevated lines beneath the skyway with lit trains running in both directions. */
function createTransit(context: WorldContext, box: THREE.BufferGeometry, random: () => number): Transit {
  const { route, floorY } = context
  const group = new THREE.Group()
  const lines = [
    { lateral: -34, height: floorY + 24, speed: 34, direction: 1 },
    { lateral: 46, height: floorY + 30, speed: 29, direction: -1 },
  ]
  const deckMaterial = new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.7, metalness: 0.3 })
  const railLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.9, 0.5) })
  const carMaterial = createWindowMaterial({ base: '#1a1d26', windowA: '#ffe3b8', windowB: '#ffd9a8', lit: 0.92, floorHeight: 1.7, windowWidth: 1.5, intensity: 2.2 })
  const viaduct: Placement[] = []
  const lights: Placement[] = []
  const probe = new THREE.Vector3()
  for (const line of lines) {
    for (let d = route.minDist; d < route.maxDist; d += 24) {
      route.flatPoint(d + 12, line.lateral, probe)
      const rotation = -route.headingAt(d + 12)
      viaduct.push({ position: new THREE.Vector3(probe.x, line.height - 1.6, probe.z), rotation, scale: new THREE.Vector3(6, 1.4, 24.2), random: random(), side: 1, dist: d })
      lights.push({ position: new THREE.Vector3(probe.x, line.height - 0.12, probe.z), rotation, scale: new THREE.Vector3(5.2, 0.08, 24.2), random: random(), side: 1, dist: d })
    }
  }
  group.add(instancedField(box, deckMaterial, viaduct))
  group.add(instancedField(box, railLight, lights))

  const carsPerTrain = 5
  const trains = lines.flatMap((line, lineIndex) => [0, 1].map(k => ({ line, offset: k * 380 + lineIndex * 170 })))
  const cars = new THREE.InstancedMesh(box, carMaterial, trains.length * carsPerTrain)
  cars.frustumCulled = false
  group.add(cars)
  const transform = new THREE.Object3D()
  const span = 900

  return {
    group,
    update(frame) {
      let index = 0
      for (const train of trains) {
        const travel = (frame.time * train.line.speed * train.line.direction + train.offset) % span
        const head = frame.dist - span / 2 + ((travel + span) % span)
        for (let c = 0; c < carsPerTrain; c++) {
          const d = head - c * 19 * train.line.direction
          route.flatPoint(d, train.line.lateral, transform.position)
          transform.position.y = train.line.height
          transform.rotation.set(0, -route.headingAt(d), 0)
          transform.scale.set(3.1, 3.4, 18)
          transform.updateMatrix()
          cars.setMatrixAt(index++, transform.matrix)
        }
      }
      cars.instanceMatrix.needsUpdate = true
    },
    dispose() {
      deckMaterial.dispose()
      railLight.dispose()
      carMaterial.dispose()
      cars.dispose()
    },
  }
}

export const metroKit: WorldKit = { style: WORLD_STYLES.metro, build }
