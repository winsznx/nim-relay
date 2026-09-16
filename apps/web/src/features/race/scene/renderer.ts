import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { QUALITY, detectQualityTier, type QualitySettings, type QualityTier } from './quality'
import { createSky, type Sky } from './worlds/sky'
import type { WorldStyle } from './worlds/types'

/**
 * WebGL setup for a race: renderer, scene, sky, environment reflections, lights
 * and the optional bloom chain. Quality changes adjust resolution, shadows and
 * bloom in place without rebuilding the scene.
 */

export interface RaceRenderer {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  sky: Sky
  key: THREE.DirectionalLight
  settings: QualitySettings
  setQuality(tier: QualityTier): void
  resize(camera: THREE.PerspectiveCamera): { width: number; height: number }
  render(camera: THREE.PerspectiveCamera): void
  stats(): { calls: number; triangles: number }
  dispose(): void
}

/** Only emissive accents (linear luminance above 1) bloom; lit surfaces stay crisp. */
const BLOOM_THRESHOLD = 1.05
const BLOOM_STRENGTH = 0.42
const BLOOM_RADIUS = 0.42

export class WebGLUnavailableError extends Error {
  constructor() {
    super('WebGL is not available')
    this.name = 'WebGLUnavailableError'
  }
}

function rendererString(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const value: unknown = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  return typeof value === 'string' ? value : ''
}

export function createRaceRenderer(host: HTMLElement, style: WorldStyle, requested: QualityTier | 'auto'): RaceRenderer {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance', alpha: false, stencil: false })
  } catch {
    throw new WebGLUnavailableError()
  }
  const tier = requested === 'auto'
    ? detectQualityTier({
        devicePixelRatio: window.devicePixelRatio,
        hardwareConcurrency: navigator.hardwareConcurrency,
        renderer: rendererString(renderer),
        viewportWidth: host.clientWidth || window.innerWidth,
      })
    : requested
  let settings = QUALITY[tier]

  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = style.lighting.exposure
  renderer.info.autoReset = false
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(style.sky.horizon)
  scene.fog = new THREE.FogExp2(style.fogColor, style.fogDensity)

  const sky = createSky(style.sky)
  scene.add(sky.mesh)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const environmentScene = new THREE.Scene()
  const environmentSky = createSky(style.sky)
  environmentScene.add(environmentSky.mesh)
  const environment = pmrem.fromScene(environmentScene, 0.02).texture
  environmentSky.dispose()
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = style.lighting.environmentIntensity

  const hemisphere = new THREE.HemisphereLight(style.lighting.hemisphereSky, style.lighting.hemisphereGround, style.lighting.hemisphereIntensity)
  scene.add(hemisphere)
  const key = new THREE.DirectionalLight(style.lighting.keyColor, style.lighting.keyIntensity)
  key.position.set(...style.lighting.keyDirection).multiplyScalar(40)
  key.shadow.camera.left = -9
  key.shadow.camera.right = 9
  key.shadow.camera.top = 9
  key.shadow.camera.bottom = -9
  key.shadow.camera.near = 1
  key.shadow.camera.far = 90
  key.shadow.bias = -0.0006
  key.shadow.normalBias = 0.02
  scene.add(key, key.target)

  let composer: EffectComposer | null = null
  let bloom: UnrealBloomPass | null = null
  let renderPass: RenderPass | null = null
  let size = { width: 1, height: 1 }

  function buildComposer(camera: THREE.PerspectiveCamera): void {
    if (!settings.bloom || composer) return
    composer = new EffectComposer(renderer)
    renderPass = new RenderPass(scene, camera)
    bloom = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
    composer.addPass(renderPass)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(size.width, size.height)
  }

  function disposeComposer(): void {
    bloom?.dispose()
    composer?.dispose()
    composer = null
    bloom = null
    renderPass = null
  }

  function applySettings(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.dprCap))
    renderer.shadowMap.enabled = settings.shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    key.castShadow = settings.shadows
    key.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize)
    key.shadow.map?.dispose()
    key.shadow.map = null
    if (!settings.bloom) disposeComposer()
  }
  applySettings()

  return {
    renderer,
    scene,
    sky,
    key,
    get settings() {
      return settings
    },
    setQuality(next) {
      if (next === settings.tier) return
      settings = QUALITY[next]
      applySettings()
      renderer.setSize(size.width, size.height, false)
      composer?.setPixelRatio(renderer.getPixelRatio())
      composer?.setSize(size.width, size.height)
    },
    resize(camera) {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      size = { width, height }
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      composer?.setPixelRatio(renderer.getPixelRatio())
      composer?.setSize(width, height)
      return size
    },
    render(camera) {
      renderer.info.reset()
      if (settings.bloom) {
        buildComposer(camera)
        if (renderPass) renderPass.camera = camera
        composer?.render()
      } else {
        renderer.render(scene, camera)
      }
    },
    stats() {
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
    },
    dispose() {
      disposeComposer()
      sky.dispose()
      environment.dispose()
      key.shadow.map?.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
