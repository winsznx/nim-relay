import * as THREE from 'three'
import { createWater, createWeather } from './atmosphere'
import {
  HorizonRing,
  hashString,
  instancedField,
  ringPlacements,
  scatterBeside,
  seededRandom,
  towerGeometry,
} from './common'
import { WORLD_STYLES } from './styles'
import type { WorldContext, WorldFrame, WorldKit, WorldLayer } from './types'

/**
 * Ocean Skyway by moonlight: a skyway over open water. A moon path on the
 * swell, floating platforms ringed with light, distant rigs on the horizon and
 * ships crossing slowly under a starfield.
 */

function hullGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-1, -0.5)
  shape.lineTo(1, -0.5)
  shape.lineTo(1.25, 0.5)
  shape.lineTo(-1.1, 0.5)
  shape.lineTo(-1, -0.5)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
  geometry.translate(0, 0, -0.5)
  geometry.rotateY(Math.PI / 2)
  return geometry
}

function build(context: WorldContext): WorldLayer {
  const { scene, route, quality, floorY } = context
  const random = seededRandom(hashString(`ocean:${route.track.finishDist}`))
  const group = new THREE.Group()
  group.name = 'world-ocean'
  scene.add(group)
  const disposables: { dispose(): void }[] = []
  const style = WORLD_STYLES.ocean

  const water = createWater({ deep: '#010810', shallow: '#07202e', sky: '#1d4557', glint: '#d8ecff', sunDirection: style.sky.sunDirection, waveScale: 0.07, glintStrength: 1.1 }, floorY)
  group.add(water.mesh)
  disposables.push(water)

  const pad = new THREE.CylinderGeometry(1, 1, 1, 6, 1)
  const padMaterial = new THREE.MeshStandardMaterial({ color: '#1a2a33', roughness: 0.6, metalness: 0.5 })
  const ring = new THREE.TorusGeometry(1, 0.02, 4, 6).rotateX(Math.PI / 2)
  const ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.2) })
  disposables.push(pad, padMaterial, ring, ringMaterial)
  const platforms = scatterBeside(route, random, {
    spacing: 90, jitter: 50, minLateral: 55, maxLateral: 320, base: 'floor', floorY: floorY + 1.2, density: 0.8 * quality.propDensity + 0.2,
    scale: r => {
      const radius = 12 + r() * 22
      return new THREE.Vector3(radius, 2.4, radius)
    },
  })
  group.add(instancedField(pad, padMaterial, platforms))
  group.add(instancedField(ring, ringMaterial, platforms.map(p => ({ ...p, position: p.position.clone().setY(p.position.y + 1.25), scale: new THREE.Vector3(p.scale.x * 0.96, 1, p.scale.z * 0.96) }))))

  const box = towerGeometry()
  const rigMaterial = new THREE.MeshBasicMaterial({ color: '#07111a', fog: false })
  const rigLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.8), fog: false })
  disposables.push(box, rigMaterial, rigLight)
  const rigPlacements = ringPlacements(random, 18, 1250, 400, floorY, r => new THREE.Vector3(26 + r() * 30, 40 + r() * 70, 26 + r() * 30))
  const rigs = new HorizonRing(instancedField(box, rigMaterial, rigPlacements))
  rigs.group.add(instancedField(box, rigLight, rigPlacements.map(p => ({ ...p, position: p.position.clone().setY(p.position.y + p.scale.y), scale: new THREE.Vector3(p.scale.x * 1.05, 1.2, p.scale.z * 1.05) }))))
  group.add(rigs.group)

  const hull = hullGeometry()
  const hullMaterial = new THREE.MeshStandardMaterial({ color: '#232b33', roughness: 0.5, metalness: 0.4 })
  const cabinLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.4) })
  disposables.push(hull, hullMaterial, cabinLight)
  const ships = Array.from({ length: 7 }, (_, i) => ({
    lateral: (i % 2 === 0 ? -1 : 1) * (160 + random() * 260),
    offset: random() * 1200,
    speed: 4 + random() * 5,
    length: 40 + random() * 50,
  }))
  const hulls = new THREE.InstancedMesh(hull, hullMaterial, ships.length)
  const cabins = new THREE.InstancedMesh(box, cabinLight, ships.length)
  for (const mesh of [hulls, cabins]) {
    mesh.frustumCulled = false
    group.add(mesh)
  }
  const transform = new THREE.Object3D()
  const buoyGeometry = new THREE.OctahedronGeometry(0.6, 0)
  const buoyMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0) })
  disposables.push(buoyGeometry, buoyMaterial)
  group.add(instancedField(buoyGeometry, buoyMaterial, scatterBeside(route, random, {
    spacing: 45, jitter: 20, minLateral: 22, maxLateral: 48, base: 'floor', floorY: floorY + 1.5, density: 0.8,
    scale: () => new THREE.Vector3(1, 1.6, 1),
  })))

  const mist = createWeather('spray', Math.round(quality.weather * 0.4), '#9fc8e0', random, route)
  group.add(mist.object)
  disposables.push(mist)

  return {
    update(frame: WorldFrame) {
      water.update(frame.camera, frame.time)
      rigs.follow(frame.camera)
      mist.update(frame.camera, frame.dt, frame.dist)
      ships.forEach((ship, index) => {
        const d = frame.dist - 400 + ((ship.offset + frame.time * ship.speed) % 1200)
        route.flatPoint(d, ship.lateral, transform.position)
        transform.position.y = floorY + 2
        transform.rotation.set(0, -route.headingAt(d), 0)
        transform.scale.set(ship.length * 0.12, 5, ship.length)
        transform.updateMatrix()
        hulls.setMatrixAt(index, transform.matrix)
        transform.position.y = floorY + 4.5
        transform.scale.set(ship.length * 0.1, 3.2, ship.length * 0.3)
        transform.updateMatrix()
        cabins.setMatrixAt(index, transform.matrix)
      })
      hulls.instanceMatrix.needsUpdate = true
      cabins.instanceMatrix.needsUpdate = true
      buoyMaterial.color.setScalar(0.6 + 1.8 * Math.max(0, Math.sin(frame.time * 2.4)))
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

export const oceanKit: WorldKit = { style: WORLD_STYLES.ocean, build }
