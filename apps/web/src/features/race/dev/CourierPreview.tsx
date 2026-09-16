import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { FRESH_BATON } from '../../baton/baton-appearance'
import { createCourier, type CourierAct, type CourierDrive } from '../scene/courier'
import { createSky } from '../scene/worlds/sky'
import { WORLD_STYLES } from '../scene/worlds/styles'

/**
 * Dev-only lineup of couriers in every act, seen from the chase camera's side
 * (back row) and in profile (front row), under a world's lighting. Used to tune
 * poses and materials: /dev/leg?preview=courier&world=metro
 */

interface Pose {
  act: CourierAct
  lateralVelocity: number
  airborne?: boolean
  sliding?: boolean
}

const POSES: readonly Pose[] = [
  { act: 'ride', lateralVelocity: 0 },
  { act: 'ride', lateralVelocity: 7 },
  { act: 'ride', lateralVelocity: 0, airborne: true },
  { act: 'ride', lateralVelocity: 0, sliding: true },
  { act: 'prepare', lateralVelocity: 0 },
  { act: 'victory', lateralVelocity: 0 },
]

export function CourierPreview({ world }: { world: relayLeg.World }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const style = WORLD_STYLES[world]
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(host.clientWidth, host.clientHeight)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = style.lighting.exposure
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const sky = createSky(style.sky)
    scene.add(sky.mesh)
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environmentScene = new THREE.Scene()
    const environmentSky = createSky(style.sky)
    environmentScene.add(environmentSky.mesh)
    scene.environment = pmrem.fromScene(environmentScene, 0.02).texture
    scene.environmentIntensity = style.lighting.environmentIntensity
    scene.add(new THREE.HemisphereLight(style.lighting.hemisphereSky, style.lighting.hemisphereGround, style.lighting.hemisphereIntensity))
    const key = new THREE.DirectionalLight(style.lighting.keyColor, style.lighting.keyIntensity)
    key.position.set(...style.lighting.keyDirection).multiplyScalar(20)
    scene.add(key)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: style.track.deck, roughness: 0.5 }))
    scene.add(floor)

    const rim = new THREE.Color(style.lighting.courierRim).multiplyScalar(0.55)
    const couriers = POSES.flatMap((pose, index) =>
      [0, 1].map(row => {
        const courier = createCourier({ baton: FRESH_BATON, rimColor: rim, castShadow: false })
        courier.group.position.set((index - (POSES.length - 1) / 2) * 1.5, 0.26, row === 0 ? -2.2 : 0.4)
        courier.group.rotation.y = row === 0 ? 0 : -Math.PI / 2
        scene.add(courier.group)
        return { courier, pose }
      }),
    )
    const camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.1, 500)
    camera.position.set(0, 2.4, 8.2)
    camera.lookAt(0, 0.8, -0.8)

    let raf = 0
    let last = performance.now()
    let time = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      time += dt
      for (const { courier, pose } of couriers) {
        const drive: CourierDrive = {
          time, dt, act: pose.act, actProgress: 0, lateralVelocity: pose.lateralVelocity, airborne: pose.airborne ?? false,
          sliding: pose.sliding ?? false, stumbling: false, railing: false, flow: 0.6, events: 0, batonLift: 0,
        }
        courier.update(drive)
      }
      sky.update(camera, time, 0)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      for (const { courier } of couriers) courier.dispose()
      sky.dispose()
      environmentSky.dispose()
      pmrem.dispose()
      floor.geometry.dispose()
      floor.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [world])

  return <div ref={hostRef} style={{ position: 'fixed', inset: 0 }} data-preview="courier" />
}
