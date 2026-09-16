import * as THREE from 'three'
import type { CountryShape } from './anchors'
import { EARTH_RADIUS } from './geo'
import type { QualityTier } from './quality'

/**
 * The night Earth: dark land and ocean, faint country outlines, a real day/night
 * terminator, restrained city-light texture on the night side and an
 * atmosphere rim. All geography comes from the bundled Natural Earth asset.
 */

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * Packs geography into one data texture: red is land, green is country
 * outlines, blue is night-side light density.
 */
function geographyTexture(countries: readonly CountryShape[], width: number, lights: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = width / 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is unavailable')
  const x = (lon: number) => ((lon + 180) / 360) * canvas.width
  const y = (lat: number) => ((90 - lat) / 180) * canvas.height
  const land = new Path2D()
  for (const country of countries) {
    for (const ring of country.rings) {
      ring.forEach(([lon = 0, lat = 0], index) => (index === 0 ? land.moveTo(x(lon), y(lat)) : land.lineTo(x(lon), y(lat))))
      land.closePath()
    }
  }
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'lighter'
  context.fillStyle = '#f00'
  context.fill(land)
  context.strokeStyle = '#0f0'
  context.lineWidth = Math.max(0.6, width / 2600)
  context.stroke(land)
  if (lights) {
    context.save()
    context.clip(land)
    const random = seededRandom(0x4e494d)
    const scale = width / 2048
    for (let i = 0; i < 9000; i++) {
      const lat = Math.asin(random() * 2 - 1) * (180 / Math.PI) * 0.82
      const lon = random() * 360 - 180
      const size = (random() < 0.08 ? 1.6 : 0.8) * scale
      context.fillStyle = `rgba(0,0,255,${0.25 + random() * 0.75})`
      context.fillRect(x(lon), y(lat), size, size)
    }
    context.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.anisotropy = 4
  return texture
}

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const earthFragment = /* glsl */ `
  uniform sampler2D uGeography;
  uniform float uReady;
  uniform vec3 uSun;
  uniform float uLights;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vec3 geo = texture2D(uGeography, vUv).rgb * uReady;
    vec3 n = normalize(vNormalW);
    vec3 view = normalize(vViewW);
    float sun = dot(n, uSun);
    float day = smoothstep(-0.15, 0.4, sun);
    float night = 1.0 - smoothstep(-0.3, 0.02, sun);
    // Even the day side stays dusky, so the globe reads as night from any angle.
    vec3 oceanNight = vec3(0.0035, 0.006, 0.016);
    vec3 oceanDay = vec3(0.007, 0.014, 0.036);
    vec3 landNight = vec3(0.016, 0.022, 0.040);
    vec3 landDay = vec3(0.036, 0.048, 0.078);
    vec3 color = mix(mix(oceanNight, landNight, geo.r), mix(oceanDay, landDay, geo.r), day);
    color += vec3(0.11, 0.15, 0.24) * geo.g * (0.32 + 0.3 * day);
    color += vec3(1.0, 0.6, 0.22) * geo.b * night * 0.6 * uLights;
    float facing = max(dot(n, view), 0.0);
    float rim = pow(1.0 - facing, 3.2);
    color += vec3(0.05, 0.13, 0.34) * rim * (0.3 + 0.5 * day);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

const atmosphereFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vec3 n = normalize(vNormalW);
    float facing = abs(dot(n, normalize(vViewW)));
    float glow = pow(1.0 - facing, 5.0);
    float lit = 0.35 + 0.65 * smoothstep(-0.5, 0.6, dot(n, uSun));
    vec3 color = vec3(0.14, 0.34, 0.85) * glow * lit;
    gl_FragColor = vec4(color, glow * 0.5);
    #include <colorspace_fragment>
  }
`

export interface Earth {
  group: THREE.Group
  /** Surface mesh used for occlusion when picking. */
  surface: THREE.Mesh
  setGeography(countries: readonly CountryShape[]): void
  setSun(direction: THREE.Vector3): void
  dispose(): void
}

export function createEarth(tier: QualityTier): Earth {
  const group = new THREE.Group()
  const sun = new THREE.Vector3(0, 0, 1)
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  placeholder.needsUpdate = true
  let geography: THREE.Texture = placeholder

  const earthMaterial = new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    uniforms: { uGeography: { value: geography }, uReady: { value: 0 }, uSun: { value: sun }, uLights: { value: tier.cityLights ? 1 : 0 } },
  })
  const [widthSegments, heightSegments] = tier.sphereSegments
  const sphere = new THREE.SphereGeometry(EARTH_RADIUS, widthSegments, heightSegments)
  const surface = new THREE.Mesh(sphere, earthMaterial)
  // SphereGeometry starts its texture seam at -X; this aligns the equirectangular map with latLonToVector.
  surface.rotation.y = -Math.PI / 2
  group.add(surface)

  const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: atmosphereFragment,
    uniforms: { uSun: { value: sun } },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.075, 48, 32)
  group.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial))

  const starPositions = new Float32Array(tier.stars * 3)
  const random = seededRandom(7)
  for (let i = 0; i < tier.stars; i++) {
    const u = random() * 2 - 1
    const angle = random() * Math.PI * 2
    const radial = Math.sqrt(1 - u * u)
    const distance = 38 + random() * 20
    starPositions.set([Math.cos(angle) * radial * distance, u * distance, Math.sin(angle) * radial * distance], i * 3)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMaterial = new THREE.PointsMaterial({ color: 0x8d9bb8, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false })
  group.add(new THREE.Points(starGeometry, starMaterial))

  return {
    group,
    surface,
    setGeography(countries) {
      const next = geographyTexture(countries, tier.textureWidth, tier.cityLights)
      if (geography !== placeholder) geography.dispose()
      geography = next
      earthMaterial.uniforms.uGeography!.value = next
      earthMaterial.uniforms.uReady!.value = 1
    },
    setSun(direction) {
      sun.copy(direction).normalize()
    },
    dispose() {
      sphere.dispose()
      earthMaterial.dispose()
      atmosphereGeometry.dispose()
      atmosphereMaterial.dispose()
      starGeometry.dispose()
      starMaterial.dispose()
      geography.dispose()
      placeholder.dispose()
    },
  }
}
