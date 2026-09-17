import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { FRESH_BATON } from '../../baton/baton-appearance'
import { createCourier, type CourierAct, type CourierDrive } from '../scene/courier'
import { createSky } from '../scene/worlds/sky'
import { WORLD_STYLES } from '../scene/worlds/styles'

/**
 * Dev-only lineup of couriers in every act and v6 motion, under a world's lighting. Used to tune
 * poses and materials without a race:
 *
 *   /dev/leg?preview=courier&world=metro                  back row from the chase side, front row in profile
 *   /dev/leg?preview=courier&view=chase&pose=grind-right  one courier framed like the chase camera
 */

interface Pose {
  name: string
  act: CourierAct
  lateralVelocity: number
  airborne?: boolean
  sliding?: boolean
  motion?: relayLeg.Motion
  edgeSide?: -1 | 0 | 1
  laneShift?: number
  rush?: number
  shoulder?: number
  blaze?: number
  flow?: number
  /** Whole-body roll and pitch the scene adds while falling. */
  tumble?: readonly [number, number]
}

const POSES: readonly Pose[] = [
  { name: 'ride', act: 'ride', lateralVelocity: 0 },
  { name: 'lane-change', act: 'ride', lateralVelocity: 9, laneShift: 0.7 },
  { name: 'shoulder', act: 'ride', lateralVelocity: 0, shoulder: 1 },
  { name: 'grind-right', act: 'ride', lateralVelocity: 0, motion: 'grinding', edgeSide: 1 },
  { name: 'rush', act: 'ride', lateralVelocity: 0, rush: 1, blaze: 1, flow: 1 },
  { name: 'air', act: 'ride', lateralVelocity: 0, airborne: true },
  { name: 'slide', act: 'ride', lateralVelocity: 0, sliding: true },
  { name: 'falling', act: 'ride', lateralVelocity: 0, motion: 'falling', edgeSide: 1, tumble: [0.9, 0.5] },
  { name: 'tether', act: 'ride', lateralVelocity: 0, motion: 'tethering', edgeSide: 1 },
  { name: 'failed', act: 'failed', lateralVelocity: 0, motion: 'failed' },
  { name: 'prepare', act: 'prepare', lateralVelocity: 0 },
  { name: 'victory', act: 'victory', lateralVelocity: 0 },
]

export function CourierPreview({ world }: { world: relayLeg.World }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const params = new URLSearchParams(window.location.search)
    const chase = params.get('view') === 'chase'
    const focus = POSES.find(pose => pose.name === params.get('pose')) ?? POSES[0]!
    const shown = chase ? [focus] : POSES
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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: style.track.deck, roughness: 0.5 }))
    scene.add(floor)

    const rim = new THREE.Color(style.lighting.courierRim).multiplyScalar(0.55)
    const spacing = 1.6
    const couriers = shown.flatMap((pose, index) =>
      (chase ? [0] : [0, 1]).map(row => {
        const courier = createCourier({ baton: FRESH_BATON, rimColor: rim, castShadow: false })
        courier.group.position.set((index - (shown.length - 1) / 2) * spacing, 0.26, row === 0 ? -2.2 : 0.4)
        courier.group.rotation.set(pose.tumble?.[1] ?? 0, row === 0 ? 0 : -Math.PI / 2, pose.tumble?.[0] ?? 0, 'YXZ')
        scene.add(courier.group)
        return { courier, pose }
      }),
    )
    const camera = new THREE.PerspectiveCamera(chase ? 62 : 40, host.clientWidth / host.clientHeight, 0.1, 500)
    if (chase) {
      camera.position.set(0, 2.3, -2.2 + 5.5)
      camera.lookAt(0, 1.0, -2.2 - 4)
    } else {
      camera.position.set(0, 2.6, 12.5)
      camera.lookAt(0, 0.8, -0.8)
    }

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
          sliding: pose.sliding ?? false, stumbling: false, railing: false, flow: pose.flow ?? 0.6, events: 0, batonLift: 0,
          motion: pose.motion ?? 'riding', edgeSide: pose.edgeSide ?? 0, laneShift: pose.laneShift ?? 0, rush: pose.rush ?? 0,
          shoulder: pose.shoulder ?? 0, blaze: pose.blaze ?? 0,
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
