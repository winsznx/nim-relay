import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { Route } from './route'

/**
 * Pooled presentation effects: additive particles (sparks, gold bursts, dust),
 * camera-space speed lines at high FLOW, and ribbon trails for the
 * board and baton. Buffers are allocated once; nothing allocates per frame.
 */

const particleVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vColor = aColor * smoothstep(1.5, 4.0, -mvPosition.z);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const particleFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  void main() {
    float alpha = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vColor * alpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface BurstOptions {
  count: number
  color: THREE.Color
  speed: number
  size: number
  life: number
  gravity?: number
  /** Bias velocity, e.g. the courier's forward motion. */
  carry?: THREE.Vector3
  /** 0 spherical, 1 flattened into the horizontal plane. */
  flatten?: number
  spread?: number
}

export class Particles {
  readonly points: THREE.Points
  private readonly capacity: number
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly baseColors: Float32Array
  private readonly sizes: Float32Array
  private readonly velocities: Float32Array
  private readonly life: Float32Array
  private readonly maxLife: Float32Array
  private readonly gravity: Float32Array
  private cursor = 0
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial

  constructor(capacity: number, texture: THREE.Texture) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.baseColors = new Float32Array(capacity * 3)
    this.sizes = new Float32Array(capacity)
    this.velocities = new Float32Array(capacity * 3)
    this.life = new Float32Array(capacity)
    this.maxLife = new Float32Array(capacity).fill(1)
    this.gravity = new Float32Array(capacity)
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage))
    this.material = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 400 }, uMap: { value: texture } },
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.name = 'particles'
  }

  setViewportHeight(pixels: number): void {
    this.material.uniforms.uScale!.value = pixels * 0.5
  }

  emit(position: THREE.Vector3, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, gravity: number): void {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.capacity
    this.positions[i * 3] = position.x
    this.positions[i * 3 + 1] = position.y
    this.positions[i * 3 + 2] = position.z
    this.velocities[i * 3] = vx
    this.velocities[i * 3 + 1] = vy
    this.velocities[i * 3 + 2] = vz
    this.baseColors[i * 3] = color.r
    this.baseColors[i * 3 + 1] = color.g
    this.baseColors[i * 3 + 2] = color.b
    this.sizes[i] = size
    this.life[i] = life
    this.maxLife[i] = life
    this.gravity[i] = gravity
  }

  burst(origin: THREE.Vector3, options: BurstOptions, random: () => number): void {
    const flatten = options.flatten ?? 0
    const spread = options.spread ?? 1
    for (let n = 0; n < options.count; n++) {
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      const speed = options.speed * (0.45 + random() * 0.55)
      let vx = Math.sin(phi) * Math.cos(theta) * speed * spread
      let vy = Math.cos(phi) * speed * (1 - flatten)
      let vz = Math.sin(phi) * Math.sin(theta) * speed * spread
      if (options.carry) {
        vx += options.carry.x
        vy += options.carry.y
        vz += options.carry.z
      }
      this.emit(origin, vx, vy, vz, options.color, options.size * (0.6 + random() * 0.6), options.life * (0.6 + random() * 0.5), options.gravity ?? 0)
    }
  }

  update(dt: number): void {
    const drag = Math.exp(-dt * 2.2)
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0) {
        this.sizes[i] = 0
        continue
      }
      this.life[i]! -= dt
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!)
      this.velocities[i * 3]! *= drag
      this.velocities[i * 3 + 1] = this.velocities[i * 3 + 1]! * drag - this.gravity[i]! * dt
      this.velocities[i * 3 + 2]! *= drag
      this.positions[i * 3]! += this.velocities[i * 3]! * dt
      this.positions[i * 3 + 1]! += this.velocities[i * 3 + 1]! * dt
      this.positions[i * 3 + 2]! += this.velocities[i * 3 + 2]! * dt
      const fade = t * t
      this.colors[i * 3] = this.baseColors[i * 3]! * fade
      this.colors[i * 3 + 1] = this.baseColors[i * 3 + 1]! * fade
      this.colors[i * 3 + 2] = this.baseColors[i * 3 + 2]! * fade
    }
    this.geometry.attributes.position!.needsUpdate = true
    this.geometry.attributes.aColor!.needsUpdate = true
    this.geometry.attributes.aSize!.needsUpdate = true
  }

  dispose(): void {
    this.points.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}

const speedLineVertex = /* glsl */ `
  attribute vec2 aShape;
  attribute float aFade;
  varying vec2 vShape;
  varying float vFade;
  void main() {
    vShape = aShape;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const speedLineFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vShape;
  varying float vFade;
  void main() {
    float along = vShape.x * vShape.x;
    float across = 1.0 - vShape.y * vShape.y;
    gl_FragColor = vec4(uColor * along * across * vFade, 1.0);
  }
`

