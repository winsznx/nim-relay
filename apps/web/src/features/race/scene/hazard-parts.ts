import * as THREE from 'three'
import { fadeNearCamera } from './materials'

/**
 * Shared shapes and materials for hazards. Hazards speak one language: dark
 * armoured bodies, red and white warning stripes on the faces a courier meets,
 * and red light bars that stay readable in the darkest world.
 */

export interface HazardMaterials {
  stripe: THREE.MeshStandardMaterial
  plain: THREE.MeshStandardMaterial
  /** Camera-facing warning triangle that marks a hazard from far away. */
  warning: THREE.ShaderMaterial
  light: THREE.MeshBasicMaterial
  additive: THREE.MeshBasicMaterial
  gust: THREE.ShaderMaterial
  /** Floor telegraphs: red hazard stripes on blocked lanes, gold chevrons on open ones. */
  floor: THREE.ShaderMaterial
  update(time: number): void
  dispose(): void
}

/** Red fresnel edge on hazard bodies so their silhouettes read as danger against any sky. */
const HAZARD_RIM = new THREE.Color(1.0, 0.05, 0.06)
const hazardRimChunk = [
  '{',
  '  float hazardFacing = saturate(dot(normal, normalize(vViewPosition)));',
  '  totalEmissiveRadiance += uHazardRim * pow(1.0 - hazardFacing, 2.6);',
  '}',
].join('\n')

/**
 * Hazard bodies dissolve with a screen-space dither as the chase camera closes
 * on them, so a gantry post or barrier the courier has just passed never fills
 * the lens.
 */
const nearCameraDither = [
  '#include <clipping_planes_fragment>',
  '{',
  '  float cameraGap = length(vViewPosition);',
  '  float keep = smoothstep(1.6, 4.2, cameraGap);',
  '  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
  '  if (dither > keep) discard;',
  '}',
].join('\n')

const warningVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = instanceColor.r;
    vec4 centre = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
    centre.xy += position.xy * length(instanceMatrix[0].xyz);
    gl_Position = projectionMatrix * centre;
  }
`

const warningFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  float triangleDistance(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    p.y += 0.1;
    float shape = triangleDistance(p, 0.74) - 0.1;
    float aa = max(fwidth(shape), 0.01);
    float fill = 1.0 - smoothstep(-aa, aa, shape);
    float rim = fill * smoothstep(-aa, aa, shape + 0.14);
    vec2 bar = abs(p - vec2(0.0, 0.1)) - vec2(0.075, 0.24);
    float barDistance = length(max(bar, 0.0)) + min(max(bar.x, bar.y), 0.0);
    float dotDistance = length(p - vec2(0.0, -0.3)) - 0.085;
    float mark = 1.0 - smoothstep(-aa, aa, min(barDistance, dotDistance));
    float pulse = 0.82 + 0.18 * sin(uTime * 7.0);
    vec3 red = vec3(3.0, 0.2, 0.26);
    vec3 color = mix(red * 0.55 * pulse, vec3(0.02, 0.0, 0.0), mark);
    color = mix(color, red * pulse, rim);
    gl_FragColor = vec4(color, fill * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface StripeOptions {
  cacheKey: string
  /** Stripe colour, or null to take it from each instance's colour. */
  stripe: THREE.Color | null
  /** Emissive strength of the stripes. */
  glow: number
  /** Body colour between stripes when stripes come from instances. */
  body?: THREE.Color
  /** Red fresnel edge on the silhouette. */
  rim?: boolean
}

/**
 * Armoured body with diagonal warning stripes on the faces a courier meets.
 * Bodies dissolve near the camera so a passed obstacle never fills the lens.
 */
export function createStripeMaterial(options: StripeOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.35 })
  const stripeColor = { value: options.stripe ?? new THREE.Color(1, 1, 1) }
  const stripeGlow = { value: options.glow }
  const body = { value: options.body ?? new THREE.Color(0.12, 0.12, 0.13) }
  const rim = { value: options.rim === false ? new THREE.Color(0, 0, 0) : HAZARD_RIM }
  const fromInstance = options.stripe === null
  material.onBeforeCompile = shader => {
    shader.uniforms.uStripeColor = stripeColor
    shader.uniforms.uStripeGlow = stripeGlow
    shader.uniforms.uStripeBody = body
    shader.uniforms.uHazardRim = rim
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStripeCoord;\nvarying vec3 vStripeNormal;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec3 stripeScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));',
          '#else',
          '  vec3 stripeScale = vec3(1.0);',
          '#endif',
          '  vStripeCoord = position * stripeScale;',
          '  vStripeNormal = normal;',
        ].join('\n'),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uStripeColor;\nuniform float uStripeGlow;\nuniform vec3 uStripeBody;\nuniform vec3 uHazardRim;\nvarying vec3 vStripeCoord;\nvarying vec3 vStripeNormal;')
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float stripeFacing = step(0.55, abs(vStripeNormal.z));',
          'float stripeBand = step(0.5, fract((vStripeCoord.x + vStripeCoord.y) * 1.7));',
          'float stripeMask = stripeFacing * stripeBand;',
          fromInstance ? 'vec3 stripeTint = diffuseColor.rgb;' : 'vec3 stripeTint = uStripeColor;',
          fromInstance ? 'diffuseColor.rgb = mix(uStripeBody, stripeTint, stripeMask);' : 'diffuseColor.rgb = mix(diffuseColor.rgb * 0.16, stripeTint, stripeMask);',
        ].join('\n'),
      )
      .replace('#include <clipping_planes_fragment>', nearCameraDither)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += stripeTint * uStripeGlow * stripeMask;\n${hazardRimChunk}`)
  }
  material.customProgramCacheKey = () => options.cacheKey
  return material
}

