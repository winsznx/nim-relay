import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { RaceSource, SceneStats } from '../scene'
import { createDensity } from '../scene/density'
import { createWorldEvents } from '../scene/events'
import { GateField } from '../scene/gates'
import { HazardField } from '../scene/hazards'
import { createSceneMaterials } from '../scene/materials'
import type { QualityTier } from '../scene/quality'
import { createRaceRenderer } from '../scene/renderer'
import { Route, createRouteFrame, fromQ } from '../scene/route'
import { rampSurfaceHeight } from '../scene/track-features'
import { TrackStreamer } from '../scene/track-mesh'
import { WORLD_KITS } from '../scene/worlds'
import { createHandoffGate } from '../scene/worlds/handoff-gate'
import { buildSetPieces } from '../scene/worlds/set-pieces'
import type { WorldFrame } from '../scene/worlds/types'

/**
 * The world alone, for captures: renderer, track, world kit, set pieces,
 * gates, hazards and world events, with a stand-in courier and a plain camera.
 * It depends on nothing from the courier, race camera or controller.
 *
 *   view=chase   behind the courier, like the race camera
 *   view=high    raised chase to read lanes and forks
 *   view=side    level with the deck from outside the edge, to read drops
 *   view=top     straight down over the courier, to check lateral placement
 */

export type WorldView = 'chase' | 'high' | 'side' | 'top'

export interface WorldSceneOptions {
  source: RaceSource
  track: relayLeg.Track
  quality: QualityTier
  view: WorldView
  /** Holographic text over the handoff gate, or null. */
  label: string | null
  onStats(stats: SceneStats): void
  onDist(metres: number): void
}

const HOVER = 0.26

export function mountWorldScene(host: HTMLElement, options: WorldSceneOptions): () => void {
  const kit = WORLD_KITS[options.track.world]
  const route = new Route(options.track)
  const raceRenderer = createRaceRenderer(host, kit.style, options.quality)
  const { scene } = raceRenderer
  const settings = raceRenderer.settings
  const materials = createSceneMaterials({ deckRoughness: kit.style.deckRoughness, deckMetalness: kit.style.deckMetalness, tier: settings.tier })
  const track = new TrackStreamer(route, materials, kit.style.track, settings.tier === 'low' ? 2.5 : 1.5, settings.drawDistance)
  scene.add(track.group)
  const world = kit.build({ scene, route, quality: settings, materials, floorY: track.floorY, style: kit.style })
  const setPieces = buildSetPieces(route, track.floorY, kit.style)
  for (const piece of setPieces) scene.add(piece.group)
  const handoffGate = createHandoffGate(route, track.floorY)
  scene.add(handoffGate.group)
  handoffGate.setHandoffLabel(options.label)
  const gates = new GateField(route)
  scene.add(gates.group)
  const hazards = new HazardField(route, settings.tier !== 'low')
  scene.add(hazards.group)
  const events = createWorldEvents(scene, route, kit, settings)

  const courier = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.5, metalness: 0.3 })
  const boardMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.3) })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 4, 10), bodyMaterial)
  body.position.y = 0.95
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 1.5), boardMaterial)
  courier.add(body, board)
  scene.add(courier)

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000)
  scene.add(camera)
  const density = createDensity(scene, route, options.track.world, settings, track.floorY, camera, raceRenderer.renderer.domElement)
  raceRenderer.resize(camera)
  const observer = new ResizeObserver(() => raceRenderer.resize(camera))
  observer.observe(host)
  track.update(0, true)

  const frameData: WorldFrame = { time: 0, dt: 0, camera, dist: 0, flow: 0.6, finale: 0 }
  const eye = new THREE.Vector3()
  const aim = new THREE.Vector3()
  const routeFrame = createRouteFrame()
  let raf = 0
  let lastNow: number | null = null
  let time = 0
  let statsFrames = 0
  let statsTime = 0

  function loop(now: number): void {
    raf = requestAnimationFrame(loop)
    const dt = lastNow === null ? 1 / 60 : Math.min(0.1, (now - lastNow) / 1000)
    lastNow = now
    time += dt
    options.source.frame(now)
    const { state, previous, alpha, frameEvents } = options.source.getRenderSnapshot()
    const lerp = (a: number, b: number): number => a + (b - a) * alpha
    const dist = fromQ(lerp(previous.dist, state.dist))
    const path = alpha < 0.5 ? previous.path : state.path
    const lateral = route.pathOffset(path, dist) + fromQ(lerp(previous.x, state.x))
    const height = HOVER + fromQ(lerp(previous.y, state.y)) + rampSurfaceHeight(route, dist, lateral, path)
    route.point(dist, lateral, height, courier.position)
    courier.quaternion.copy(route.frame(dist, routeFrame).quaternion)
    options.onDist(dist)

    const centre = route.pathOffset(path, dist)
    if (options.view === 'top') {
      route.point(dist + 6, centre, 34, eye)
      route.point(dist + 6.01, centre, 0, aim)
      camera.up.copy(routeFrame.forward)
    } else if (options.view === 'side') {
      const side = lateral >= centre ? 1 : -1
      route.point(dist + 4, centre + side * (route.halfWidth(path, dist) + 9), 1.2, eye)
      route.point(dist + 10, lateral, 0.5, aim)
    } else if (options.view === 'high') {
      route.point(dist - 12, lateral * 0.6 + centre * 0.4, height + 9, eye)
      route.point(dist + 22, lateral * 0.3 + centre * 0.7, 0, aim)
    } else {
      route.point(dist - 5.5, lateral * 0.85 + centre * 0.15, height + 2.1, eye)
      route.point(dist + 8, lateral * 0.7 + centre * 0.3, height + 0.7, aim)
    }
    camera.position.copy(eye)
    camera.lookAt(aim)

    gates.update(state, frameEvents, dt, [])
    hazards.update(dist, settings.drawDistance, state.tick, alpha, time, camera.position)
    events.update({ state, alpha, dist, camera }, time)
    density.update(time, dist)
    materials.update(time, 0)
    track.update(dist)
    frameData.time = time
    frameData.dt = dt
    frameData.dist = dist
    frameData.finale = Math.max(0, Math.min(1, (dist - (route.finish - 260)) / 260)) * 0.7
    handoffGate.update(time, frameData.finale)
    for (const piece of setPieces) piece.update(frameData)
    world.update(frameData)
    raceRenderer.sky.update(camera, time, frameData.finale)
    raceRenderer.key.position.copy(courier.position).add(eye.set(...kit.style.lighting.keyDirection).normalize().multiplyScalar(40))
    raceRenderer.key.target.position.copy(courier.position)
    raceRenderer.render(camera)

    statsFrames++
    statsTime += dt
    if (statsFrames >= 30) {
      const stats = raceRenderer.stats()
      options.onStats({ tier: settings.tier, calls: stats.calls, triangles: stats.triangles, fps: statsFrames / Math.max(0.001, statsTime) })
      statsFrames = 0
      statsTime = 0
    }
  }
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    observer.disconnect()
    track.dispose()
    world.dispose()
    for (const piece of setPieces) piece.dispose()
    handoffGate.dispose()
    gates.dispose()
    hazards.dispose()
    events.dispose()
    density.dispose()
    body.geometry.dispose()
    board.geometry.dispose()
    bodyMaterial.dispose()
    boardMaterial.dispose()
    materials.dispose()
    raceRenderer.dispose()
  }
}
