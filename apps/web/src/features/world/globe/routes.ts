import * as THREE from 'three'
import type { Anchor } from './anchors'
import { arcPoints, EARTH_RADIUS, latLonToVector } from './geo'
import type { QualityTier } from './quality'

export type GlobeMode = 'global' | 'quick' | 'crew' | 'rival'

export interface GlobeRelay {
  id: string
  mode: GlobeMode
  team: 'gold' | 'cyan' | null
  crewKey: string | null
  status: 'active' | 'completed' | 'stranded'
  /** Consented country codes in route order; null where the runner did not share one. */
  stops: readonly (string | null)[]
}

export interface RouteEmphasis {
  featuredId: string | null
  selectedId: string | null
}

const GLOBAL_GOLD = new THREE.Color('#ffc04d')
const WARM_GOLD = new THREE.Color('#eba55a')
const TEAM_GOLD = new THREE.Color('#f5a623')
const TEAM_CYAN = new THREE.Color('#22d3ee')
const CREW_METALS = ['#eba58c', '#eedba8', '#d0925a', '#d3dae6'].map(hex => new THREE.Color(hex))

export function relayColor(relay: GlobeRelay): THREE.Color {
  switch (relay.mode) {
    case 'global':
      return GLOBAL_GOLD
    case 'quick':
      return WARM_GOLD
    case 'rival':
      return relay.team === 'cyan' ? TEAM_CYAN : TEAM_GOLD
    case 'crew': {
      const key = relay.crewKey ?? relay.id
      let hash = 0
      for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
      return CREW_METALS[hash % CREW_METALS.length] ?? WARM_GOLD
    }
  }
}

const arcVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const arcFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlow;
  uniform float uPulses;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float along = vUv.x;
    float ends = smoothstep(0.0, 0.07, along) * (1.0 - smoothstep(0.93, 1.0, along));
    float wave = fract(along * uPulses - uTime * uFlow);
    float pulse = smoothstep(0.62, 0.97, wave) * (1.0 - smoothstep(0.97, 1.0, wave));
    float base = mix(0.3, 0.75, along);
    float strength = (base * 0.55 + pulse * pulse * 1.6) * uIntensity * ends;
    gl_FragColor = vec4(uColor, strength);
    #include <colorspace_fragment>
  }
`

const pointVertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float kind;
  attribute float phase;
  attribute float alpha;
  uniform float uPixelRatio;
  uniform float uReference;
  varying vec3 vColor;
  varying float vKind;
  varying float vPhase;
  varying float vAlpha;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixelRatio * clamp(uReference / -view.z, 0.7, 1.8);
    gl_Position = projectionMatrix * view;
    vColor = color;
    vKind = kind;
    vPhase = phase;
    vAlpha = alpha;
  }
`

/** kind 0: route stop, 1: current holder with a pulse ring, 2: comet particle, 3: arrival burst. */
const pointFragment = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vKind;
  varying float vPhase;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord * 2.0 - 1.0);
    if (d > 1.0) discard;
    vec3 color = vColor;
    float strength;
    if (vKind < 0.5) {
      strength = smoothstep(1.0, 0.15, d) * 0.85;
    } else if (vKind < 1.5) {
      float core = smoothstep(0.3, 0.1, d);
      float cycle = fract(uTime * 0.42 * uMotion + vPhase);
      float radius = mix(0.28, 0.98, cycle);
      float ring = smoothstep(0.07, 0.0, abs(d - radius)) * (1.0 - cycle) * 0.9;
      strength = core + smoothstep(1.0, 0.0, d) * 0.12 + ring;
      color = mix(vColor, vec3(1.0, 0.97, 0.9), smoothstep(0.18, 0.0, d));
    } else if (vKind < 2.5) {
      strength = pow(1.0 - d, 2.2);
      color = mix(vColor, vec3(1.0, 0.96, 0.86), smoothstep(0.45, 0.0, d) * vAlpha);
    } else {
      float ring = smoothstep(0.1, 0.0, abs(d - (1.0 - vAlpha) * 0.95));
      strength = ring + smoothstep(0.4, 0.0, d) * vAlpha;
    }
    gl_FragColor = vec4(color, strength * vAlpha);
    #include <colorspace_fragment>
  }
