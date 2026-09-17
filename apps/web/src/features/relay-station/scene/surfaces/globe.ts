import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { atlasStation } from '@nim-relay/shared'
import type { WorldRoute } from '../../view-model'
import type { StationKit } from '../kit'
import { COLOR } from '../palette'
import { FOG_PARS, OUTPUT } from '../shaders'

export const GLOBE_RADIUS = 1.3
const EARTH_ASSET = '/assets/earth-countries.json'
const LAND_WIDTH = 1024
const LAND_HEIGHT = 512

interface Country {
  code: string
  lat: number
  lon: number
  rings: number[][][]
}

export interface Globe {
  readonly object: THREE.Group
  setRoutes(routes: readonly WorldRoute[]): void
  tick(time: number, delta: number, reducedMotion: boolean): void
  dispose(): void
}

/** A small holographic Earth with glowing baton routes between Relay Atlas stations. */
export function createGlobe(kit: StationKit): Globe {
  const object = new THREE.Group()
  const spin = new THREE.Group()
  spin.rotation.x = 0.32
  object.add(spin)

  const landCanvas = document.createElement('canvas')
  landCanvas.width = LAND_WIDTH
  landCanvas.height = LAND_HEIGHT
  const landTexture = kit.track(new THREE.CanvasTexture(landCanvas))
  const earthMaterial = kit.track(
    new THREE.ShaderMaterial({
      uniforms: {
        uLand: { value: landTexture },
        uOcean: { value: new THREE.Color('#0b1426') },
        uLandColor: { value: new THREE.Color('#d9a257') },
        uRim: { value: new THREE.Color('#6d86c6') },
        uFogColor: kit.uniforms.uFogColor,
        uFogDensity: kit.uniforms.uFogDensity,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vToCamera;
        varying float vDepth;
        void main() {
          vUv = uv;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vToCamera = normalize(-viewPosition.xyz);
          vDepth = -viewPosition.z;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLand;
        uniform vec3 uOcean;
        uniform vec3 uLandColor;
        uniform vec3 uRim;
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vToCamera;
        varying float vDepth;
        ${FOG_PARS}
        void main() {
          float land = texture2D(uLand, vUv).r;
          float facing = clamp(dot(normalize(vNormalView), normalize(vToCamera)), 0.0, 1.0);
          float rim = pow(1.0 - facing, 3.0);
          vec3 color = uOcean * (0.5 + 0.5 * facing) + uLandColor * land * (0.25 + 0.75 * facing) * 0.9 + uRim * rim * 0.55;
          gl_FragColor = vec4(applyFog(color, vDepth), 1.0);
          ${OUTPUT}
        }
      `,
    }),
  )
  const earth = new THREE.Mesh(kit.track(new THREE.SphereGeometry(GLOBE_RADIUS, 64, 40)), earthMaterial)
  earth.rotation.y = -Math.PI / 2
  spin.add(earth)

  const halo = new THREE.Mesh(
    kit.track(new THREE.SphereGeometry(GLOBE_RADIUS * 1.12, 48, 24)),
    kit.track(
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: COLOR.lamp } },
        vertexShader: /* glsl */ `
          varying vec3 vNormalView;
          varying vec3 vToCamera;
          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vNormalView = normalize(normalMatrix * normal);
            vToCamera = normalize(-viewPosition.xyz);
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying vec3 vNormalView;
          varying vec3 vToCamera;
          void main() {
            float facing = abs(dot(normalize(vNormalView), normalize(vToCamera)));
            float glow = smoothstep(0.0, 0.55, facing) * pow(1.0 - facing, 1.6);
            gl_FragColor = vec4(uColor, glow * 0.5);
            ${OUTPUT}
          }
        `,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  )
  object.add(halo)

  const arcMaterial = kit.track(
    new THREE.ShaderMaterial({
      uniforms: { uTime: kit.uniforms.uTime, uColor: { value: COLOR.gold } },
      vertexShader: /* glsl */ `
        attribute float aLive;
        attribute float aOffset;
        varying float vProgress;
        varying float vLive;
        varying float vOffset;
        void main() {
          vProgress = uv.x;
          vLive = aLive;
          vOffset = aOffset;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying float vProgress;
        varying float vLive;
        varying float vOffset;
        void main() {
          float head = fract(uTime * 0.18 + vOffset);
          float pulse = smoothstep(0.14, 0.0, abs(head - vProgress)) * vLive;
          float ends = smoothstep(0.0, 0.1, vProgress) * smoothstep(1.0, 0.9, vProgress);
          vec3 color = uColor * (0.35 + 0.35 * vLive + pulse * 2.2);
          gl_FragColor = vec4(color, (0.3 + 0.7 * ends) * (0.4 + 0.6 * vLive));
          ${OUTPUT}
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const arcs = new THREE.Mesh(emptyGeometry(), arcMaterial)
  spin.add(arcs)

  const stopMaterial = kit.track(
    new THREE.PointsMaterial({ size: 0.2, map: kit.radial, color: new THREE.Color(2.4, 1.5, 0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  const stops = new THREE.Points(emptyGeometry(), stopMaterial)
  spin.add(stops)

  let routes: readonly WorldRoute[] = []
  let alive = true
  let aimed = false

  void loadCountries().then(
    loaded => {
      if (!alive) return
      paintLand(landCanvas, loaded)
      landTexture.needsUpdate = true
      rebuild()
    },
    (error: unknown) => {
      if (alive) console.warn('World routes: earth outline unavailable', error)
    },
  )

  function rebuild(): void {
    arcs.geometry.dispose()
    stops.geometry.dispose()
    const built = buildRoutes(routes)
    arcs.geometry = built.arcs
    stops.geometry = built.stops
    if (!aimed && built.focusLongitude !== null) {
      aimed = true
      spin.rotation.y = -THREE.MathUtils.degToRad(built.focusLongitude)
    }
  }

  return {
    object,
    setRoutes(next) {
      routes = next
      rebuild()
    },
    tick(_time, delta, reducedMotion) {
      spin.rotation.y += delta * (reducedMotion ? 0.015 : 0.05)
    },
    dispose() {
      alive = false
      arcs.geometry.dispose()
      stops.geometry.dispose()
    },
  }
}

async function loadCountries(): Promise<ReadonlyMap<string, Country>> {
  const response = await fetch(EARTH_ASSET)
  if (!response.ok) throw new Error(`Earth asset returned ${response.status}`)
  const data: unknown = await response.json()
  const map = new Map<string, Country>()
  if (!Array.isArray(data)) return map
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const code: unknown = Reflect.get(entry, 'code')
    const lat: unknown = Reflect.get(entry, 'lat')
    const lon: unknown = Reflect.get(entry, 'lon')
    const rings: unknown = Reflect.get(entry, 'rings')
    if (typeof code === 'string' && typeof lat === 'number' && typeof lon === 'number' && Array.isArray(rings)) {
      map.set(code, { code, lat, lon, rings: rings.filter(isRing) })
    }
  }
  return map
}

function isRing(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(pair => Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number')
}

/** Land as a field of dots, thinned toward the poles so spacing stays even on the sphere. */
function paintLand(canvas: HTMLCanvasElement, countries: ReadonlyMap<string, Country>): void {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  context.fillStyle = '#000'
  context.fillRect(0, 0, LAND_WIDTH, LAND_HEIGHT)
  context.fillStyle = '#fff'
  for (const country of countries.values()) {
    for (const ring of country.rings) {
      context.beginPath()
      ring.forEach(([lon = 0, lat = 0], index) => {
        const x = ((lon + 180) / 360) * LAND_WIDTH
        const y = ((90 - lat) / 180) * LAND_HEIGHT
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      context.fill()
    }
  }
  const mask = context.getImageData(0, 0, LAND_WIDTH, LAND_HEIGHT).data
  context.fillStyle = '#000'
  context.fillRect(0, 0, LAND_WIDTH, LAND_HEIGHT)
  context.fillStyle = '#fff'
  const step = 5.5
  for (let y = step / 2; y < LAND_HEIGHT; y += step) {
    const latitude = 90 - (y / LAND_HEIGHT) * 180
    const stride = step / Math.max(0.2, Math.cos(THREE.MathUtils.degToRad(latitude)))
    for (let x = (y / step) % 2 === 0 ? 0 : stride / 2; x < LAND_WIDTH; x += stride) {
      const index = (Math.floor(y) * LAND_WIDTH + Math.floor(x)) * 4
      if ((mask[index] ?? 0) < 128) continue
      context.beginPath()
      context.arc(x, y, 1.7, 0, Math.PI * 2)
      context.fill()
    }
  }
}

function emptyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  return geometry
}

function toSphere(lat: number, lon: number, radius: number, target = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(lat)
  const theta = THREE.MathUtils.degToRad(lon)
  return target.set(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)).multiplyScalar(radius)
}

interface Place {
  code: string
  lat: number
  lon: number
}

function placeOf(stationId: string): Place | null {
  const station = atlasStation(stationId)
  return station ? { code: station.id, lat: station.lat, lon: station.lon } : null
}

function buildRoutes(routes: readonly WorldRoute[]): { arcs: THREE.BufferGeometry; stops: THREE.BufferGeometry; focusLongitude: number | null } {
  const tubes: THREE.BufferGeometry[] = []
  const stopPositions: number[] = []
  const seen = new Set<string>()
  let focusLongitude: number | null = null

  routes.forEach((route, routeIndex) => {
    route.hops.forEach(([origin, destination], i) => {
      const from = placeOf(origin)
      const to = placeOf(destination)
      if (!from || !to) return
      for (const place of [from, to]) {
        focusLongitude ??= place.lon
        if (seen.has(place.code)) continue
        seen.add(place.code)
        toSphere(place.lat, place.lon, GLOBE_RADIUS * 1.01).toArray(stopPositions, stopPositions.length)
      }
      if (from.code !== to.code) tubes.push(arcTube(from, to, route.live, (routeIndex * 0.37 + i * 0.13) % 1))
    })
  })

  const stops = new THREE.BufferGeometry()
  stops.setAttribute('position', new THREE.Float32BufferAttribute(stopPositions, 3))
  const merged = tubes.length > 0 ? mergeGeometries(tubes, false) : null
  for (const tube of tubes) tube.dispose()
  return { arcs: merged ?? emptyGeometry(), stops, focusLongitude }
}

function arcTube(from: Place, to: Place, live: boolean, offset: number): THREE.BufferGeometry {
  const start = toSphere(from.lat, from.lon, 1)
  const end = toSphere(to.lat, to.lon, 1)
  const angle = start.angleTo(end)
  const lift = Math.min(0.12, 0.025 + angle * 0.05)
  const points: THREE.Vector3[] = []
  const axis = new THREE.Vector3().crossVectors(start, end)
  if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0)
  axis.normalize()
  for (let i = 0; i <= 32; i++) {
    const t = i / 32
    const point = start.clone().applyAxisAngle(axis, angle * t)
    points.push(point.multiplyScalar(GLOBE_RADIUS * (1.012 + Math.sin(Math.PI * t) * lift)))
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, live ? 0.008 : 0.005, 4, false)
  const vertices = tube.getAttribute('position').count
  tube.setAttribute('aLive', new THREE.BufferAttribute(new Float32Array(vertices).fill(live ? 1 : 0), 1))
  tube.setAttribute('aOffset', new THREE.BufferAttribute(new Float32Array(vertices).fill(offset), 1))
  return tube
}
