import * as THREE from 'three'
import type { StationKit } from '../kit'
import { COLOR } from '../palette'
import { createGlowMaterial } from '../shaders'
import { GROUND_Y } from './city'

export interface Transit {
  readonly object: THREE.Group
  tick(time: number, reducedMotion: boolean): void
}

interface Loop {
  centre: THREE.Vector3
  radiusX: number
  radiusZ: number
  wave: number
}

const LOOPS: readonly Loop[] = [
  { centre: new THREE.Vector3(20, -34, -250), radiusX: 260, radiusZ: 120, wave: 6 },
  { centre: new THREE.Vector3(-60, -12, -420), radiusX: 330, radiusZ: 140, wave: 10 },
]
const SAMPLES = 256
const POD_SPEED = 0.006

/** Pods gliding on unseen guideways through the city, and a beacon whose beams sweep the haze. */
export function createTransit(kit: StationKit): Transit {
  const object = new THREE.Group()
  object.name = 'transit'
  const lookup = LOOPS.map(sampleLoop)

  const podCount = kit.settings.pods
  const podGeometry = kit.track(new THREE.CapsuleGeometry(1.6, 9, 3, 8).rotateX(Math.PI / 2))
  const podMaterial = kit.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.055, 0.07) }))
  const pods = kit.track(new THREE.InstancedMesh(podGeometry, podMaterial, podCount))
  pods.frustumCulled = false
  object.add(pods)

  const glowPositions = new Float32Array(podCount * 3)
  const glowGeometry = kit.track(new THREE.BufferGeometry())
  glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3))
  const glowMaterial = kit.track(
    new THREE.PointsMaterial({ size: 26, map: kit.radial, color: COLOR.lamp, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  const glows = new THREE.Points(glowGeometry, glowMaterial)
  glows.frustumCulled = false
  object.add(glows)

  const beacon = createBeacon(kit)
  object.add(beacon.object)

  const eye = new THREE.Vector3()
  const ahead = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const up = new THREE.Vector3(0, 1, 0)
  const glowAttribute = glowGeometry.getAttribute('position')

  return {
    object,
    tick(time, reducedMotion) {
      const pace = reducedMotion ? 0.35 : 1
      for (let i = 0; i < podCount; i++) {
        const loopIndex = i % lookup.length
        const table = lookup[loopIndex]
        if (!table) continue
        const direction = loopIndex === 0 ? 1 : -1
        const phase = i / podCount + time * POD_SPEED * pace * direction * (1 + (i % 3) * 0.15)
        readLoop(table, phase, eye)
        readLoop(table, phase + direction * 0.004, ahead)
        matrix.lookAt(ahead, eye, up).setPosition(eye)
        pods.setMatrixAt(i, matrix)
        glowPositions[i * 3] = eye.x
        glowPositions[i * 3 + 1] = eye.y
        glowPositions[i * 3 + 2] = eye.z
      }
      pods.instanceMatrix.needsUpdate = true
      glowAttribute.needsUpdate = true
      beacon.tick(time, pace)
    },
  }
}

function sampleLoop(loop: Loop): Float32Array {
  const table = new Float32Array(SAMPLES * 3)
  for (let i = 0; i < SAMPLES; i++) {
    const angle = (i / SAMPLES) * Math.PI * 2
    table[i * 3] = loop.centre.x + Math.cos(angle) * loop.radiusX
    table[i * 3 + 1] = loop.centre.y + Math.sin(angle * 2) * loop.wave
    table[i * 3 + 2] = loop.centre.z + Math.sin(angle) * loop.radiusZ
  }
  return table
}

/** Position at `phase` (wrapping 0..1) along a sampled loop, linearly interpolated. */
function readLoop(table: Float32Array, phase: number, target: THREE.Vector3): void {
  const wrapped = ((phase % 1) + 1) % 1
  const exact = wrapped * SAMPLES
  const index = Math.floor(exact)
  const next = (index + 1) % SAMPLES
  const t = exact - index
  target.set(
    (table[index * 3] ?? 0) * (1 - t) + (table[next * 3] ?? 0) * t,
    (table[index * 3 + 1] ?? 0) * (1 - t) + (table[next * 3 + 1] ?? 0) * t,
    (table[index * 3 + 2] ?? 0) * (1 - t) + (table[next * 3 + 2] ?? 0) * t,
  )
}

function createBeacon(kit: StationKit): { object: THREE.Group; tick(time: number, pace: number): void } {
  const object = new THREE.Group()
  object.position.set(-96, 46, -620)

  const mast = new THREE.CylinderGeometry(0.8, 2.2, 30, 6).translate(0, -15, 0)
  kit.structure.add(mast, new THREE.Matrix4().makeTranslation(object.position.x, object.position.y, object.position.z))
  const towerHeight = object.position.y - 30 - GROUND_Y
  kit.structure.add(new THREE.BoxGeometry(16, towerHeight, 16), new THREE.Matrix4().makeTranslation(object.position.x, GROUND_Y + towerHeight / 2, object.position.z))

  const lampMaterial = kit.track(new THREE.SpriteMaterial({ map: kit.radial, color: new THREE.Color(2.2, 1.5, 0.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
  const lamp = new THREE.Sprite(lampMaterial)
  lamp.scale.setScalar(30)
  object.add(lamp)

  const beamLength = 520
  const beamGeometry = kit.track(new THREE.ConeGeometry(42, beamLength, 24, 1, true).translate(0, -beamLength / 2, 0))
  const haze = { ...kit.uniforms, uFogDensity: { value: 0.0009 } }
  const beamMaterial = kit.track(createGlowMaterial(haze, { color: COLOR.lamp, strength: 0.16, falloff: 2.2 }))
  const rotor = new THREE.Group()
  object.add(rotor)
  for (const side of [1, -1]) {
    const beam = new THREE.Mesh(beamGeometry, beamMaterial)
    beam.rotation.z = (side * Math.PI) / 2
    beam.rotation.x = -0.06
    beam.frustumCulled = false
    rotor.add(beam)
  }

  return {
    object,
    tick(time, pace) {
      rotor.rotation.y = time * 0.32 * pace
      lampMaterial.opacity = 0.75 + 0.25 * Math.sin(time * 2.1)
    },
  }
}
