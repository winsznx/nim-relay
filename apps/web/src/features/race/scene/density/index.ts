import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { QualitySettings } from '../quality'
import type { Route } from '../route'
import { hashString, seededRandom, type WindowStyle } from '../worlds/common'
import { createBillboards, type BillboardSpec, type Billboards } from './billboards'
import { createMotes, type Motes } from './motes'
import { createSky, type Sky, type SkySpec } from './sky'
import { createSkyline, type Skyline } from './skyline'
import { SpritePool } from './sprites'
import { createTraffic, type RoadSpec, type Traffic } from './traffic'

/**
 * Life around the route: traffic on the roads below, aircraft, airships and
 * drones in the sky, animated billboards, drifting motes and a parallax
 * skyline. Each world picks its own mix; quality tiers drop the costliest
 * layers first; the low tier keeps only lights in the sky. All light points
 * share one sprite pool, so the whole layer draws in a handful of calls.
 */

interface Recipe {
  roads: readonly RoadSpec[]
  sky: SkySpec
  billboards: BillboardSpec | null
  motes: THREE.Color | null
  skyline: { count: number; radius: number; windows: WindowStyle } | null
}

const RECIPES: Readonly<Record<relayLeg.World, Recipe>> = {
  coast: {
    roads: [{ lateral: -52, height: 6, cars: 3.2, speed: 22 }, { lateral: 62, height: 9, cars: 2.4, speed: 26 }],
    sky: { planes: 3, airships: 1, drones: 12, screen: new THREE.Color(2.4, 1.3, 0.35) },
    billboards: { spacing: 120, minLateral: 58, maxLateral: 120, height: 14, palette: [new THREE.Color(2.2, 1.1, 0.35), new THREE.Color(1.9, 0.55, 0.5), new THREE.Color(0.45, 1.5, 1.7)] },
    motes: new THREE.Color(1.0, 0.72, 0.5),
    skyline: { count: 56, radius: 860, windows: { base: '#17151f', windowA: '#ffc98a', windowB: '#ffe3bd', lit: 0.2, floorHeight: 4.4, windowWidth: 3.6, intensity: 0.9, crown: 1.1, crownColor: '#ffb870' } },
  },
  metro: {
    roads: [{ lateral: -12, height: 14, cars: 4, speed: 24 }, { lateral: 13, height: 17, cars: 4, speed: 20 }],
    sky: { planes: 4, airships: 2, drones: 18, screen: new THREE.Color(0.7, 1.2, 2.6) },
    billboards: { spacing: 64, minLateral: 24, maxLateral: 70, height: 4, palette: [new THREE.Color(2.3, 0.35, 1.5), new THREE.Color(0.6, 0.9, 2.5), new THREE.Color(2.4, 1.3, 0.4)] },
    motes: null,
    skyline: null,
  },
  alpine: {
    roads: [{ lateral: -10, height: 0.6, cars: 0.8, speed: 14 }],
    sky: { planes: 2, airships: 0, drones: 0, screen: new THREE.Color(1, 1, 1) },
    billboards: null,
    motes: null,
    skyline: null,
  },
  solar: {
    roads: [{ lateral: 14, height: 0.6, cars: 1.2, speed: 30 }],
    sky: { planes: 2, airships: 1, drones: 8, screen: new THREE.Color(2.6, 1.2, 0.3) },
    billboards: null,
    motes: new THREE.Color(1.1, 0.62, 0.38),
    skyline: null,
  },
  ocean: {
    roads: [],
    sky: { planes: 2, airships: 0, drones: 6, screen: new THREE.Color(1, 1, 1) },
    billboards: null,
    motes: null,
    skyline: null,
  },
}

const SPRITES: Readonly<Record<QualitySettings['tier'], number>> = { low: 240, medium: 520, high: 900 }

export interface Density {
  update(time: number, courierDist: number): void
  dispose(): void
}

export function createDensity(scene: THREE.Scene, route: Route, world: relayLeg.World, quality: QualitySettings, floorY: number, camera: THREE.Camera, canvas: HTMLCanvasElement): Density {
  const recipe = RECIPES[world]
  const random = seededRandom(hashString(`density:${world}:${route.track.finishDist}`))
  const high = quality.tier === 'high'
  const low = quality.tier === 'low'
  const sprites = new SpritePool(SPRITES[quality.tier])
  scene.add(sprites.mesh)
  const traffic: Traffic | null = recipe.roads.length > 0 && !low ? createTraffic(route, recipe.roads, floorY, quality.propDensity, random) : null
  if (traffic) scene.add(traffic.mesh)
  const sky: Sky = createSky(route, low ? { ...recipe.sky, airships: 0, drones: Math.round(recipe.sky.drones / 3) } : recipe.sky, random)
  scene.add(sky.bodies)
  const billboards: Billboards | null = recipe.billboards && !low ? createBillboards(route, recipe.billboards, quality.propDensity, random) : null
  if (billboards) scene.add(billboards.mesh)
  const motes: Motes | null = recipe.motes && high ? createMotes(260, recipe.motes, random) : null
  if (motes) scene.add(motes.points)
  const skyline: Skyline | null = recipe.skyline && !low ? createSkyline(recipe.skyline.count, recipe.skyline.radius, floorY - 6, recipe.skyline.windows, random) : null
  if (skyline) scene.add(skyline.group)
  let lastTime: number | null = null

  return {
    update(time, courierDist) {
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime))
      lastTime = time
      sprites.begin(canvas.height)
      traffic?.update(time, courierDist, sprites)
      sky.update(time, camera.position, courierDist, sprites)
      sprites.end()
      billboards?.update(time)
      motes?.update(camera, dt)
      skyline?.update(camera)
    },
    dispose() {
      sprites.dispose()
      traffic?.dispose()
      sky.dispose()
      billboards?.dispose()
      motes?.dispose()
      skyline?.dispose()
    },
  }
}
