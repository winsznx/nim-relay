import * as THREE from 'three'
import type { QualityTier } from './quality'

/**
 * Materials shared by every chunk and prop in one mounted race. Geometry carries
 * linear vertex colours (values above 1 are emissive and feed bloom), so a
 * handful of materials cover the whole track and each chunk draws in a few calls.
 */

export interface SceneMaterials {
  deck: THREE.MeshStandardMaterial
  structure: THREE.MeshStandardMaterial
  glow: THREE.MeshBasicMaterial
  glowAdditive: THREE.MeshBasicMaterial
  pulse: THREE.MeshBasicMaterial
  boost: THREE.ShaderMaterial
  particleTexture: THREE.Texture
  update(timeSeconds: number, beat: number): void
  /** High tier gets a glossy deck with sky sheen; lower tiers a matte composite. */
  setQuality(tier: QualityTier): void
  dispose(): void
}

export interface MaterialStyle {
  deckRoughness: number
  deckMetalness: number
  tier: QualityTier
}

const MATTE_DECK_ROUGHNESS = 0.8
const MATTE_DECK_METALNESS = 0.08

const deckFunctions = /* glsl */ `
uniform float uGrain;
float deckHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`

/**
 * Composite deck panels drawn from route UVs (u = lateral / 3 m, v = distance / 6 m):
 * transverse seams with a lit bevel every 4 m that rush past at speed, faint lane
 * grooves and fine aggregate. Surfaces with constant UVs (skirts, curbs, ramps) stay
 * plain, and every line fades out before it can alias in the distance.
 */
const deckColor = /* glsl */ `
float deckRough = 0.0;
{
  vec2 deckCoord = vec2(vUv.x * 3.0, vUv.y * 6.0);
  vec2 deckWidth = fwidth(deckCoord);
  float deckSurface = step(1e-6, deckWidth.x + deckWidth.y);
  float seamCoord = deckCoord.y / 4.0;
  float seamWidth = deckWidth.y / 4.0;
  float seamFade = 1.0 - smoothstep(0.04, 0.16, seamWidth);
  float seam = (1.0 - smoothstep(0.003, 0.003 + seamWidth * 1.5, abs(fract(seamCoord + 0.5) - 0.5))) * seamFade;
  float bevel = (1.0 - smoothstep(0.0, 0.004 + seamWidth * 1.5, abs(fract(seamCoord) - 0.011))) * seamFade;
  float grooveWidth = deckWidth.x / 1.5;
  float groove = (1.0 - smoothstep(0.004, 0.004 + grooveWidth * 1.5, abs(fract(deckCoord.x / 1.5 + 0.5) - 0.5))) * (1.0 - smoothstep(0.06, 0.2, grooveWidth));
  float grainFade = (1.0 - smoothstep(0.012, 0.05, max(deckWidth.x, deckWidth.y))) * uGrain;
  float speckle = (deckHash(floor(deckCoord * 18.0)) - 0.5) * grainFade;
  float shade = (1.0 + speckle * 0.18) * (1.0 - seam * 0.7) * (1.0 - groove * 0.3) + bevel * 1.4;
  diffuseColor.rgb *= mix(1.0, shade, deckSurface);
  deckRough = (seam * 0.3 + speckle * 0.2) * deckSurface;
}
`

function createDeckMaterial(style: MaterialStyle): { material: THREE.MeshStandardMaterial; grain: { value: number } } {
  const grain = { value: 1 }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: style.deckRoughness, metalness: style.deckMetalness })
  material.defines = { USE_UV: '' }
  material.onBeforeCompile = shader => {
    shader.uniforms.uGrain = grain
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${deckFunctions}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${deckColor}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + deckRough, 0.04, 1.0);')
  }
  material.customProgramCacheKey = () => 'race-deck'
  return { material, grain }
}

export function createParticleTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.7)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** View depth where near-camera fading starts and ends, in metres. */
export const NEAR_FADE_FROM = 1.6
export const NEAR_FADE_TO = 4.2

/**
 * Dissolves a surface with a screen-space dither as the chase camera closes on
 * it, so gate blades and hazard light bars beside the courier never streak
 * across the lens. Uses the fragment's view depth, so it needs no extra varyings.
 */
export function fadeNearCamera(material: THREE.MeshBasicMaterial, cacheKey: string): void {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      [
        '#include <clipping_planes_fragment>',
        '{',
        `  float nearKeep = smoothstep(${NEAR_FADE_FROM.toFixed(2)}, ${NEAR_FADE_TO.toFixed(2)}, 1.0 / gl_FragCoord.w);`,
        '  if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > nearKeep) discard;',
        '}',
      ].join('\n'),
    )
  }
  material.customProgramCacheKey = () => cacheKey
}

/** Fresnel rim light so silhouettes separate from dark skies without extra lights. */
export function addRimLight(material: THREE.MeshStandardMaterial, color: THREE.Color, power = 2.4): void {
  const rimColor = { value: color }
  const rimPower = { value: power }
  material.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = rimColor
    shader.uniforms.uRimPower = rimPower
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '{',
          '  float rimFacing = saturate(dot(normal, normalize(vViewPosition)));',
          '  totalEmissiveRadiance += uRimColor * pow(1.0 - rimFacing, uRimPower);',
          '}',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'rim-light'
}

const boostVertex = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const boostFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uBase;
  varying vec2 vUv;
  void main() {
    float across = abs(vUv.x - 0.5) * 2.0;
    float along = vUv.y * 1.6 - uTime * 3.2;
    float chevron = fract(along - across * 0.45);
    float stripe = smoothstep(0.0, 0.06, chevron) * (1.0 - smoothstep(0.28, 0.36, chevron));
    float rim = smoothstep(0.82, 0.94, across);
    float glow = max(stripe * (1.0 - across * 0.35), rim * 0.9);
    vec3 color = mix(uBase, uColor, glow);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export function createSceneMaterials(style: MaterialStyle): SceneMaterials {
  const particleTexture = createParticleTexture()
  const { material: deck, grain } = createDeckMaterial(style)
  const applyTier = (tier: QualityTier): void => {
    const glossy = tier === 'high'
    deck.roughness = glossy ? style.deckRoughness : MATTE_DECK_ROUGHNESS
    deck.metalness = glossy ? style.deckMetalness : MATTE_DECK_METALNESS
    grain.value = tier === 'low' ? 0 : 1
  }
  applyTier(style.tier)
  const structure = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.2 })
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  const glowAdditive = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const pulse = new THREE.MeshBasicMaterial({ vertexColors: true })
  const boost = new THREE.ShaderMaterial({
    vertexShader: boostVertex,
    fragmentShader: boostFragment,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(1.7, 0.9, 0.18) },
        uBase: { value: new THREE.Color(0.16, 0.08, 0.01) },
      },
    ]),
  })

  return {
    deck,
    structure,
    glow,
    glowAdditive,
    pulse,
    boost,
    particleTexture,
    update(timeSeconds, beat) {
      boost.uniforms.uTime!.value = timeSeconds
      pulse.color.setScalar(0.3 + beat * 0.85)
    },
    setQuality: applyTier,
    dispose() {
      particleTexture.dispose()
      for (const material of [deck, structure, glow, glowAdditive, pulse, boost]) material.dispose()
    },
  }
}
