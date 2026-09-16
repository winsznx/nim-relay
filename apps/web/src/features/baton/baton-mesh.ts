import * as THREE from 'three'
import { FRESH_BATON, MAX_MARKERS, RING_THRESHOLDS, type BatonAppearance, type BatonAura } from './baton-appearance'

/**
 * The baton as a 3D object: a faceted NIM-gold hexagonal core with a living
 * energy field, earned rings, orbiting country markers and a rare aura shell.
 * Shared by the race, the globe and the station, so it owns and releases all of
 * its GPU resources and never assumes a particular scene setup.
 */

export interface BatonObjectOptions {
  /** Overall length in metres. */
  length?: number
  /** Ghost batons are translucent cyan-white, without an aura. */
  variant?: 'live' | 'ghost'
  /** Size of the halo and aura glow relative to the baton, 1 by default. Smaller suits a baton carried in a busy scene. */
  glow?: number
}

export interface BatonObject {
  /** Baton axis is local +Y, centred on the origin. */
  readonly object: THREE.Group
  /** `energy` 0..1 brightens the core, e.g. with FLOW or a launch flare. */
  update(timeSeconds: number, energy?: number): void
  setAppearance(appearance: BatonAppearance): void
  dispose(): void
}

const MAX_RINGS = RING_THRESHOLDS.length
const LIVE = { hot: new THREE.Color(2.4, 1.55, 0.55), core: new THREE.Color(1.25, 0.62, 0.08), deep: new THREE.Color(0.36, 0.13, 0.01) }
const GHOST = { hot: new THREE.Color(1.3, 1.9, 2.1), core: new THREE.Color(0.35, 0.85, 1.0), deep: new THREE.Color(0.05, 0.16, 0.22) }
const AURA_SCALE: Record<BatonAura, number> = { none: 0, warm: 3.4, radiant: 4.6, legendary: 6.2 }
const AURA_OPACITY: Record<BatonAura, number> = { none: 0, warm: 0.38, radiant: 0.55, legendary: 0.7 }

const coreVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const coreFragment = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uPulse;
  uniform float uScars;
  uniform float uHalf;
  uniform float uOpacity;
  uniform vec3 uHot;
  uniform vec3 uCore;
  uniform vec3 uDeep;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    float h = vLocal.y / uHalf;
    float angle = atan(vLocal.z, vLocal.x);
    float facing = max(dot(normalize(vNormalW), normalize(vViewW)), 0.0);
    float rim = pow(1.0 - facing, 1.7);
    float breathe = 0.5 + 0.5 * sin(uTime * (2.0 + uPulse * 3.5));
    float band = pow(0.5 + 0.5 * sin(h * 10.0 - uTime * 6.5), 7.0);
    float spine = pow(facing, 5.0);
    vec3 color = mix(uCore, uDeep, rim * 0.55);
    color += uHot * (spine * (0.55 + 0.45 * breathe * uPulse) + band * (0.3 + 0.7 * uEnergy));
    color += uHot * rim * 0.35;
    for (int i = 0; i < 3; i++) {
      if (float(i) >= uScars) break;
      float centre = -0.45 + float(i) * 0.42;
      float jag = 0.07 * sin(angle * 3.0 + float(i) * 2.1) + 0.03 * sin(angle * 7.0 + float(i));
      float d = abs(h - centre - jag);
      color = mix(color, uDeep * 0.25, smoothstep(0.05, 0.022, d));
      color += uHot * smoothstep(0.085, 0.05, d) * smoothstep(0.022, 0.05, d) * 0.55;
    }
    gl_FragColor = vec4(color * (1.0 + uEnergy * 0.8), uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface SharedResources {
  users: number
  core: THREE.CylinderGeometry
  metal: THREE.BufferGeometry
  ring: THREE.TorusGeometry
  marker: THREE.OctahedronGeometry
  glow: THREE.CanvasTexture
}

let shared: SharedResources | null = null

function glowTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Unit-length baton parts; instances scale the group to the requested length. */
function acquireShared(): SharedResources {
  if (!shared) {
    const radius = 0.09
    const cap = new THREE.CylinderGeometry(radius * 0.72, radius * 1.1, 0.14, 6, 1)
    const top = cap.clone().translate(0, 0.43, 0)
    const bottom = cap.clone().rotateX(Math.PI).translate(0, -0.43, 0)
    const collarTop = new THREE.TorusGeometry(radius * 1.16, radius * 0.14, 4, 6).rotateX(Math.PI / 2).translate(0, 0.355, 0)
    const collarBottom = collarTop.clone().translate(0, -0.71, 0)
    const metal = mergeGeometries([top, bottom, collarTop, collarBottom])
    for (const part of [cap, top, bottom, collarTop, collarBottom]) part.dispose()
    shared = {
      users: 0,
      core: new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 0.72, 6, 1, true),
      metal,
      ring: new THREE.TorusGeometry(radius * 1.8, radius * 0.1, 4, 6),
      marker: new THREE.OctahedronGeometry(radius * 0.32),
      glow: glowTexture(),
    }
  }
  shared.users++
  return shared
}

