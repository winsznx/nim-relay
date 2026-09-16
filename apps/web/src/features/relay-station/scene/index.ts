import * as THREE from 'three'
import type { StationSurfaceId, StationViewData } from '../view-model'
import { createCameraRig } from './camera-rig'
import { createCity } from './environment/city'
import { createDust } from './environment/dust'
import { createLighting } from './environment/lighting'
import { createSky } from './environment/sky'
import { createTransit } from './environment/transit'
import { attachStationInput } from './input'
import { createKit } from './kit'
import { COLOR } from './palette'
import { createPlatform } from './platform'
import { createFrameMonitor, resolveQuality } from './quality'
import { createChronicle } from './surfaces/chronicle'
import { createCourierBay } from './surfaces/courier'
import { createDepartures } from './surfaces/departures'
import { createLivePortal } from './surfaces/live'
import { createRankings } from './surfaces/rankings'
import { createVault } from './surfaces/vault'
import { createWorld } from './surfaces/world'
import type { RelayStationHandle, RelayStationOptions, StationSurface } from './types'

export type { RelayStationHandle, RelayStationOptions, RelayStationStats, QualityPreference } from './types'

const MAX_DELTA = 0.1

/**
 * Mounts the Relay Station into `host` and starts rendering. Throws when WebGL is
 * unavailable, so callers can fall back to a non-3D presentation.
 */
