import * as THREE from 'three'
import type { StationKit } from '../kit'
import { COLOR } from '../palette'
import { createRandom } from '../random'
import { OUTPUT } from '../shaders'

const SKY_RADIUS = 900
const STAR_RADIUS = 820

/** Night sky dome with a warm band of city light on the horizon, and a field of slowly twinkling stars. */
export function createSky(kit: StationKit): THREE.Group {
  const group = new THREE.Group()
  group.name = 'sky'

  const dome = new THREE.Mesh(
    kit.track(new THREE.SphereGeometry(SKY_RADIUS, 48, 24)),
    kit.track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: kit.uniforms.uTime,
          uZenith: { value: COLOR.skyZenith },
          uMid: { value: COLOR.skyMid },
          uHorizon: { value: COLOR.skyHorizon },
          uGlow: { value: COLOR.cityGlow },
          uFog: kit.uniforms.uFogColor,
        },
        vertexShader: /* glsl */ `
          varying vec3 vDirection;
          void main() {
            vDirection = position;
            vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uZenith;
          uniform vec3 uMid;
          uniform vec3 uHorizon;
          uniform vec3 uGlow;
          uniform vec3 uFog;
          varying vec3 vDirection;
          void main() {
            vec3 direction = normalize(vDirection);
            float h = direction.y;
            vec3 color = mix(uFog, uHorizon, smoothstep(-0.12, 0.0, h));
            color = mix(color, uMid, smoothstep(0.02, 0.26, h));
            color = mix(color, uZenith, smoothstep(0.26, 0.9, h));
            float ahead = 0.45 + 0.55 * smoothstep(0.2, -0.9, direction.z);
            color += uGlow * pow(max(0.0, 1.0 - abs(h - 0.004) * 9.0), 4.0) * 0.07 * ahead;
            float veil = sin(direction.x * 4.0 + direction.z * 2.6 + uTime * 0.006) * sin(direction.z * 6.5 - direction.x * 2.1 - uTime * 0.004);
            color += vec3(0.012, 0.018, 0.04) * smoothstep(0.25, 1.0, veil) * smoothstep(0.06, 0.3, h) * (1.0 - smoothstep(0.3, 0.75, h));
            gl_FragColor = vec4(color, 1.0);
            ${OUTPUT}
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    ),
  )
  dome.renderOrder = -10
  dome.frustumCulled = false
  group.add(dome)
  group.add(createStars(kit))
  return group
}

function createStars(kit: StationKit): THREE.Points {
  const count = kit.settings.stars
  const random = createRandom(7331)
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const y = 0.02 + random() ** 1.6 * 0.98
    const angle = random() * Math.PI * 2
    const ring = Math.sqrt(1 - y * y)
    positions[i * 3] = Math.cos(angle) * ring * STAR_RADIUS
    positions[i * 3 + 1] = y * STAR_RADIUS
    positions[i * 3 + 2] = Math.sin(angle) * ring * STAR_RADIUS
    seeds[i * 2] = random()
    seeds[i * 2 + 1] = random() ** 3
  }
  const geometry = kit.track(new THREE.BufferGeometry())
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2))
  const material = kit.track(
    new THREE.ShaderMaterial({
      uniforms: { uTime: kit.uniforms.uTime, uPixelRatio: kit.uniforms.uPixelRatio },
      vertexShader: /* glsl */ `
        attribute vec2 aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vBrightness;
        void main() {
          float twinkle = 0.72 + 0.28 * sin(uTime * (0.4 + aSeed.x * 1.3) + aSeed.x * 40.0);
          float height = normalize(position).y;
          vBrightness = (0.3 + aSeed.y * 1.1) * twinkle * smoothstep(0.02, 0.16, height);
          gl_PointSize = (0.9 + aSeed.y * 2.2) * uPixelRatio;
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vBrightness;
        void main() {
          vec2 centre = gl_PointCoord - 0.5;
          float soft = smoothstep(0.5, 0.0, length(centre));
          gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * vBrightness * soft, 1.0);
          ${OUTPUT}
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  const stars = new THREE.Points(geometry, material)
  stars.renderOrder = -9
  stars.frustumCulled = false
  return stars
}