`

interface BuiltRelay {
  relay: GlobeRelay
  color: THREE.Color
  /** Sampled points of every drawn hop, oldest first. */
  hops: THREE.Vector3[][]
  /** The hop that delivered the baton to its current holder, when both ends are located. */
  lastHop: THREE.Vector3[] | null
  holder: THREE.Vector3 | null
  stops: THREE.Vector3[]
  phase: number
}

export interface PointBuffers {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  kinds: Float32Array
  phases: Float32Array
  alphas: Float32Array
}

export function createPointCloud(capacity: number, material: THREE.ShaderMaterial): { points: THREE.Points; buffers: PointBuffers; geometry: THREE.BufferGeometry } {
  const buffers: PointBuffers = {
    positions: new Float32Array(capacity * 3),
    colors: new Float32Array(capacity * 3),
    sizes: new Float32Array(capacity),
    kinds: new Float32Array(capacity),
    phases: new Float32Array(capacity),
    alphas: new Float32Array(capacity),
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('size', new THREE.BufferAttribute(buffers.sizes, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('kind', new THREE.BufferAttribute(buffers.kinds, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('phase', new THREE.BufferAttribute(buffers.phases, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(buffers.alphas, 1).setUsage(THREE.DynamicDrawUsage))
  geometry.setDrawRange(0, 0)
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return { points, buffers, geometry }
}

export function markDirty(geometry: THREE.BufferGeometry, count: number): void {
  geometry.setDrawRange(0, count)
  for (const name of ['position', 'color', 'size', 'kind', 'phase', 'alpha']) {
    const attribute = geometry.getAttribute(name)
    if (!(attribute instanceof THREE.BufferAttribute)) continue
    attribute.clearUpdateRanges()
    attribute.addUpdateRange(0, Math.max(1, count) * attribute.itemSize)
    attribute.needsUpdate = true
  }
}

export function writePoint(buffers: PointBuffers, index: number, position: THREE.Vector3, color: THREE.Color, size: number, kind: number, phase: number, alpha: number): void {
  const offset = index * 3
  buffers.positions[offset] = position.x
  buffers.positions[offset + 1] = position.y
  buffers.positions[offset + 2] = position.z
  buffers.colors[offset] = color.r
  buffers.colors[offset + 1] = color.g
  buffers.colors[offset + 2] = color.b
  buffers.sizes[index] = size
  buffers.kinds[index] = kind
  buffers.phases[index] = phase
  buffers.alphas[index] = alpha
}

export function createPointMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uPixelRatio: { value: 1 }, uReference: { value: 8 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

/** Sample a polyline at 0..1 by arc index. */
export function samplePolyline(points: readonly THREE.Vector3[], t: number, target: THREE.Vector3): THREE.Vector3 {
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * (points.length - 1)
  const index = Math.min(points.length - 2, Math.floor(scaled))
  const start = points[index]
  const end = points[index + 1]
  if (!start || !end) return target.copy(points[0] ?? target)
  return target.copy(start).lerp(end, scaled - index)
}

export interface RouteLayer {
  group: THREE.Group
  built: BuiltRelay[]
  /** Relays whose current holder has no located country. */
  unlocated: GlobeRelay[]
  update(time: number, motion: number): void
  dispose(): void
}

const MAX_COMETS = 48

/** Arcs, stop nodes and travelling comets for every relay with located stops. */
export function buildRoutes(relays: readonly GlobeRelay[], locate: (code: string | null) => Anchor | null, emphasis: RouteEmphasis, tier: QualityTier, pointMaterial: THREE.ShaderMaterial): RouteLayer {
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const arcMaterials: THREE.ShaderMaterial[] = []
  const built: BuiltRelay[] = []
  const unlocated: GlobeRelay[] = []
  const position = (code: string | null, lift: number) => {
    const anchor = locate(code)
    return anchor ? latLonToVector(anchor.lat, anchor.lon, EARTH_RADIUS + lift) : null
  }

  relays.forEach((relay, index) => {
    const color = relayColor(relay)
    const located = relay.stops.map(code => position(code, 0.012))
    const holder = located.at(-1) ?? null
    if (!holder) unlocated.push(relay)
    const highlighted = relay.id === emphasis.selectedId || relay.id === emphasis.featuredId
    const quiet = relay.status !== 'active'
    const hops: THREE.Vector3[][] = []
    let lastHop: THREE.Vector3[] | null = null
    for (let i = 1; i < located.length; i++) {
      const from = located[i - 1]
      const to = located[i]
      if (!from || !to || from.distanceTo(to) < 1e-3) continue
      const points = arcPoints(from, to, tier.arcSegments)
      hops.push(points)
      const isLast = i === located.length - 1
      if (isLast) lastHop = points
      const intensity = quiet ? 0.35 : isLast ? (highlighted ? 1.45 : 1) : highlighted ? 0.7 : 0.45
      const radius = (relay.mode === 'global' || highlighted ? 0.0085 : 0.0055) * (isLast ? 1 : 0.7)
      const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), tier.arcSegments, radius, 5, false)
      const material = new THREE.ShaderMaterial({
        vertexShader: arcVertex,
        fragmentShader: arcFragment,
        uniforms: {
          uColor: { value: color },
          uTime: { value: 0 },
          uFlow: { value: quiet ? 0.05 : isLast ? 0.42 : 0.14 },
          uPulses: { value: Math.max(1, Math.round(from.distanceTo(to) * 2.2)) },
          uIntensity: { value: intensity },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      group.add(new THREE.Mesh(geometry, material))
      disposables.push(geometry, material)
      arcMaterials.push(material)
    }
    const stops = located.filter((point): point is THREE.Vector3 => point !== null)
    built.push({ relay, color, hops, lastHop, holder, stops, phase: (index * 0.37) % 1 })
  })

  const nodeCount = built.reduce((sum, relay) => sum + relay.stops.length, 0)
  const nodes = createPointCloud(Math.max(1, nodeCount), pointMaterial)
  let cursor = 0
  for (const relay of built) {
    relay.stops.forEach((stop, index) => {
      const isHolder = index === relay.stops.length - 1 && relay.holder !== null && stop === relay.holder
      const highlighted = relay.relay.id === emphasis.selectedId || relay.relay.id === emphasis.featuredId
      const size = isHolder ? (highlighted ? 38 : 30) : 7
      const alpha = relay.relay.status === 'active' ? 1 : 0.45
      writePoint(nodes.buffers, cursor++, stop, relay.color, size, isHolder && relay.relay.status === 'active' ? 1 : 0, relay.phase, alpha)
    })
  }
  markDirty(nodes.geometry, cursor)
  group.add(nodes.points)

  const trail = tier.trailPoints
  const comets = createPointCloud(MAX_COMETS * trail, pointMaterial)
  const travelling = built.filter(relay => relay.lastHop && relay.relay.status === 'active').slice(0, MAX_COMETS)
  group.add(comets.points)
  const scratch = new THREE.Vector3()

  return {
    group,
    built,
    unlocated,
    update(time, motion) {
      for (const material of arcMaterials) material.uniforms.uTime!.value = time * motion
      let index = 0
      const period = 6.5
      for (const relay of travelling) {
        const hop = relay.lastHop
        if (!hop) continue
        const cycle = ((time * motion) / period + relay.phase) % 1
        const travel = Math.min(1, cycle / 0.45)
        const head = travel < 0.5 ? 2 * travel * travel : 1 - (-2 * travel + 2) ** 2 / 2
        const fade = cycle < 0.45 ? 1 : Math.max(0, 1 - (cycle - 0.45) / 0.12)
        for (let i = 0; i < trail; i++) {
          const at = head - i * 0.018
          const visible = at >= 0 && fade > 0
          samplePolyline(hop, Math.max(0, at), scratch)
          const falloff = 1 - i / trail
          writePoint(comets.buffers, index++, scratch, relay.color, i === 0 ? 17 : 11 * falloff + 2, 2, 0, visible ? fade * falloff * falloff : 0)
        }
      }
      markDirty(comets.geometry, index)
    },
    dispose() {
      for (const item of disposables) item.dispose()
      nodes.geometry.dispose()
      comets.geometry.dispose()
      group.removeFromParent()
    },
  }
}
