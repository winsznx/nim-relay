import * as THREE from 'three'
import type { Route } from '../route'
import type { SpritePool } from './sprites'

/**
 * Sky life that follows the camera: airliners crossing high with navigation
 * lights and strobes, slow airships with a glowing belly screen, and flocks of
 * delivery drones blinking over the route. Paths are deterministic loops, so
 * nothing spawns or allocates while the leg runs.
 */

export interface SkySpec {
  planes: number
  airships: number
  drones: number
  /** Belly screen colour of the airships. */
  screen: THREE.Color
}

const PLANE_ALTITUDE = 260
const PLANE_SPAN = 2400
const AIRSHIP_ALTITUDE = 120
const AIRSHIP_SPAN = 900
const NAV_RED = new THREE.Color(3.2, 0.2, 0.2)
const NAV_GREEN = new THREE.Color(0.3, 3, 0.8)
const STROBE = new THREE.Color(4, 4, 4)
const DRONE_LIGHT = new THREE.Color(2.4, 1.8, 1.1)
const HULL = new THREE.Color('#15171d')

interface Flight {
  angle: number
  offset: number
  speed: number
  altitude: number
  side: number
}

export interface Sky {
  bodies: THREE.InstancedMesh
  update(time: number, camera: THREE.Vector3, dist: number, sprites: SpritePool): void
  dispose(): void
}

function flights(count: number, random: () => number, altitude: number, speed: number): Flight[] {
  return Array.from({ length: count }, () => ({
    angle: random() * Math.PI * 2,
    offset: random(),
    speed: speed * (0.8 + random() * 0.4),
    altitude: altitude * (0.85 + random() * 0.4),
    side: (random() - 0.5) * 600,
  }))
}

export function createSky(route: Route, spec: SkySpec, random: () => number): Sky {
  const planes = flights(spec.planes, random, PLANE_ALTITUDE, 70)
  const airships = flights(spec.airships, random, AIRSHIP_ALTITUDE, 9)
  const drones = Array.from({ length: spec.drones }, () => ({ radius: 14 + random() * 30, height: 22 + random() * 36, phase: random() * Math.PI * 2, rate: 0.12 + random() * 0.18, ahead: 40 + random() * 280, lateral: (random() - 0.5) * 160, blink: random() }))
  const geometry = new THREE.SphereGeometry(1, 16, 10)
  const material = new THREE.MeshStandardMaterial({ color: HULL, roughness: 0.6, metalness: 0.3 })
  const bodies = new THREE.InstancedMesh(geometry, material, Math.max(1, airships.length))
  bodies.name = 'density-airships'
  bodies.frustumCulled = false
  bodies.count = airships.length
  bodies.visible = airships.length > 0
  const transform = new THREE.Object3D()
  const screen = new THREE.Color()
  const position = new THREE.Vector3()

  const along = (flight: Flight, span: number, time: number, camera: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => {
    const travel = ((flight.offset + (time * flight.speed) / span) % 1) - 0.5
    const cos = Math.cos(flight.angle)
    const sin = Math.sin(flight.angle)
    return out.set(camera.x + cos * travel * span - sin * flight.side, flight.altitude, camera.z + sin * travel * span + cos * flight.side)
  }

  return {
    bodies,
    update(time, camera, dist, sprites) {
      for (const plane of planes) {
        along(plane, PLANE_SPAN, time, camera, position)
        const cos = Math.cos(plane.angle)
        const sin = Math.sin(plane.angle)
        sprites.add(position.x - sin * 14, position.y, position.z + cos * 14, 2.2, NAV_RED)
        sprites.add(position.x + sin * 14, position.y, position.z - cos * 14, 2.2, NAV_GREEN)
        if ((time + plane.offset * 3) % 1.2 < 0.12) sprites.add(position.x - cos * 12, position.y + 1, position.z - sin * 12, 4, STROBE)
      }
      for (let index = 0; index < airships.length; index++) {
        const ship = airships[index]!
        along(ship, AIRSHIP_SPAN, time, camera, position)
        transform.position.copy(position)
        transform.rotation.set(0, -ship.angle, 0)
        transform.scale.set(28, 7, 7)
        transform.updateMatrix()
        bodies.setMatrixAt(index, transform.matrix)
        const cos = Math.cos(ship.angle)
        const sin = Math.sin(ship.angle)
        for (let k = 0; k < 7; k++) {
          const t = (k - 3) * 3.4
          const wave = 0.5 + 0.5 * Math.sin(time * 2 - k * 0.9)
          screen.copy(spec.screen).multiplyScalar(0.35 + wave)
          sprites.add(position.x + cos * t, position.y - 6.4, position.z + sin * t, 2.4, screen)
        }
        sprites.add(position.x - cos * 28, position.y, position.z - sin * 28, 2, (time * 0.8 + ship.offset) % 1 < 0.5 ? NAV_RED : STROBE)
      }
      if (airships.length > 0) bodies.instanceMatrix.needsUpdate = true
      for (const drone of drones) {
        const angle = drone.phase + time * drone.rate * Math.PI * 2
        route.flatPoint(dist + drone.ahead, drone.lateral, position)
        const on = (time * 1.4 + drone.blink) % 1 < 0.25
        sprites.add(position.x + Math.cos(angle) * drone.radius, position.y + drone.height + Math.sin(time + drone.phase) * 2, position.z + Math.sin(angle) * drone.radius, on ? 1.1 : 0.6, on ? NAV_RED : DRONE_LIGHT)
      }
    },
    dispose() {
      bodies.removeFromParent()
      bodies.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}
