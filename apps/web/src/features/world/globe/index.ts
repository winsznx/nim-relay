import * as THREE from 'three'
import { loadCountries } from './anchors'
import { buildAtlasLayer, type AtlasLayer, type GlobeAtlas } from './atlas'
import { GlobeControls, type Framing } from './controls'
import { createEarth } from './earth'
import { arcPoints, EARTH_RADIUS, latLonToVector, subsolarPoint, vectorToLatLon } from './geo'
import { FrameMonitor, initialTier } from './quality'
import { buildRoutes, createPointCloud, createPointMaterial, markDirty, relayColor, samplePolyline, stationPoint, writePoint, type GlobeRelay, type RouteLayer } from './routes'

export type { GlobeRelay } from './routes'
export type { GlobeAtlas, GlobeRouteHeat } from './atlas'
export type { Framing } from './controls'

export interface GlobeState {
  relays: readonly GlobeRelay[]
  featuredId: string | null
  selectedId: string | null
  /** Route heat and lit stations; null until the Atlas loads, when every route is drawn dark. */
  atlas: GlobeAtlas | null
}

/** What a tap on the globe picked: a baton, or an Atlas route. */
export type GlobeTarget = { kind: 'relay'; id: string } | { kind: 'route'; id: string }

export type FlightKind = 'grant' | 'handoff'

export interface GlobeOptions {
  onSelect(target: GlobeTarget): void
  /** Geography has loaded, so routes can be placed and flights and arrivals will land. */
  onReady?(handle: GlobeHandle): void
  /** Geography could not load, so relays can't be placed on this globe. */
  onUnavailable?(): void
}

export interface GlobeHandle {
  update(state: GlobeState): void
  /** Eases the camera to the relay's current holder. Resolves when the flight ends. */
  flyToRelay(relayId: string): Promise<void>
  /** Plays a baton crossing its latest hop between two Atlas stations and lights up the destination. */
  arrive(relayId: string, fromStation: string, toStation: string): void
  /** Flies a baton between two Atlas stations. Resolves when the flight's burst ends, at once with reduced motion. */
  flight(fromStation: string, toStation: string, kind: FlightKind): Promise<void>
  setFraming(framing: Framing): void
  /** Pauses rendering entirely, for example while a full-screen race owns the GPU. */
  setActive(active: boolean): void
  /** Renders at a lower rate while a sheet covers most of the globe. */
  setBackground(background: boolean): void
  /** Where the Earth is drawn: its center and radius in viewport pixels. Null until the first frame placed the camera. */
  disc(): GlobeDisc | null
  dispose(): void
}

export interface GlobeDisc {
  x: number
  y: number
  radius: number
}

interface Arrival {
  color: THREE.Color
  points: THREE.Vector3[]
  destination: THREE.Vector3
  /** Null until the first frame that shows the arrival. */
  start: number | null
  travelMs: number
  done: () => void
}

const GRANT_COLOR = new THREE.Color('#fff1c9')
const HANDOFF_COLOR = new THREE.Color('#ffc04d')
const BURST_MS = 1800

const reducedMotionQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)')

