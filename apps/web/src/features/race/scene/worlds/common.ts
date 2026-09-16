import * as THREE from 'three'
import type { Route } from '../route'

/**
 * Building blocks shared by the world kits: deterministic scattering beside the
 * route, instanced prop fields, lit-window facades, far horizon rings, water
 * and ground planes, and weather. Everything is procedural and texture-free.
 */

export type Random = () => number

export function seededRandom(seed: number): Random {
  let state = seed >>> 0 || 7
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export interface Placement {
  position: THREE.Vector3
  rotation: number
  scale: THREE.Vector3
  random: number
  side: -1 | 1
  dist: number
}

export interface ScatterOptions {
  spacing: number
  jitter: number
  minLateral: number
  maxLateral: number
  /** Height of the placement: 'floor' uses `floorY`, a number is an offset from the route ground. */
  base: 'floor' | number
  floorY: number
  density: number
  sides?: readonly (-1 | 1)[]
  from?: number
  to?: number
  scale: (random: Random, side: -1 | 1, lateral: number) => THREE.Vector3
}

/** Deterministic placements on both sides of the route, never inside the route corridor. */
export function scatterBeside(route: Route, random: Random, options: ScatterOptions): Placement[] {
  const placements: Placement[] = []
  const from = options.from ?? route.minDist
  const to = options.to ?? route.maxDist
  const sides = options.sides ?? [-1, 1]
  const probe = new THREE.Vector3()
  for (let d = from; d < to; d += options.spacing) {
    for (const side of sides) {
      if (random() > options.density) continue
      const along = d + (random() - 0.5) * options.jitter
      const lateral = side * (options.minLateral + random() * (options.maxLateral - options.minLateral))
      route.flatPoint(along, lateral, probe)
      const y = options.base === 'floor' ? options.floorY : route.point(along, 0, 0, new THREE.Vector3()).y + options.base
      placements.push({
        position: new THREE.Vector3(probe.x, y, probe.z),
        rotation: -route.headingAt(along) + (random() - 0.5) * 0.3,
        scale: options.scale(random, side, Math.abs(lateral)),
        random: random(),
        side,
        dist: along,
      })
    }
  }
  return placements
}

export function instancedField(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly Placement[],
  color?: (placement: Placement, out: THREE.Color) => THREE.Color,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length))
  mesh.count = placements.length
  const transform = new THREE.Object3D()
  const tint = new THREE.Color()
  placements.forEach((placement, index) => {
    transform.position.copy(placement.position)
    transform.rotation.set(0, placement.rotation, 0)
    transform.scale.copy(placement.scale)
    transform.updateMatrix()
    mesh.setMatrixAt(index, transform.matrix)
    if (color) mesh.setColorAt(index, color(placement, tint))
  })
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  return mesh
}

/** Unit box standing on its base (0..1 in Y). */
export function towerGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
}

export interface WindowStyle {
  base: string
  windowA: string
  windowB: string
  /** Share of windows lit, 0..1. */
  lit: number
  floorHeight: number
  windowWidth: number
  intensity: number
  /** Brightness of a light band at the crown. */
  crown?: number
  crownColor?: string
}

