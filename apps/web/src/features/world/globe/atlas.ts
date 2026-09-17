import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ATLAS_ROUTES, ATLAS_STATIONS } from '@nim-relay/shared'
import { arcPoints } from './geo'
import type { QualityTier } from './quality'
import { createPointCloud, markDirty, stationPoint, writePoint } from './routes'

/**
 * The Relay Atlas on the globe: every station as a marker and every route as one arc, merged into a single draw call.
 * Routes brighten with verified heat; dark routes stay a faint thread so the network reads before anyone raced it.
 */

export interface GlobeRouteHeat {
  lit: boolean
  /** 0..1 */
  heatLevel: number
}

export interface GlobeAtlas {
  routes: ReadonlyMap<string, GlobeRouteHeat>
  litStations: ReadonlySet<string>
}

export interface AtlasLayer {
  group: THREE.Group
  /** Points along each drawn route, for tap picking. */
  routePoints: { routeId: string; points: THREE.Vector3[] }[]
  update(time: number, motion: number): void
  dispose(): void
}

const STATION_GOLD = new THREE.Color('#ffc04d')
const STATION_DIM = new THREE.Color('#9fb2d6')
/** On the low tier only lit routes are drawn, at most this many, hottest first. */
const LOW_TIER_ROUTES = 24

const vertex = /* glsl */ `
  attribute float aHeat;
  attribute float aPhase;
  varying vec2 vUv;
  varying float vHeat;
  varying float vPhase;
  void main() {
    vUv = uv;
    vHeat = aHeat;
    vPhase = aPhase;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeat;
  varying float vPhase;
  void main() {
    float along = vUv.x;
    float ends = smoothstep(0.0, 0.06, along) * (1.0 - smoothstep(0.94, 1.0, along));
    float wave = fract(along * 2.0 - uTime * (0.08 + vHeat * 0.3) + vPhase);
    float pulse = smoothstep(0.7, 0.97, wave) * (1.0 - smoothstep(0.97, 1.0, wave)) * step(0.001, vHeat);
    vec3 dark = vec3(0.55, 0.64, 0.82);
    vec3 gold = vec3(1.0, 0.72, 0.28);
    vec3 color = mix(dark, gold, step(0.001, vHeat));
    float strength = (0.12 + vHeat * 0.75 + pulse * (0.4 + vHeat)) * ends;
    gl_FragColor = vec4(color, strength);
    #include <colorspace_fragment>
  }
`

export function buildAtlasLayer(atlas: GlobeAtlas | null, tier: QualityTier, pointMaterial: THREE.ShaderMaterial): AtlasLayer {
  const group = new THREE.Group()
  const heatOf = (routeId: string) => atlas?.routes.get(routeId)
  const candidates = ATLAS_ROUTES.map(route => ({ route, heat: heatOf(route.id) }))
  const drawn =
    tier.name === 'low'
      ? candidates
          .filter(entry => entry.heat?.lit)
          .sort((a, b) => (b.heat?.heatLevel ?? 0) - (a.heat?.heatLevel ?? 0))
          .slice(0, LOW_TIER_ROUTES)
      : candidates

  const tubes: THREE.BufferGeometry[] = []
  const routePoints: AtlasLayer['routePoints'] = []
  drawn.forEach(({ route, heat }, index) => {
    const from = stationPoint(route.from, 0.006)
    const to = stationPoint(route.to, 0.006)
    if (!from || !to) return
    const points = arcPoints(from, to, Math.max(16, Math.round(tier.arcSegments / 2)))
    routePoints.push({ routeId: route.id, points })
    const level = heat?.lit ? 0.25 + 0.75 * heat.heatLevel : 0
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length, heat?.lit ? 0.0048 : 0.0026, 4, false)
    const count = tube.getAttribute('position').count
    tube.setAttribute('aHeat', new THREE.Float32BufferAttribute(new Float32Array(count).fill(level), 1))
    tube.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Float32Array(count).fill((index * 0.61) % 1), 1))
    tubes.push(tube)
  })
  const merged = tubes.length > 0 ? mergeGeometries(tubes, false) : null
  for (const tube of tubes) tube.dispose()
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  if (merged) group.add(new THREE.Mesh(merged, material))

  const stations = createPointCloud(ATLAS_STATIONS.length, pointMaterial)
  let count = 0
  for (const station of ATLAS_STATIONS) {
    const point = stationPoint(station.id, 0.01)
    if (!point) continue
    const lit = atlas?.litStations.has(station.id) ?? false
    writePoint(stations.buffers, count++, point, lit ? STATION_GOLD : STATION_DIM, lit ? 16 : 12, 5, 0, lit ? 1 : 0)
  }
  markDirty(stations.geometry, count)
  group.add(stations.points)

  return {
    group,
    routePoints,
    update(time, motion) {
      material.uniforms.uTime!.value = time * motion
    },
    dispose() {
      merged?.dispose()
      material.dispose()
      stations.geometry.dispose()
      group.removeFromParent()
    },
  }
}
