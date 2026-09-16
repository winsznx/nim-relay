import * as THREE from 'three'
import { createCableway } from './cableway'
import { createWater } from './atmosphere'
import {
  HorizonRing,
  createWindowMaterial,
  hashString,
  instancedField,
  mountainGeometry,
  ringPlacements,
  scatterBeside,
  seededRandom,
  towerGeometry,
} from './common'
import { WORLD_STYLES } from './styles'
import type { WorldContext, WorldFrame, WorldKit, WorldLayer } from './types'

/**
 * Sunbreak Coast: a skyway over the sea just after sunset. Molten horizon,
 * a long glint path on the water, dark headlands, slim harbour towers and a
 * suspended harbour line gliding beside the route.
 */

function build(context: WorldContext): WorldLayer {
  const { scene, route, quality, floorY } = context
  const random = seededRandom(hashString(`coast:${route.track.finishDist}`))
  const group = new THREE.Group()
  group.name = 'world-coast'
  scene.add(group)
  const disposables: { dispose(): void }[] = []
  const style = WORLD_STYLES.coast

  const water = createWater({ deep: '#07142a', shallow: '#132a44', sky: '#c9714e', glint: '#ffc38a', sunDirection: style.sky.sunDirection, waveScale: 0.09, glintStrength: 1.3 }, floorY)
  group.add(water.mesh)
  disposables.push(water)

  const rock = mountainGeometry(random, 2, '#1a1622', '#1a1622')
  const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true })
  const horizonMaterial = new THREE.MeshBasicMaterial({ color: '#1c1426', fog: false })
  disposables.push(rock, rockMaterial, horizonMaterial)
  const headlands = new HorizonRing(
    instancedField(rock, horizonMaterial, ringPlacements(random, 26, 1500, 380, floorY - 4, r => new THREE.Vector3(160 + r() * 260, 40 + r() * 110, 120 + r() * 220))),
  )
  group.add(headlands.group)
  const islands = scatterBeside(route, random, {
    spacing: 120, jitter: 60, minLateral: 180, maxLateral: 520, base: 'floor', floorY: floorY - 2, density: 0.7,
    scale: r => new THREE.Vector3(40 + r() * 90, 18 + r() * 60, 40 + r() * 80),
  })
  group.add(instancedField(rock, rockMaterial, islands))

  const box = towerGeometry()
  const facade = createWindowMaterial({ base: '#1d1f2a', windowA: '#ffcf92', windowB: '#ffe9c6', lit: 0.26, floorHeight: 3.8, windowWidth: 3.2, intensity: 1.25, crown: 1.8, crownColor: '#ffd9a6' })
  disposables.push(box, facade)
  const towers = scatterBeside(route, random, {
    spacing: 70, jitter: 40, minLateral: 70, maxLateral: 240, base: 'floor', floorY, density: 0.75 * quality.propDensity + 0.15,
    scale: r => {
      const width = 9 + r() * 10
      return new THREE.Vector3(width, 70 + r() * 120, width * (0.8 + r() * 0.4))
    },
  })
  group.add(instancedField(box, facade, towers))

  const pierMaterial = new THREE.MeshStandardMaterial({ color: '#232734', roughness: 0.8, metalness: 0.2 })
  disposables.push(pierMaterial)
  group.add(instancedField(box, pierMaterial, towers.map(tower => ({ ...tower, scale: new THREE.Vector3(tower.scale.x * 2.2, 4, tower.scale.z * 2.2), position: tower.position.clone().setY(floorY - 1) }))))

  const spans = []
  const deckY = route.point(0, 0, 0, new THREE.Vector3()).y
  for (let d = -40; d < route.maxDist - 90; d += 150) {
    const from = route.flatPoint(d, -34, new THREE.Vector3()).setY(deckY + 22 + Math.sin(d * 0.01) * 4)
    const to = route.flatPoint(d + 150, -34, new THREE.Vector3()).setY(deckY + 22 + Math.sin((d + 150) * 0.01) * 4)
    spans.push({ from, to })
  }
  const cableway = createCableway({
    spans, cabinsPerSpan: 2, speed: 16, towerDepth: 90, towerColor: '#2a2d38', cabinColor: '#d9d4c9',
    lightColor: new THREE.Color(2.6, 2.0, 1.3), cableColor: new THREE.Color(1.2, 0.95, 0.7),
  })
  group.add(cableway.group)
  disposables.push(cableway)

  return {
    update(frame: WorldFrame) {
      water.update(frame.camera, frame.time)
      headlands.follow(frame.camera)
      cableway.update(frame)
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

export const coastKit: WorldKit = { style: WORLD_STYLES.coast, build }