export function mountRelayStation(host: HTMLElement, options: RelayStationOptions): RelayStationHandle {
  const settings = resolveQuality(options.quality)
  const renderer = new THREE.WebGLRenderer({ antialias: settings.antialias, powerPreference: 'high-performance', alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = settings.shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Reset per frame by hand: three resets after the shadow pass, which would hide its draw calls.
  renderer.info.autoReset = false
  const canvas = renderer.domElement
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;-webkit-tap-highlight-color:transparent'
  canvas.setAttribute('aria-hidden', 'true')
  host.appendChild(canvas)

  const kit = createKit(renderer, settings)
  const scene = new THREE.Scene()
  scene.background = COLOR.fog.clone()
  const fog = new THREE.FogExp2(COLOR.fog.getHex(), kit.uniforms.uFogDensity.value)
  fog.color = kit.uniforms.uFogColor.value
  scene.fog = fog
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 2400)

  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = options.reducedMotion ?? media.matches
  const reducedMotion = () => reduced

  scene.add(createSky(kit))
  scene.add(createCity(kit))
  const transit = createTransit(kit)
  scene.add(transit.object)
  const platform = createPlatform(kit)
  scene.add(platform.object)
  const dust = createDust(kit)
  scene.add(dust.object)
  createLighting(kit, scene)

  const surfaces: StationSurface[] = [
    createDepartures(kit, reducedMotion),
    createWorld(kit, reducedMotion),
    createLivePortal(kit, reducedMotion),
    createRankings(kit),
    createChronicle(kit),
    createVault(kit, reducedMotion),
    createCourierBay(kit, reducedMotion),
  ]
  for (const surface of surfaces) scene.add(surface.root)
  kit.buildBatches(scene)

  const byHit = new Map<THREE.Object3D, StationSurface>(surfaces.map(surface => [surface.hitTarget, surface]))
  const hitTargets = surfaces.map(surface => surface.hitTarget)
  const rig = createCameraRig(camera, reduced)
  let focusedId: StationSurfaceId | null = null
  let width = 1
  let height = 1

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const hits: THREE.Intersection[] = []
  function pick(x: number, y: number): StationSurface | null {
    pointer.set((x / width) * 2 - 1, -(y / height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    hits.length = 0
    raycaster.intersectObjects(hitTargets, false, hits)
    const nearest = hits[0]
    return nearest ? (byHit.get(nearest.object) ?? null) : null
  }

  function focus(id: StationSurfaceId | null): void {
    if (id === focusedId) return
    focusedId = id
    const target = surfaces.find(surface => surface.id === id) ?? null
    for (const surface of surfaces) surface.setFocused(surface === target)
    rig.focus(target ? target.frame : null)
  }

  let hoverX: number | null = null
  let hoverY: number | null = null
  let hoverDirty = false
  const detachInput = attachStationInput(canvas, {
    tap(x, y) {
      const surface = pick(x, y)
      if (surface) {
        focus(surface.id)
        options.onSelect(surface.id)
      } else if (focusedId !== null) {
        focus(null)
        options.onSelect(null)
      }
    },
    drag: (dx, dy) => rig.orbit(dx, dy),
    zoom: factor => rig.zoom(factor),
    hover(x, y) {
      hoverX = x
      hoverY = y
      hoverDirty = true
    },
  })

  function resize(): void {
    width = Math.max(1, host.clientWidth)
    height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    kit.uniforms.uPixelRatio.value = renderer.getPixelRatio()
    rig.setViewport(width, height)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  function onReducedMotionChange(event: MediaQueryListEvent): void {
    if (options.reducedMotion !== undefined) return
    reduced = event.matches
    rig.setReducedMotion(reduced)
  }
  media.addEventListener('change', onReducedMotionChange)

  const monitor = createFrameMonitor()
  const adaptive = (options.quality ?? 'auto') === 'auto'
  let frame = 0
  let running = false
  let last = 0
  let elapsed = 0
  let frames = 0
  let framesWithData = -1

  function render(now: number): void {
    frame = requestAnimationFrame(render)
    const delta = Math.min(MAX_DELTA, Math.max(0, (now - last) / 1000))
    last = now
    elapsed += delta
    kit.uniforms.uTime.value = elapsed

    transit.tick(elapsed, reduced)
    for (let index = 0; index < surfaces.length; index++) surfaces[index]?.tick(elapsed, delta)
    rig.tick(elapsed, delta)
    if (hoverDirty) {
      hoverDirty = false
      canvas.style.cursor = hoverX !== null && hoverY !== null && pick(hoverX, hoverY) ? 'pointer' : 'grab'
    }
    renderer.info.reset()
    renderer.render(scene, camera)
    frames++

    if (adaptive && monitor.sample(delta, elapsed)) shedLoad()
    if (framesWithData >= 0 && framesWithData < 2 && ++framesWithData === 2) host.dataset.stationReady = 'true'
    if (import.meta.env.DEV && frames % 30 === 0) publishDevStats()
  }

  function shedLoad(): void {
    const ratio = renderer.getPixelRatio()
    if (ratio > 1) {
      renderer.setPixelRatio(Math.max(1, ratio - 0.25))
      resize()
    } else {
      dust.setBudget(0.4)
    }
  }

  function publishDevStats(): void {
    host.dataset.drawCalls = String(renderer.info.render.calls)
    host.dataset.tier = settings.tier
    const anchors: Record<string, [number, number]> = {}
    const point = new THREE.Vector3()
    for (const surface of surfaces) {
      surface.hitTarget.getWorldPosition(point).project(camera)
      anchors[surface.id] = [Math.round(((point.x + 1) / 2) * width), Math.round(((1 - point.y) / 2) * height)]
    }
    host.dataset.anchors = JSON.stringify(anchors)
  }

  function start(): void {
    if (running) return
    running = true
    last = performance.now()
    frame = requestAnimationFrame(render)
  }
  function stop(): void {
    running = false
    cancelAnimationFrame(frame)
  }
  function onVisibility(): void {
    if (document.hidden) stop()
    else start()
  }
  document.addEventListener('visibilitychange', onVisibility)
  if (!document.hidden) start()

  return {
    update(data: StationViewData) {
      if (framesWithData < 0) framesWithData = 0
      for (const surface of surfaces) surface.update(data)
      const live = data.live.state === 'live'
      platform.setLive(live)
      dust.setLive(live)
    },
    focus,
    stats() {
      return { drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, tier: settings.tier, pixelRatio: renderer.getPixelRatio() }
    },
    dispose() {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      media.removeEventListener('change', onReducedMotionChange)
      observer.disconnect()
      detachInput()
      for (const surface of surfaces) surface.dispose()
      kit.dispose()
      scene.clear()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      delete host.dataset.stationReady
    },
  }
}