/** Dark armoured body with a red rim, tinted by instance colour. */
export function createBodyMaterial(cacheKey: string, color: THREE.ColorRepresentation, rim = true): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.55 })
  const rimColor = { value: rim ? HAZARD_RIM : new THREE.Color(0, 0, 0) }
  material.onBeforeCompile = shader => {
    shader.uniforms.uHazardRim = rimColor
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHazardRim;')
      .replace('#include <clipping_planes_fragment>', nearCameraDither)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${hazardRimChunk}`)
  }
  material.customProgramCacheKey = () => cacheKey
  return material
}

export function createHazardMaterials(): HazardMaterials {
  const stripe = createStripeMaterial({ cacheKey: 'hazard-stripe', stripe: new THREE.Color(0.75, 0.035, 0.05), glow: 1.2 })
  const plain = createBodyMaterial('hazard-plain', 0x1b1d24)
  const warning = new THREE.ShaderMaterial({
    vertexShader: warningVertex,
    fragmentShader: warningFragment,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
  })
  const light = new THREE.MeshBasicMaterial({ color: 0xffffff })
  fadeNearCamera(light, 'hazard-light')
  const additive = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  const gust = createGustMaterial()
  const floor = createFloorMaterial()
  return {
    stripe,
    plain,
    warning,
    light,
    additive,
    gust,
    floor,
    update(time) {
      gust.uniforms.uTime!.value = time
      floor.uniforms.uTime!.value = time
      warning.uniforms.uTime!.value = time
    },
    dispose() {
      for (const material of [stripe, plain, warning, light, additive, gust, floor]) material.dispose()
    },
  }
}

/** Additive wind streaks. Instance colour: r intensity, g phase, b > 0.5 blows towards positive lateral. */
export function createGustMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float head = fract(vUv.x - uTime * 1.6 * sign(vColor.b - 0.5) + vColor.g * 7.0);
        float streak = smoothstep(0.0, 0.7, head) * (1.0 - smoothstep(0.7, 0.78, head));
        float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
        float nearFade = smoothstep(2.0, 7.0, 1.0 / gl_FragCoord.w);
        float intensity = streak * across * vColor.r * nearFade;
        gl_FragColor = vec4(vec3(0.95, 1.0, 1.12) * intensity, 1.0);
      }
    `,
  })
}

/**
 * Deck telegraph decals, sized from the instance scale. Red instances draw
 * hazard stripes; gold or amber instances draw chevrons flowing down the route.
 */
export function createFloorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec2 vSize;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        vSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec2 vSize;
      void main() {
        vec2 metres = vec2(vUv.x * vSize.x, (1.0 - vUv.y) * vSize.y);
        float across = abs(vUv.x - 0.5) * 2.0;
        float danger = step(vColor.g * 1.6, vColor.r);
        float stripes = step(0.55, fract((metres.x + metres.y) * 0.85));
        float chevrons = step(0.6, fract(metres.y * 0.7 - across * 0.9 - uTime * 1.4));
        float pattern = mix(chevrons * 0.9, stripes, danger);
        float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y) * (1.0 - smoothstep(0.82, 1.0, across));
        gl_FragColor = vec4(vColor * pattern * fade, 1.0);
      }
    `,
  })
}

export function droneGeometry(): THREE.BufferGeometry {
  const hull = new THREE.CylinderGeometry(0.42, 0.55, 0.26, 6, 1)
  const arms = new THREE.BoxGeometry(2.0, 0.07, 0.16)
  const armsCross = new THREE.BoxGeometry(0.16, 0.07, 1.4)
  const pod = new THREE.SphereGeometry(0.22, 10, 8)
  pod.translate(0, -0.18, -0.22)
  return mergeSimple([hull, arms, armsCross, pod])
}

export function rotorGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(0.34, 18).rotateX(-Math.PI / 2)
}

export function streakGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1, 1, 1)
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(part => (part.index ? part.toNonIndexed() : part))
  let count = 0
  for (const part of flat) count += part.getAttribute('position').count
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  let offset = 0
  for (const part of flat) {
    positions.set(part.getAttribute('position').array, offset * 3)
    normals.set(part.getAttribute('normal').array, offset * 3)
    offset += part.getAttribute('position').count
  }
  for (const part of [...parts, ...flat]) part.dispose()
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return merged
}