export function mountGlobe(host: HTMLElement, options: GlobeOptions): GlobeHandle | null {
  const tier = initialTier()
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: tier.name !== 'low', powerPreference: 'high-performance' })
  } catch (error) {
    console.warn('The globe needs WebGL, which this browser could not provide', error)
    host.dataset.globe = 'unavailable'
    return null
  }
  const reduced = reducedMotionQuery()
  let pixelRatio = Math.min(window.devicePixelRatio || 1, tier.dprCap)
  renderer.setPixelRatio(pixelRatio)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x05070f, 1)
  const canvas = renderer.domElement
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
  canvas.setAttribute('aria-hidden', 'true')
  host.appendChild(canvas)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 120)
  const earth = createEarth(tier)
  scene.add(earth.group)
  const pointMaterial = createPointMaterial()
  const arrivalCloud = createPointCloud(tier.trailPoints * 2 + 1, pointMaterial)
  scene.add(arrivalCloud.points)

  let state: GlobeState = { relays: [], featuredId: null, selectedId: null, atlas: null }
  let routes: RouteLayer | null = null
  let atlasLayer: AtlasLayer | null = null
  let signature = ''
  let atlasSignature = ''
  let geographyLoaded = false
  let framing: Framing = { centerX: 0.5, centerY: 0.4, fill: 0.92 }
  let width = 1
  let height = 1
  let fitDistance = 8
  let arrival: Arrival | null = null
  let alive = true
  let active = true
  let background = false
  let frame = 0
  let lastFrame = performance.now()
  let lastRender = 0

  const controls = new GlobeControls(canvas, (x, y) => {
    const picked = pick(x, y)
    if (picked) options.onSelect(picked)
  })
  const monitor = new FrameMonitor(pixelRatio, next => {
    pixelRatio = next
    renderer.setPixelRatio(next)
    renderer.setSize(width, height, false)
  })

  const updateSun = () => {
    const point = subsolarPoint(Date.now())
    earth.setSun(latLonToVector(point.lat, point.lon))
  }
  updateSun()
  const sunTimer = window.setInterval(updateSun, 60_000)

  let awaitingFlight: { relayId: string; done: () => void } | null = null

  function rebuild(): void {
    // Until geography loads every stop would look unlocated; wait rather than show that.
    if (!geographyLoaded) return
    const nextAtlas = JSON.stringify(state.atlas ? [[...state.atlas.routes], [...state.atlas.litStations]] : null)
    if (nextAtlas !== atlasSignature || !atlasLayer) {
      atlasSignature = nextAtlas
      atlasLayer?.dispose()
      atlasLayer = buildAtlasLayer(state.atlas, tier, pointMaterial)
      scene.add(atlasLayer.group)
    }
    const next = JSON.stringify([state.relays.map(relay => [relay.id, relay.mode, relay.team, relay.crewKey, relay.status, relay.live, relay.hops]), state.featuredId, state.selectedId])
    if (next === signature && routes) return
    signature = next
    routes?.dispose()
    routes = buildRoutes(state.relays, state, tier, pointMaterial)
    scene.add(routes.group)
    if (awaitingFlight && state.relays.some(relay => relay.id === awaitingFlight?.relayId)) {
      const { relayId, done } = awaitingFlight
      awaitingFlight = null
      void flyTo(relayId).then(done)
    }
  }

  /** A flight to a relay the globe hasn't received yet waits for the next data update. */
  function flyTo(relayId: string): Promise<void> {
    if (!state.relays.some(relay => relay.id === relayId)) {
      awaitingFlight?.done()
      return new Promise(resolve => {
        awaitingFlight = { relayId, done: resolve }
      })
    }
    const relay = routes?.built.find(item => item.relay.id === relayId)
    const target = relay?.holder ?? relay?.stops.at(-1)
    const duration = reduced.matches ? 250 : 1400
    if (!target) return controls.flyTo(controls.lat, controls.lon, 1.12, performance.now(), duration)
    const { lat, lon } = vectorToLatLon(target)
    return controls.flyTo(lat - 8, lon, 0.78, performance.now(), duration)
  }

  loadCountries()
    .then(countries => {
      if (!alive) return
      earth.setGeography(countries)
      geographyLoaded = true
      rebuild()
      host.dataset.mapReady = 'true'
      options.onReady?.(handle)
    })
    .catch((error: unknown) => {
      if (!alive) return
      host.dataset.mapError = 'true'
      console.warn('Earth geography could not load; relays without a map stay listed on screen', error)
      options.onUnavailable?.()
    })

  function project(point: THREE.Vector3, target: THREE.Vector2): THREE.Vector2 {
    const ndc = point.clone().project(camera)
    return target.set(((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height)
  }

  /** Finds the baton, or failing that the Atlas route, nearest a tap in screen space, with a touch-sized tolerance. */
  function pick(x: number, y: number): GlobeTarget | null {
    const tap = new THREE.Vector2(x, y)
    const screen = new THREE.Vector2()
    const candidates: { target: GlobeTarget; point: THREE.Vector3; bias: number }[] = []
    for (const relay of routes?.built ?? []) {
      const target: GlobeTarget = { kind: 'relay', id: relay.relay.id }
      if (relay.holder) candidates.push({ target, point: relay.holder, bias: 8 })
      for (const stop of relay.stops) candidates.push({ target, point: stop, bias: 0 })
      for (const hop of relay.hops) hop.forEach((point, index) => index % 3 === 0 && candidates.push({ target, point, bias: 0 }))
    }
    // Batons win over the routes beneath them.
    for (const route of atlasLayer?.routePoints ?? []) {
      route.points.forEach((point, index) => index % 2 === 0 && candidates.push({ target: { kind: 'route', id: route.routeId }, point, bias: -6 }))
    }
    let best: { target: GlobeTarget; distance: number } | null = null
    for (const candidate of candidates) {
      // A point is on the far side of the Earth when the camera sits below its tangent plane.
      if (candidate.point.dot(camera.position) <= candidate.point.lengthSq()) continue
      const distance = project(candidate.point, screen).distanceTo(tap) - candidate.bias
      if (distance < 28 && (!best || distance < best.distance)) best = { target: candidate.target, distance }
    }
    return best?.target ?? null
  }

  function resize(): void {
    width = Math.max(1, host.clientWidth)
    height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  const scratch = new THREE.Vector3()
  function renderArrival(now: number): void {
    if (!arrival) return
    // Arrivals requested while the globe was paused start when it is next on screen.
    if (arrival.start === null) {
      const view = vectorToLatLon(arrival.points[Math.floor(arrival.points.length / 2)] ?? arrival.destination)
      void controls.flyTo(view.lat - 6, view.lon, 0.86, now, reduced.matches ? 250 : 1100)
      arrival.start = now + (reduced.matches ? 250 : 900)
    }
    const elapsed = now - arrival.start
    const travel = Math.min(1, elapsed / arrival.travelMs)
    const burst = Math.max(0, (elapsed - arrival.travelMs) / BURST_MS)
    const color = arrival.color
    let count = 0
    if (travel < 1) {
      const head = travel < 0.5 ? 2 * travel * travel : 1 - (-2 * travel + 2) ** 2 / 2
      const tail = tier.trailPoints * 2
      for (let i = 0; i < tail; i++) {
        const at = head - i * 0.012
        samplePolyline(arrival.points, Math.max(0, at), scratch)
        const falloff = 1 - i / tail
        writePoint(arrivalCloud.buffers, count++, scratch, color, i === 0 ? 30 : 18 * falloff + 3, 2, 0, at >= 0 ? falloff * falloff : 0)
      }
    }
    if (travel >= 1 && burst < 1) writePoint(arrivalCloud.buffers, count++, arrival.destination, color, 150, 3, 0, 1 - burst)
    if (burst >= 1) {
      arrival.done()
      arrival = null
    }
    markDirty(arrivalCloud.geometry, count)
  }

  function loop(now: number): void {
    if (!alive || !active) return
    frame = requestAnimationFrame(loop)
    const delta = Math.min(100, now - lastFrame)
    lastFrame = now
    if (document.hidden) return
    if (background && now - lastRender < 33) return
    lastRender = now
    const motion = reduced.matches ? 0.25 : 1
    const time = now / 1000
    controls.update(now, delta / 1000, reduced.matches ? 1 : 3.2)
    fitDistance = controls.apply(camera, width, height, framing)
    pointMaterial.uniforms.uTime!.value = time
    pointMaterial.uniforms.uMotion!.value = motion
    pointMaterial.uniforms.uPixelRatio!.value = pixelRatio
    pointMaterial.uniforms.uReference!.value = fitDistance
    routes?.update(time, motion)
    atlasLayer?.update(time, motion)
    renderArrival(now)
    renderer.render(scene, camera)
    monitor.record(delta)
  }
  frame = requestAnimationFrame(loop)

  const lost = (event: Event) => {
    event.preventDefault()
    host.dataset.globe = 'lost'
  }
  canvas.addEventListener('webglcontextlost', lost)

  /** Starts a crossing between two stations, replacing any crossing still playing. */
  function cross(fromStation: string, toStation: string, color: THREE.Color, done: () => void): void {
    const destination = stationPoint(toStation)
    const origin = stationPoint(fromStation)
    if (!destination || !origin) {
      done()
      return
    }
    arrival?.done()
    const points = origin.distanceTo(destination) > 1e-3 ? arcPoints(origin, destination, 64) : [destination, destination]
    arrival = { color, points, destination, start: null, travelMs: reduced.matches ? 600 : 2800, done }
  }

  const handle: GlobeHandle = {
    update(next) {
      state = next
      rebuild()
    },
    flyToRelay: flyTo,
    arrive(relayId, fromStation, toStation) {
      const relay = state.relays.find(item => item.id === relayId)
      cross(fromStation, toStation, relay ? relayColor(relay) : HANDOFF_COLOR, () => undefined)
    },
    flight(fromStation, toStation, kind) {
      if (reduced.matches || !active) return Promise.resolve()
      return new Promise(resolve => cross(fromStation, toStation, kind === 'grant' ? GRANT_COLOR : HANDOFF_COLOR, resolve))
    },
    setFraming(next) {
      framing = next
    },
    setActive(next) {
      if (next === active) return
      active = next
      if (active && alive) {
        lastFrame = performance.now()
        frame = requestAnimationFrame(loop)
      } else cancelAnimationFrame(frame)
    },
    setBackground(next) {
      background = next
    },
    disc() {
      // The camera looks at the Earth's center, which the view offset puts at the framing point; the sphere's outline
      // is then a circle of the Earth's angular radius.
      const distance = camera.position.length()
      if (distance <= EARTH_RADIUS || width <= 1 || height <= 1) return null
      const angularRadius = Math.asin(EARTH_RADIUS / distance)
      const radius = (Math.tan(angularRadius) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * (height / 2)
      const box = host.getBoundingClientRect()
      return { x: box.left + framing.centerX * width, y: box.top + framing.centerY * height, radius }
    },
    dispose() {
      alive = false
      cancelAnimationFrame(frame)
      window.clearInterval(sunTimer)
      observer.disconnect()
      controls.dispose()
      canvas.removeEventListener('webglcontextlost', lost)
      routes?.dispose()
      atlasLayer?.dispose()
      arrival?.done()
      arrivalCloud.geometry.dispose()
      pointMaterial.dispose()
      earth.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
  return handle
}
