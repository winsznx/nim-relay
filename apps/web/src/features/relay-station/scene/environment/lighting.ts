import * as THREE from 'three'
import type { StationKit } from '../kit'
import { PLACEMENT } from '../layout'
import { COLOR } from '../palette'

/**
 * Moonlight and sky fill for form, warm key light over the courier bay, and a
 * prefiltered night environment so metal and glass catch the station's lamps.
 */
export function createLighting(kit: StationKit, scene: THREE.Scene): void {
  const hemisphere = new THREE.HemisphereLight('#3b4d80', '#07090e', 0.6)
  scene.add(hemisphere)

  const moon = kit.track(new THREE.DirectionalLight('#a9bcff', 0.55))
  moon.position.set(-40, 70, 30)
  scene.add(moon)

  const bay = PLACEMENT.courier.position
  const key = kit.track(new THREE.SpotLight(COLOR.lamp, 38, 16, 0.55, 0.8, 1.6))
  key.position.set(bay.x + 0.6, 7.2, bay.z + 1.6)
  key.target.position.set(bay.x, 0.9, bay.z)
  if (kit.settings.shadows) {
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.camera.near = 2
    key.shadow.camera.far = 14
  }
  scene.add(key, key.target)

  if (kit.settings.tier !== 'low') {
    const lamps: readonly [THREE.Vector3, number][] = [
      [PLACEMENT.departures.position.clone().add(new THREE.Vector3(1.2, 3.8, 2.4)), 10],
      [PLACEMENT.vault.position.clone().add(new THREE.Vector3(-0.8, 3.2, 2.2)), 9],
      [PLACEMENT.world.position.clone().add(new THREE.Vector3(0, 5, 3)), 12],
    ]
    for (const [position, intensity] of lamps) {
      const lamp = kit.track(new THREE.PointLight(COLOR.lamp, intensity, 11, 1.7))
      lamp.position.copy(position)
      scene.add(lamp)
    }
  }

  if (kit.settings.environmentMap) {
    scene.environment = createNightEnvironment(kit)
    scene.environmentIntensity = 0.55
  }
}

function createNightEnvironment(kit: StationKit): THREE.Texture {
  const generator = new THREE.PMREMGenerator(kit.renderer)
  const room = new THREE.Scene()
  const disposables: { dispose(): void }[] = []

  const skyGeometry = new THREE.SphereGeometry(50, 24, 12)
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uTop: { value: new THREE.Color('#050a18') }, uHorizon: { value: new THREE.Color('#2b2440') } },
    vertexShader: 'varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDirection; void main() { float h = normalize(vDirection).y; gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.1, 0.6, h)) * step(-0.25, h), 1.0); }',
  })
  room.add(new THREE.Mesh(skyGeometry, skyMaterial))
  disposables.push(skyGeometry, skyMaterial)

  const panelGeometry = new THREE.PlaneGeometry(1, 1)
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.0, 0.9), side: THREE.DoubleSide })
  const cool = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.5, 0.9), side: THREE.DoubleSide })
  disposables.push(panelGeometry, warm, cool)
  const panels: readonly [THREE.Material, number, number, number, number, number][] = [
    [warm, 0, 22, 0, 18, 4],
    [warm, -30, 6, -20, 10, 2],
    [warm, 30, 5, -26, 14, 2],
    [warm, 0, 3, 34, 20, 1.5],
    [cool, -20, 30, 20, 16, 10],
  ]
  for (const [material, x, y, z, width, height] of panels) {
    const panel = new THREE.Mesh(panelGeometry, material)
    panel.position.set(x, y, z)
    panel.scale.set(width, height, 1)
    panel.lookAt(0, 0, 0)
    room.add(panel)
  }

  const target = generator.fromScene(room, 0.04)
  for (const resource of disposables) resource.dispose()
  generator.dispose()
  kit.track(target)
  return target.texture
}