function releaseShared(): void {
  if (!shared) return
  shared.users--
  if (shared.users > 0) return
  shared.core.dispose()
  shared.metal.dispose()
  shared.ring.dispose()
  shared.marker.dispose()
  shared.glow.dispose()
  shared = null
}

/** Non-indexed merge of simple primitives that share position/normal/uv layouts. */
function mergeGeometries(parts: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flattened = parts.map(part => (part.index ? part.toNonIndexed() : part))
  let vertices = 0
  for (const part of flattened) vertices += part.getAttribute('position').count
  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  let offset = 0
  for (const part of flattened) {
    const source = part.getAttribute('position')
    const normals = part.getAttribute('normal')
    for (let i = 0; i < source.count; i++) {
      position[(offset + i) * 3] = source.getX(i)
      position[(offset + i) * 3 + 1] = source.getY(i)
      position[(offset + i) * 3 + 2] = source.getZ(i)
      normal[(offset + i) * 3] = normals.getX(i)
      normal[(offset + i) * 3 + 1] = normals.getY(i)
      normal[(offset + i) * 3 + 2] = normals.getZ(i)
    }
    offset += source.count
  }
  flattened.forEach((part, index) => {
    if (part !== parts[index]) part.dispose()
  })
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  return merged
}

export function createBatonObject(appearance: BatonAppearance = FRESH_BATON, options: BatonObjectOptions = {}): BatonObject {
  const resources = acquireShared()
  const ghost = options.variant === 'ghost'
  const palette = ghost ? GHOST : LIVE
  const object = new THREE.Group()
  object.name = 'baton'
  object.scale.setScalar(options.length ?? 0.56)

  const coreMaterial = new THREE.ShaderMaterial({
    vertexShader: coreVertex,
    fragmentShader: coreFragment,
    transparent: ghost,
    depthWrite: !ghost,
    blending: ghost ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uPulse: { value: appearance.pulse },
      uScars: { value: appearance.scars },
      uHalf: { value: 0.36 },
      uOpacity: { value: ghost ? 0.6 : 1 },
      uHot: { value: palette.hot },
      uCore: { value: palette.core },
      uDeep: { value: palette.deep },
    },
  })
  const core = new THREE.Mesh(resources.core, coreMaterial)
  object.add(core)

  const metalMaterial = ghost
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.9, 1), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.MeshStandardMaterial({ color: 0xd8961f, metalness: 0.75, roughness: 0.26, emissive: 0x6b3500, emissiveIntensity: 0.9, flatShading: true })
  const metal = new THREE.Mesh(resources.metal, metalMaterial)
  object.add(metal)

  const ringMaterial = new THREE.MeshBasicMaterial({ color: palette.hot, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })
  const rings = new THREE.InstancedMesh(resources.ring, ringMaterial, MAX_RINGS)
  rings.frustumCulled = false
  object.add(rings)

  const markerMaterial = new THREE.MeshBasicMaterial({ color: palette.hot, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
  const markers = new THREE.InstancedMesh(resources.marker, markerMaterial, MAX_MARKERS)
  markers.frustumCulled = false
  object.add(markers)

  const haloMaterial = new THREE.SpriteMaterial({ map: resources.glow, color: palette.core, transparent: true, opacity: ghost ? 0.25 : 0.45, depthWrite: false, blending: THREE.AdditiveBlending })
  const halo = new THREE.Sprite(haloMaterial)
  const glow = options.glow ?? 1
  halo.scale.setScalar(1.7 * glow)
  object.add(halo)

  const auraMaterial = new THREE.SpriteMaterial({ map: resources.glow, color: new THREE.Color(1.6, 0.95, 0.35), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const aura = new THREE.Sprite(auraMaterial)
  object.add(aura)

  let current = appearance
  const transform = new THREE.Object3D()

  function apply(next: BatonAppearance): void {
    current = next
    coreMaterial.uniforms.uPulse!.value = next.pulse
    coreMaterial.uniforms.uScars!.value = next.scars
    rings.count = Math.min(MAX_RINGS, next.rings)
    markers.count = Math.min(MAX_MARKERS, next.markers)
    rings.visible = rings.count > 0
    markers.visible = markers.count > 0
    const auraTier = ghost ? 'none' : next.aura
    aura.visible = auraTier !== 'none'
    aura.scale.setScalar(AURA_SCALE[auraTier] * glow)
    auraMaterial.opacity = AURA_OPACITY[auraTier]
  }
  apply(appearance)

  function update(timeSeconds: number, energy = 0): void {
    const clampedEnergy = Math.max(0, Math.min(1, energy))
    coreMaterial.uniforms.uTime!.value = timeSeconds
    coreMaterial.uniforms.uEnergy!.value = clampedEnergy

    for (let i = 0; i < rings.count; i++) {
      const along = rings.count === 1 ? 0 : -0.26 + (0.52 * i) / (rings.count - 1)
      transform.position.set(0, along, 0)
      transform.rotation.set(Math.PI / 2, 0, timeSeconds * (i % 2 === 0 ? 0.9 : -0.7) + i * 0.5)
      const breathe = 1 + 0.06 * Math.sin(timeSeconds * 3 + i)
      transform.scale.setScalar(breathe)
      transform.updateMatrix()
      rings.setMatrixAt(i, transform.matrix)
    }
    rings.instanceMatrix.needsUpdate = true

    for (let i = 0; i < markers.count; i++) {
      const phase = (i / Math.max(1, markers.count)) * Math.PI * 2 + timeSeconds * 0.8
      transform.position.set(Math.cos(phase) * 0.3, Math.sin(phase * 2 + i) * 0.2, Math.sin(phase) * 0.3)
      transform.rotation.set(timeSeconds * 2 + i, timeSeconds * 1.3, 0)
      transform.scale.setScalar(1)
      transform.updateMatrix()
      markers.setMatrixAt(i, transform.matrix)
    }
    markers.instanceMatrix.needsUpdate = true

    haloMaterial.opacity = (ghost ? 0.22 : 0.4) + clampedEnergy * 0.35 + 0.08 * Math.sin(timeSeconds * (2 + current.pulse * 3))
    if (aura.visible) {
      const shimmer = current.aura === 'legendary' ? 0.12 * Math.sin(timeSeconds * 1.7) : 0.05 * Math.sin(timeSeconds)
      auraMaterial.opacity = AURA_OPACITY[current.aura] + shimmer
      auraMaterial.color.setRGB(1.6, 0.95 + shimmer, 0.35 + (current.aura === 'legendary' ? 0.4 + shimmer : 0))
      aura.material.rotation = timeSeconds * 0.2
    }
  }
  update(0)

  return {
    object,
    update,
    setAppearance: apply,
    dispose() {
      object.removeFromParent()
      coreMaterial.dispose()
      metalMaterial.dispose()
      ringMaterial.dispose()
      markerMaterial.dispose()
      haloMaterial.dispose()
      auraMaterial.dispose()
      rings.dispose()
      markers.dispose()
      releaseShared()
    },
  }
}