/** Facade material: lit window grids generated in the shader from each instance's size. */
export function createWindowMaterial(style: WindowStyle): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: style.base, roughness: 0.62, metalness: 0.3 })
  const uniforms = {
    uWindowA: { value: new THREE.Color(style.windowA) },
    uWindowB: { value: new THREE.Color(style.windowB) },
    uLit: { value: style.lit },
    uCell: { value: new THREE.Vector2(style.windowWidth, style.floorHeight) },
    uIntensity: { value: style.intensity },
    uCrown: { value: style.crown ?? 0 },
    uCrownColor: { value: new THREE.Color(style.crownColor ?? style.windowA) },
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacade;\nvarying vec3 vFacadeNormal;\nvarying float vFacadeSeed;\nvarying float vFacadeHeight;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec3 facadeScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));',
          '  vFacadeSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);',
          '#else',
          '  vec3 facadeScale = vec3(1.0);',
          '  vFacadeSeed = 0.37;',
          '#endif',
          '  vFacade = position * facadeScale;',
          '  vFacadeHeight = facadeScale.y;',
          '  vFacadeNormal = normal;',
        ].join('\n'),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 uWindowA;',
          'uniform vec3 uWindowB;',
          'uniform float uLit;',
          'uniform vec2 uCell;',
          'uniform float uIntensity;',
          'uniform float uCrown;',
          'uniform vec3 uCrownColor;',
          'varying vec3 vFacade;',
          'varying vec3 vFacadeNormal;',
          'varying float vFacadeSeed;',
          'varying float vFacadeHeight;',
          'float facadeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '{',
          '  vec3 facadeNormal = abs(vFacadeNormal);',
          '  if (facadeNormal.y < 0.5) {',
          '    float across = facadeNormal.x > facadeNormal.z ? vFacade.z : vFacade.x;',
          '    vec2 cell = vec2(across, vFacade.y) / uCell;',
          '    vec2 id = floor(cell);',
          '    vec2 f = fract(cell);',
          '    float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78);',
          '    float lit = step(1.0 - uLit, facadeHash(id + vFacadeSeed * 97.0));',
          '    vec3 tint = mix(uWindowA, uWindowB, facadeHash(id.yx + vFacadeSeed * 13.0));',
          '    float ground = step(uCell.y * 1.2, vFacade.y);',
          '    totalEmissiveRadiance += tint * pane * lit * ground * uIntensity;',
          '    float crown = smoothstep(vFacadeHeight - uCell.y * 0.6, vFacadeHeight - uCell.y * 0.15, vFacade.y);',
          '    totalEmissiveRadiance += uCrownColor * crown * uCrown * step(0.55, vFacadeSeed);',
          '  }',
          '}',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'facade-windows'
  return material
}

/** Instanced silhouettes on a ring around the camera; they never parallax, like a painted horizon with depth. */
export class HorizonRing {
  readonly group = new THREE.Group()
  constructor(mesh: THREE.InstancedMesh) {
    this.group.add(mesh)
    this.group.name = 'horizon-ring'
  }
  follow(camera: THREE.Camera): void {
    this.group.position.set(camera.position.x, 0, camera.position.z)
  }
}

export function ringPlacements(random: Random, count: number, radius: number, spread: number, floorY: number, scale: (random: Random) => THREE.Vector3): Placement[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * (Math.PI / count)
    const distance = radius + (random() - 0.5) * spread
    return {
      position: new THREE.Vector3(Math.cos(angle) * distance, floorY, Math.sin(angle) * distance),
      rotation: random() * Math.PI,
      scale: scale(random),
      random: random(),
      side: 1 as const,
      dist: 0,
    }
  })
}

export function mountainGeometry(random: Random, snowLine: number, rock: string, snow: string): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(1, 1, 11, 6, false)
  geometry.translate(0, 0.5, 0)
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const rockColor = new THREE.Color(rock)
  const snowColor = new THREE.Color(snow)
  const color = new THREE.Color()
  const offsets = new Map<string, number>()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const key = `${x.toFixed(3)}:${y.toFixed(3)}:${z.toFixed(3)}`
    let jitter = offsets.get(key)
    if (jitter === undefined) {
      jitter = y > 0.98 ? 0 : (random() - 0.5) * 0.24 * (1 - y * 0.5)
      offsets.set(key, jitter)
    }
    const radial = 1 + jitter
    position.setXYZ(i, x * radial, y * (1 + jitter * 0.4), z * radial)
    const snowAmount = THREE.MathUtils.smoothstep(y + jitter * 0.6, snowLine - 0.08, snowLine + 0.1)
    color.copy(rockColor).lerp(snowColor, snowAmount)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}