/** Vanishing point of the chase view in aspect-corrected screen units (x scaled by aspect, y as NDC). */
const VANISHING_Y = 0.12
/** Lines keep out of the HUD band at the top and this ellipse around the courier and FLOW meter. */
const HUD_TOP = 0.66
const LINES_BOTTOM = -0.42
const COURIER_ZONE = { y: -0.3, radiusX: 0.34, radiusY: 0.5 }

/**
 * Speed lines at high FLOW: short, soft dashes radiating from the vanishing
 * point along the sides of the screen, clear of the HUD and the courier. They
 * live in camera space on a plane one metre ahead, so they never touch the
 * scene's depth, and every buffer is allocated once.
 */
export class SpeedLines {
  readonly mesh: THREE.Mesh
  private readonly positions: Float32Array
  private readonly fades: Float32Array
  /** Per line: direction x, direction y, radius, rate. */
  private readonly lines: Float32Array
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private aspect = 1

  constructor(
    private readonly count: number,
    private readonly random: () => number,
    tint: THREE.Color,
  ) {
    this.positions = new Float32Array(count * 12)
    this.fades = new Float32Array(count * 4)
    this.lines = new Float32Array(count * 4)
    const shape = new Float32Array(count * 8)
    const index = new Uint16Array(count * 6)
    for (let i = 0; i < count; i++) {
      shape.set([0, -1, 0, 1, 1, 1, 1, -1], i * 8)
      const v = i * 4
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6)
      this.respawn(i, true)
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aFade', new THREE.BufferAttribute(this.fades, 1).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aShape', new THREE.BufferAttribute(shape, 2))
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1))
    this.material = new THREE.ShaderMaterial({
      vertexShader: speedLineVertex,
      fragmentShader: speedLineFragment,
      uniforms: { uColor: { value: tint.clone() } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10
    this.mesh.visible = false
  }

  private allowed(x: number, y: number): boolean {
    if (y > HUD_TOP || y < LINES_BOTTOM || Math.abs(x) > this.aspect) return false
    const dx = x / COURIER_ZONE.radiusX
    const dy = (y - COURIER_ZONE.y) / COURIER_ZONE.radiusY
    if (dx * dx + dy * dy < 1) return false
    return Math.hypot(x, y - VANISHING_Y) > 0.32
  }

  private respawn(i: number, scatter: boolean): void {
    let x = 0
    let y = 0
    for (let attempt = 0; attempt < 8; attempt++) {
      x = (this.random() * 2 - 1) * this.aspect
      y = LINES_BOTTOM + this.random() * (HUD_TOP - LINES_BOTTOM)
      if (this.allowed(x, y)) break
    }
    const dx = x
    const dy = y - VANISHING_Y
    const radius = Math.max(0.32, Math.hypot(dx, dy))
    const o = i * 4
    this.lines[o] = dx / radius
    this.lines[o + 1] = dy / radius
    this.lines[o + 2] = scatter ? radius : Math.max(0.32, radius * 0.8)
    this.lines[o + 3] = 0.7 + this.random() * 0.6
  }

  /** Line colour (linear, may exceed 1 to bloom): the world's edge light, or gold through Relay Rush. */
  setColor(color: THREE.Color): void {
    const uniform = this.material.uniforms.uColor!.value
    if (uniform instanceof THREE.Color) uniform.copy(color)
  }

  /** `intensity` 0..1 (already gated on FLOW), `speed01` 0..1 lengthens and quickens the lines. */
  update(dt: number, camera: THREE.PerspectiveCamera, intensity: number, speed01: number): void {
    this.mesh.visible = intensity > 0.01
    if (!this.mesh.visible) return
    this.aspect = camera.aspect
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const length = 0.045 + speed01 * 0.075
    const width = 0.0045
    for (let i = 0; i < this.count; i++) {
      const o = i * 4
      const dirX = this.lines[o]!
      const dirY = this.lines[o + 1]!
      let radius = this.lines[o + 2]!
      radius += dt * this.lines[o + 3]! * (0.5 + radius * 1.9) * (0.6 + speed01)
      const headX = dirX * radius
      const headY = VANISHING_Y + dirY * radius
      if (Math.abs(headX) > this.aspect + 0.05 || headY > HUD_TOP + 0.05 || headY < LINES_BOTTOM - 0.1) {
        this.respawn(i, false)
        radius = this.lines[o + 2]!
      }
      this.lines[o + 2] = radius
      const tail = Math.max(0.3, radius - length * (0.6 + radius))
      const fade = intensity * Math.min(1, (radius - 0.3) * 4) * 0.3
      const sideX = -dirY * width * (0.5 + radius)
      const sideY = dirX * width * (0.5 + radius)
      const p = i * 12
      this.writeVertex(p, dirX * tail - sideX * 0.3, VANISHING_Y + dirY * tail - sideY * 0.3, tanHalf)
      this.writeVertex(p + 3, dirX * tail + sideX * 0.3, VANISHING_Y + dirY * tail + sideY * 0.3, tanHalf)
      this.writeVertex(p + 6, dirX * radius + sideX, VANISHING_Y + dirY * radius + sideY, tanHalf)
      this.writeVertex(p + 9, dirX * radius - sideX, VANISHING_Y + dirY * radius - sideY, tanHalf)
      this.fades.fill(fade, i * 4, i * 4 + 4)
    }
    this.geometry.attributes.position!.needsUpdate = true
    this.geometry.attributes.aFade!.needsUpdate = true
  }

  /** Screen units (NDC with x scaled by aspect) to camera space on the plane z = -1. */
  private writeVertex(offset: number, x: number, y: number, tanHalf: number): void {
    this.positions[offset] = x * tanHalf
    this.positions[offset + 1] = y * tanHalf
    this.positions[offset + 2] = -1
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * A camera-facing ribbon that follows a moving point and fades along its length.
 * Its length is capped in metres, so fast couriers and slow frames never stretch
 * it past the camera.
 */
export class Trail {
  readonly mesh: THREE.Mesh
  private readonly history: Float32Array
  private readonly samples: Float32Array
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicMaterial
  private filled = 0
  private readonly side = new THREE.Vector3()
  private readonly segment = new THREE.Vector3()
  private readonly toCamera = new THREE.Vector3()

  /** Metres from the head the ribbon may reach; can change every frame (a longer comet at high FLOW). */
  maxLength: number
  /** Ribbon width in metres at the head. */
  width: number

  constructor(
    private readonly length: number,
    width: number,
    readonly color: THREE.Color,
    maxLength = 6,
  ) {
    this.width = width
    this.maxLength = maxLength
    this.history = new Float32Array(length * 3)
    this.samples = new Float32Array(length * 3)
    this.positions = new Float32Array(length * 2 * 3)
    this.colors = new Float32Array(length * 2 * 3)
    const indices: number[] = []
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setIndex(indices)
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 8
  }

  reset(): void {
    this.filled = 0
  }

  /** Pushes the newest head position. `strength` 0..1 scales brightness and width. */
  update(head: THREE.Vector3, cameraPosition: THREE.Vector3, strength: number): void {
    this.history.copyWithin(3, 0, (this.length - 1) * 3)
    this.history[0] = head.x
    this.history[1] = head.y
    this.history[2] = head.z
    this.filled = Math.min(this.length, this.filled + 1)
    this.resample()
    for (let i = 0; i < this.length; i++) {
      const next = Math.min(i + 1, this.length - 1)
      const previous = Math.max(i - 1, 0)
      const px = this.samples[i * 3]!
      const py = this.samples[i * 3 + 1]!
      const pz = this.samples[i * 3 + 2]!
      this.segment.set(
        this.samples[previous * 3]! - this.samples[next * 3]!,
        this.samples[previous * 3 + 1]! - this.samples[next * 3 + 1]!,
        this.samples[previous * 3 + 2]! - this.samples[next * 3 + 2]!,
      )
      this.toCamera.set(cameraPosition.x - px, cameraPosition.y - py, cameraPosition.z - pz)
      this.side.crossVectors(this.segment, this.toCamera)
      const sideLength = this.side.length()
      const t = i / (this.length - 1)
      const halfWidth = this.width * (1 - t) * (0.35 + strength * 0.65) * 0.5
      if (sideLength > 1e-6) this.side.multiplyScalar(halfWidth / sideLength)
      else this.side.set(0, 0, 0)
      this.positions[i * 6] = px + this.side.x
      this.positions[i * 6 + 1] = py + this.side.y
      this.positions[i * 6 + 2] = pz + this.side.z
      this.positions[i * 6 + 3] = px - this.side.x
      this.positions[i * 6 + 4] = py - this.side.y
      this.positions[i * 6 + 5] = pz - this.side.z
      const fade = (1 - t) * (1 - t) * strength
      for (let k = 0; k < 2; k++) {
        this.colors[i * 6 + k * 3] = this.color.r * fade
        this.colors[i * 6 + k * 3 + 1] = this.color.g * fade
        this.colors[i * 6 + k * 3 + 2] = this.color.b * fade
      }
    }
    this.geometry.attributes.position!.needsUpdate = true
    this.geometry.attributes.color!.needsUpdate = true
  }

  /** Spreads the ribbon evenly along the recorded path, up to `maxLength` metres from the head. */
  private resample(): void {
    const step = this.maxLength / (this.length - 1)
    let segment = 0
    let travelled = 0
    for (let i = 0; i < this.length; i++) {
      const wanted = i * step
      while (segment < this.filled - 1) {
        const ax = this.history[segment * 3]!
        const ay = this.history[segment * 3 + 1]!
        const az = this.history[segment * 3 + 2]!
        const bx = this.history[(segment + 1) * 3]!
        const by = this.history[(segment + 1) * 3 + 1]!
        const bz = this.history[(segment + 1) * 3 + 2]!
        const span = Math.hypot(bx - ax, by - ay, bz - az)
        if (travelled + span >= wanted && span > 1e-6) {
          const f = (wanted - travelled) / span
          this.samples[i * 3] = ax + (bx - ax) * f
          this.samples[i * 3 + 1] = ay + (by - ay) * f
          this.samples[i * 3 + 2] = az + (bz - az) * f
          break
        }
        travelled += span
        segment++
      }
      if (segment >= this.filled - 1) {
        const last = Math.max(0, this.filled - 1)
        this.samples[i * 3] = this.history[last * 3]!
        this.samples[i * 3 + 1] = this.history[last * 3 + 1]!
        this.samples[i * 3 + 2] = this.history[last * 3 + 2]!
      }
    }
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}

const edgeGlowVertex = /* glsl */ `
  attribute vec2 aShape;
  varying vec2 vShape;
  void main() {
    vShape = aShape;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const edgeGlowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec2 vShape;
  void main() {
    float along = smoothstep(0.0, 0.18, vShape.x) * (1.0 - smoothstep(0.55, 1.0, vShape.x));
    float across = 1.0 - smoothstep(0.0, 1.0, abs(vShape.y));
    float chevrons = 0.65 + 0.35 * step(0.5, fract(vShape.x * 9.0 - uTime * 2.5));
    gl_FragColor = vec4(uColor * along * across * across * chevrons * uIntensity, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/**
 * A warning strip painted along the road edge beside the courier: faint while it rides the shoulder,
 * pulsing hard while it grinds the edge. Rebuilt each frame from the route, so it follows bends and
 * forks exactly; one draw call, buffers allocated once.
 */
export class EdgeGlow {
  readonly mesh: THREE.Mesh
  private readonly positions: Float32Array
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly point = new THREE.Vector3()

  constructor(
    private readonly segments: number,
    color: THREE.Color,
  ) {
    const vertices = (segments + 1) * 2
    this.positions = new Float32Array(vertices * 3)
    const shape = new Float32Array(vertices * 2)
    const indices: number[] = []
    for (let i = 0; i <= segments; i++) {
      shape.set([i / segments, -1, i / segments, 1], i * 4)
      if (i < segments) {
        const a = i * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('aShape', new THREE.BufferAttribute(shape, 2))
    this.geometry.setIndex(indices)
    this.material = new THREE.ShaderMaterial({
      vertexShader: edgeGlowVertex,
      fragmentShader: edgeGlowFragment,
      uniforms: { uColor: { value: color.clone() }, uIntensity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'edge-glow'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.visible = false
  }

  /**
   * Lays the strip along the `side` edge of `path` from `from` to `to` metres, `inset` metres inside the
   * edge and `halfWidth` either side of that line.
   */
  update(route: Route, path: relayLeg.Path, side: -1 | 1, from: number, to: number, inset: number, halfWidth: number, intensity: number, time: number): void {
    this.mesh.visible = intensity > 0.01
    if (!this.mesh.visible) return
    this.material.uniforms.uIntensity!.value = intensity
    this.material.uniforms.uTime!.value = time
    for (let i = 0; i <= this.segments; i++) {
      const d = from + ((to - from) * i) / this.segments
      const active = route.activePath(path, d)
      const centre = route.pathOffset(active, d) + side * (route.halfWidth(active, d) - inset)
      this.write(i * 6, route.point(d, centre - halfWidth, 0.04, this.point))
      this.write(i * 6 + 3, route.point(d, centre + halfWidth, 0.04, this.point))
    }
    this.geometry.attributes.position!.needsUpdate = true
  }

  private write(offset: number, point: THREE.Vector3): void {
    this.positions[offset] = point.x
    this.positions[offset + 1] = point.y
    this.positions[offset + 2] = point.z
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** Small deterministic PRNG for presentation randomness. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}
