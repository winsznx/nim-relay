import * as THREE from 'three'
import { fromQ, type Route } from '../route'
import type { Random } from './common'

/**
 * Atmosphere shared by the world kits: an animated sea with sun or moon glints,
 * procedural ground far below the skyway, and camera-following weather.
 */

export interface WaterStyle {
  deep: string
  shallow: string
  sky: string
  glint: string
  sunDirection: readonly [number, number, number]
  waveScale: number
  glintStrength: number
}

export function createWater(style: WaterStyle, floorY: number): { mesh: THREE.Mesh; update(camera: THREE.Camera, time: number): void; dispose(): void } {
  const geometry = new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(style.deep) },
        uShallow: { value: new THREE.Color(style.shallow) },
        uSky: { value: new THREE.Color(style.sky) },
        uGlint: { value: new THREE.Color(style.glint) },
        uSun: { value: new THREE.Vector3(...style.sunDirection).normalize() },
        uWave: { value: style.waveScale },
        uGlintStrength: { value: style.glintStrength },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uGlint;
      uniform vec3 uSun;
      uniform float uWave;
      uniform float uGlintStrength;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz * uWave;
        float t = uTime;
        vec2 gradient = vec2(0.0);
        gradient += vec2(cos(p.x * 0.9 + t * 0.9), 0.0) * 0.5;
        gradient += vec2(0.0, cos(p.y * 1.3 - t * 1.1)) * 0.4;
        gradient += vec2(cos((p.x + p.y) * 2.3 + t * 1.7)) * 0.22;
        gradient += vec2(cos((p.x * 0.7 - p.y) * 4.1 - t * 2.3), -cos((p.x - p.y * 0.4) * 3.7 + t * 1.9)) * 0.12;
        vec3 normal = normalize(vec3(-gradient.x * 0.12, 1.0, -gradient.y * 0.12));
        vec3 view = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);
        vec3 color = mix(uDeep, uShallow, clamp(gradient.x * 0.25 + 0.5, 0.0, 1.0) * 0.35);
        color = mix(color, uSky, fresnel * 0.85);
        vec3 reflected = reflect(-view, normal);
        float glint = pow(max(dot(reflected, uSun), 0.0), 180.0);
        float path = pow(max(dot(reflected, uSun), 0.0), 12.0);
        color += uGlint * (glint * 3.0 + path * 0.25) * uGlintStrength;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = floorY
  mesh.frustumCulled = false
  mesh.name = 'water'
  return {
    mesh,
    update(camera, time) {
      mesh.position.x = camera.position.x
      mesh.position.z = camera.position.z
      material.uniforms.uTime!.value = time
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}

export interface GroundStyle {
  base: string
  accent: string
  /** 'grid' lit street grid, 'dunes' wind ripples, 'snow' soft drifts. */
  pattern: 'grid' | 'dunes' | 'snow'
  lightColor: string
  lightStrength: number
}

export function createGround(style: GroundStyle, floorY: number): { mesh: THREE.Mesh; update(camera: THREE.Camera, time: number): void; dispose(): void } {
  const geometry = new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2)
  const pattern = style.pattern === 'grid' ? 0 : style.pattern === 'dunes' ? 1 : 2
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(style.base) },
        uAccent: { value: new THREE.Color(style.accent) },
        uLight: { value: new THREE.Color(style.lightColor) },
        uLightStrength: { value: style.lightStrength },
        uPattern: { value: pattern },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uBase;
      uniform vec3 uAccent;
      uniform vec3 uLight;
      uniform float uLightStrength;
      uniform float uPattern;
      varying vec3 vWorld;
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      void main() {
        vec2 p = vWorld.xz;
        vec3 color = uBase;
        if (uPattern < 0.5) {
          vec2 block = p / 64.0;
          vec2 f = abs(fract(block) - 0.5);
          float street = 1.0 - smoothstep(0.45, 0.49, max(f.x, f.y));
          vec2 id = floor(block);
          color = mix(uAccent * (0.6 + hash2(id) * 0.8), uBase, street);
          float roadX = smoothstep(0.475, 0.5, f.x);
          float roadZ = smoothstep(0.475, 0.5, f.y);
          float traffic = step(0.5, fract(p.y / 9.0 + uTime * 0.6 * sign(hash2(vec2(id.x, 3.0)) - 0.5) + hash2(id)));
          float trafficZ = step(0.5, fract(p.x / 9.0 - uTime * 0.5 + hash2(id.yx)));
          color += uLight * (roadX * traffic + roadZ * trafficZ) * uLightStrength;
        } else if (uPattern < 1.5) {
          float ripple = sin(p.x * 0.08 + sin(p.y * 0.03) * 3.0) * 0.5 + 0.5;
          float dune = sin(p.x * 0.011 + p.y * 0.007) * 0.5 + 0.5;
          color = mix(uBase, uAccent, dune * 0.6 + ripple * 0.15);
        } else {
          float drift = sin(p.x * 0.02 + sin(p.y * 0.015) * 2.0) * 0.5 + 0.5;
          color = mix(uBase, uAccent, drift * 0.5 + hash2(floor(p * 0.2)) * 0.05);
        }
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = floorY
  mesh.frustumCulled = false
  mesh.name = 'ground'
  return {
    mesh,
    update(camera, time) {
      mesh.position.x = camera.position.x
      mesh.position.z = camera.position.z
      material.uniforms.uTime!.value = time
    },
    dispose() {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}

export type WeatherKind = 'rain' | 'snow' | 'dust' | 'spray'

/** Camera-following precipitation. Rain draws as streaks, the rest as soft points. */
/** Rain and snow stop under cover and never streak across the lens. */
const WEATHER_CLEAR_RADIUS = 4.5
const RAIN_LENGTH = 0.8
const RAIN_TILT = 0.9

export interface Weather {
  object: THREE.Object3D
  /** `dist` is the courier's route distance, used to fade the weather out inside tunnels. */
  update(camera: THREE.Camera, dt: number, dist: number): void
  dispose(): void
}

export function createWeather(kind: WeatherKind, count: number, color: string, random: Random, route: Route): Weather {
  const box = { x: 60, y: 34, z: 90 }
  const shelters = route.track.setPieces.filter(piece => piece.kind === 'tunnel').map(piece => ({ from: fromQ(piece.dist) - 10, to: fromQ(piece.dist + piece.length) + 4 }))
  const offsets = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    offsets[i * 3] = (random() - 0.5) * box.x
    offsets[i * 3 + 1] = random() * box.y - 8
    offsets[i * 3 + 2] = (random() - 0.5) * box.z
  }
  const tint = new THREE.Color(color)
  const streak = kind === 'rain'
  const positions = new Float32Array(count * (streak ? 6 : 3))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
  const material = streak
    ? new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.PointsMaterial({ color: tint, size: kind === 'snow' ? 0.16 : 0.1, transparent: true, opacity: kind === 'dust' ? 0.35 : 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
  const object: THREE.Object3D = streak ? new THREE.LineSegments(geometry, material) : new THREE.Points(geometry, material)
  object.frustumCulled = false
  object.name = `weather-${kind}`
  const fall = kind === 'rain' ? 26 : kind === 'snow' ? 2.2 : kind === 'spray' ? -0.6 : 0.4
  const drift = kind === 'snow' ? 1.2 : kind === 'dust' ? 3.5 : 0.8
  const opacity = material.opacity
  let exposure = 1
  let clock = 0
  return {
    object,
    update(camera, dt, dist) {
      let covered = false
      for (const shelter of shelters) covered ||= dist > shelter.from && dist < shelter.to
      exposure += ((covered ? 0 : 1) - exposure) * (1 - Math.exp(-3 * dt))
      material.opacity = opacity * exposure
      object.visible = exposure > 0.02
      if (!object.visible) return
      clock += dt
      const origin = camera.position
      for (let i = 0; i < count; i++) {
        let y = offsets[i * 3 + 1]! - fall * dt
        if (y < -10) y += box.y
        if (y > box.y - 8) y -= box.y
        offsets[i * 3 + 1] = y
        const sway = kind === 'snow' ? Math.sin(clock * 0.8 + i) * 0.6 : 0
        const x = origin.x + wrap(offsets[i * 3]! + clock * drift - origin.x, box.x) + sway
        const z = origin.z + wrap(offsets[i * 3 + 2]! - origin.z, box.z)
        const worldY = origin.y + y
        if (streak) {
          const near = (x - origin.x) ** 2 + (z - origin.z) ** 2 < WEATHER_CLEAR_RADIUS * WEATHER_CLEAR_RADIUS
          positions[i * 6] = x
          positions[i * 6 + 1] = worldY
          positions[i * 6 + 2] = z
          positions[i * 6 + 3] = x
          positions[i * 6 + 4] = near ? worldY : worldY - RAIN_LENGTH
          positions[i * 6 + 5] = near ? z : z + RAIN_TILT
        } else {
          positions[i * 3] = x
          positions[i * 3 + 1] = worldY
          positions[i * 3 + 2] = z
        }
      }
      geometry.attributes.position!.needsUpdate = true
    },
    dispose() {
      object.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}

function wrap(value: number, size: number): number {
  return ((((value + size / 2) % size) + size) % size) - size / 2
}
