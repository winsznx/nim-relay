import * as THREE from 'three'
import { MeshBuilder } from '../mesh-builder'
import type { Route } from '../route'
import type { SpritePool } from './sprites'

/**
 * Roads beside and below the skyway with traffic streaming both ways: the road
 * decks, lane dashes and street lamps are one static mesh for the whole route,
 * and the cars are pairs of lamps in the shared sprite pool, recycled through a
 * window that travels with the courier, so traffic never runs out or allocates.
 */

export interface RoadSpec {
  /** Lateral offset of the road's centre from the route centre line, metres. */
  lateral: number
  /** Height of the road above the world floor, metres. */
  height: number
  /** Cars per 100 m in each direction at full prop density. */
  cars: number
  /** Metres per second. */
  speed: number
}

const WINDOW_BEHIND = 180
const WINDOW = 720
const LANE_OFFSET = 3.4
const LAMP_SPACING = 32
const HEADLIGHT = new THREE.Color(2.4, 2.15, 1.75)
const TAILLIGHT = new THREE.Color(2.6, 0.16, 0.1)
const ROAD = new THREE.Color('#0d0f14')
const DASH = new THREE.Color(0.32, 0.3, 0.26)
const STREET_LAMP = new THREE.Color(2.6, 1.7, 0.8)
/** Lamp offsets across a car. */
const LAMPS = [-0.8, 0.8] as const

interface Car {
  road: RoadSpec
  direction: -1 | 1
  offset: number
  pace: number
}

export interface Traffic {
  mesh: THREE.Mesh
  update(time: number, dist: number, sprites: SpritePool): void
  dispose(): void
}

export function createTraffic(route: Route, roads: readonly RoadSpec[], floorY: number, density: number, random: () => number): Traffic {
  const builder = new MeshBuilder()
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const
  for (const road of roads) {
    const y = floorY + road.height
    const half = LANE_OFFSET * 2
    for (let d = route.minDist; d < route.maxDist; d += 8) {
      const e = Math.min(route.maxDist, d + 8)
      const corner = (i: 0 | 1 | 2 | 3, at: number, offset: number): THREE.Vector3 => route.flatPoint(at, road.lateral + offset, p[i]).setY(y)
      builder.quad(corner(0, d, -half), corner(1, d, half), corner(2, e, half), corner(3, e, -half), ROAD)
      if (Math.round(d / 8) % 2 === 0) {
        for (const lane of [-LANE_OFFSET, 0, LANE_OFFSET]) builder.quad(corner(0, d, lane - 0.08), corner(1, d, lane + 0.08), corner(2, d + 3, lane + 0.08), corner(3, d + 3, lane - 0.08), DASH)
      }
    }
    for (let d = Math.ceil(route.minDist / LAMP_SPACING) * LAMP_SPACING; d < route.maxDist; d += LAMP_SPACING) {
      for (const side of [-1, 1] as const) {
        const lateral = road.lateral + side * (half + 0.6)
        const size = 0.5
        builder.quad(
          route.flatPoint(d - size, lateral, p[0]).setY(y + 6.8), route.flatPoint(d + size, lateral, p[1]).setY(y + 6.8),
          route.flatPoint(d + size, lateral, p[2]).setY(y + 7.2), route.flatPoint(d - size, lateral, p[3]).setY(y + 7.2), STREET_LAMP,
        )
      }
    }
  }
  const geometry = builder.build()
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'density-roads'
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false

  const cars: Car[] = []
  for (const road of roads) {
    const count = Math.round((road.cars * density * WINDOW) / 100)
    for (const direction of [-1, 1] as const) {
      for (let i = 0; i < count; i++) cars.push({ road, direction, offset: random() * WINDOW, pace: 0.8 + random() * 0.4 })
    }
  }
  const probe = new THREE.Vector3()

  return {
    mesh,
    update(time, dist, sprites) {
      const start = dist - WINDOW_BEHIND
      for (const car of cars) {
        const worldDist = car.offset + car.direction * car.road.speed * car.pace * time
        const d = start + ((((worldDist - start) % WINDOW) + WINDOW) % WINDOW)
        const lane = car.road.lateral + car.direction * LANE_OFFSET * 0.5
        const color = car.direction === -1 ? HEADLIGHT : TAILLIGHT
        const y = floorY + car.road.height + 0.7
        for (const lamp of LAMPS) {
          route.flatPoint(d, lane + lamp, probe)
          sprites.add(probe.x, y, probe.z, 0.55, color)
        }
      }
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
