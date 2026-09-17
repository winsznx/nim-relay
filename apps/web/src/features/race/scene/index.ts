import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho } from '@nim-relay/shared'
import { FRESH_BATON, type BatonAppearance } from '../../baton/baton-appearance'
import type { RaceCue, RenderSnapshot } from '../controller'
import { FLOW_HIGH } from '../flow-tier'
import { createRaceFrame, writeRaceFrame, type RaceFrame } from '../race-frame'
import { BatonFlight } from './baton-flight'
import { BatonPresence, type HoverStage } from './baton-presence'
import { CameraRig, type CameraShot } from './camera'
import { createCourier, type Courier, type CourierAct, type CourierDrive, type CourierCosmetics } from './courier'
import { CourierPlacement } from './courier-placement'
import { createDensity } from './density'
import { EchoField } from './echoes'
import { EdgeGlow, Particles, SpeedLines, Trail, createRandom } from './effects'
import { createWorldEvents } from './events'
import { GateField, type GateFlash } from './gates'
import { GhostlineField } from './ghostline'
import { HazardField } from './hazards'
import { createSceneMaterials } from './materials'
import { FrameBudgetMonitor, lowerTier, type QualityTier } from './quality'
import { createRaceRenderer } from './renderer'
import { Route, createRouteFrame, fromQ } from './route'
import { TrackStreamer } from './track-mesh'
import { DANGER, GHOST_CYAN, GOLD } from './track-style'
import { CourierViewDriver, type CourierView } from './visual-state'
import { PLATFORM_TO, createHandoffGate } from './worlds/handoff-gate'
import { WORLD_KITS } from './worlds'
import { buildSetPieces } from './worlds/set-pieces'
import type { WorldFrame } from './worlds/types'

/**
 * Mounts the relay leg presentation into a host element. The scene reads the
 * controller's render snapshot each frame and never writes simulation state;
 * everything here is presentation: interpolation, camera, juice and ceremony.
 */

export type CeremonyState = 'none' | 'approach' | 'armed' | 'frozen' | 'launch' | 'departed'

export interface RaceSource {
  frame(now: number): void
  getRenderSnapshot(): RenderSnapshot
  onCue(listener: (cue: RaceCue) => void): () => void
}

export interface SceneStats {
  tier: QualityTier
  calls: number
  triangles: number
  fps: number
}

export interface RelayLegSceneOptions {
  source: RaceSource
  track: relayLeg.Track
  /** 'relay' plays the long incoming-baton arrival; 'short' the practice opening. */
  opening: 'relay' | 'short'
  quality?: QualityTier | 'auto'
  /** Keep the requested tier even if frames are slow (captures, tests). */
  lockQuality?: boolean
  cosmetics?: CourierCosmetics
  baton?: BatonAppearance
  ghostName?: string | null
  /** The previous runner's verified line, drawn on the deck, and whose it is (null when unknown). */
  ghostline?: { line: relayLeg.Ghostline; name: string | null } | null
  /** Relay Echoes of the leg's sector. Those with a route distance stand beside the track. */
  echoes?: readonly RelayEcho[]
  onStats?: (stats: SceneStats) => void
  /** Called once per rendered frame with the race clock on screen. The object is reused between frames. */
  onFrame?: (frame: RaceFrame) => void
}

export interface RelayLegSceneHandle {
  dispose(): void
  setCeremony(state: CeremonyState): void
  setQuality(tier: QualityTier): void
  /** "HANDOFF TO YASMINE" over the handoff gate while it is in view; null clears it. */
  setHandoffLabel(text: string | null): void
  onCue(listener: (cue: RaceCue) => void): () => void
}

const FINISH_REST = 17
/** Metres ahead or behind within which the chase camera keeps the ghost in frame. */
const COMPANION_RANGE = 26
const LAUNCH_SECONDS = 1.9
const DEPART_SECONDS = 2.6
/** Seconds after the finish line before the baton leaves the courier's hand to hover. */
const SEPARATE_SECONDS = 0.9
/** Seconds a failed courier keeps falling before the scene cuts to them kneeling at the lip. */
const FAILED_FALL_SECONDS = 1.1
const SPARK = new THREE.Color(4, 1.6, 0.5)
const GRIND_SPARK = new THREE.Color(5, 2.2, 0.7)
const HIT_SPARK = new THREE.Color(4, 0.9, 0.35)
const DUST = new THREE.Color(0.55, 0.52, 0.5)
const WHITE = new THREE.Color(2.2, 2.2, 2.2)
const RED = new THREE.Color(3.2, 0.2, 0.2)
const RUSH_LINES = new THREE.Color(1.6, 1.05, 0.4)
const DRAFT_SPARKLE = GHOST_CYAN.clone().multiplyScalar(0.9)

/** The world's edge-light hue at a soft, even brightness for speed lines. */
function speedLineTint(edgeLight: THREE.Color): THREE.Color {
  const peak = Math.max(edgeLight.r, edgeLight.g, edgeLight.b, 0.001)
  return edgeLight.clone().multiplyScalar(0.85 / peak)
}

export function mountRelayLeg(host: HTMLElement, options: RelayLegSceneOptions): RelayLegSceneHandle {
  const kit = WORLD_KITS[options.track.world]
  const style = kit.style
  const route = new Route(options.track)
  const raceRenderer = createRaceRenderer(host, style, options.quality ?? 'auto')
  const { scene } = raceRenderer
  const random = createRandom(options.track.finishDist)

  const materials = createSceneMaterials({ deckRoughness: style.deckRoughness, deckMetalness: style.deckMetalness, tier: raceRenderer.settings.tier })
  const stripLength = (tier: QualityTier): number => (tier === 'low' ? 2.5 : 1.5)
  const track = new TrackStreamer(route, materials, style.track, stripLength(raceRenderer.settings.tier), raceRenderer.settings.drawDistance)
  scene.add(track.group)
  const floorY = track.floorY

  const world = kit.build({ scene, route, quality: raceRenderer.settings, materials, floorY, style })
  const setPieces = buildSetPieces(route, floorY, style)
  for (const piece of setPieces) scene.add(piece.group)
  const handoffGate = createHandoffGate(route, floorY)
  scene.add(handoffGate.group)

  const gates = new GateField(route)
  scene.add(gates.group)
  const hazards = new HazardField(route, raceRenderer.settings.tier !== 'low')
  scene.add(hazards.group)
  const worldEvents = createWorldEvents(scene, route, kit, raceRenderer.settings)
  const echoes = new EchoField(route, options.echoes ?? [])
  scene.add(echoes.group)
  const ghostline = options.ghostline && options.ghostline.line.x.length > 1 ? new GhostlineField(route, options.ghostline.line, options.ghostline.name) : null
  if (ghostline) scene.add(ghostline.group)

  const rim = new THREE.Color(style.lighting.courierRim).multiplyScalar(0.55)
  const baton = options.baton ?? FRESH_BATON
  const courier = createCourier({ cosmetics: options.cosmetics ?? {}, baton, rimColor: rim, castShadow: raceRenderer.settings.shadows })
  scene.add(courier.group)
  const ghost: Courier | null = options.ghostName ? createCourier({ baton: null, ghostName: options.ghostName, rimColor: rim, castShadow: false }) : null
  if (ghost) {
    scene.add(ghost.group)
    ghost.setVisible(false)
  }

  const shadowMaterial = new THREE.MeshBasicMaterial({ map: materials.particleTexture, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false })
  const hoverMaterial = new THREE.MeshBasicMaterial({ map: materials.particleTexture, color: new THREE.Color(0.9, 0.48, 0.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.9).rotateX(-Math.PI / 2), shadowMaterial)
  const hoverGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.9).rotateX(-Math.PI / 2), hoverMaterial)
  scene.add(shadow, hoverGlow)

  const rig = new CameraRig(route, 1)
  scene.add(rig.camera)
  const density = createDensity(scene, route, options.track.world, raceRenderer.settings, floorY, rig.camera, raceRenderer.renderer.domElement)
  const particles = new Particles(raceRenderer.settings.particles, materials.particleTexture)
  scene.add(particles.points)
  const lineTint = speedLineTint(style.track.edgeLight)
  const lineColor = lineTint.clone()
  const speedLines = new SpeedLines(Math.round(raceRenderer.settings.speedStreaks * 0.35), random, lineTint)
  rig.camera.add(speedLines.mesh)
  const boardTrail = new Trail(14, 0.15, courier.trailColor, 1.4)
  scene.add(boardTrail.mesh)
  const lowTier = raceRenderer.settings.tier === 'low'
  hoverGlow.visible = !lowTier
  const presence = new BatonPresence(route, scene, baton, raceRenderer.settings.tier)
  const edgeGlow = new EdgeGlow(18, DANGER.red)
  scene.add(edgeGlow.mesh)
  const flight = new BatonFlight(baton, new THREE.Color(3, 1.8, 0.5))
  scene.add(flight.object, flight.trail.mesh)

  const courierView = new CourierViewDriver(route)
  const ghostView = new CourierViewDriver(route)
  const placement = new CourierPlacement(route)
  const ghostPlacement = new CourierPlacement(route)
  const monitor = new FrameBudgetMonitor()
  const cueListeners = new Set<(cue: RaceCue) => void>()
  const flashes: GateFlash[] = []
  const scratch = new THREE.Vector3()
  const scratchB = new THREE.Vector3()
  const launchFocus = new THREE.Vector3()
  const carry = new THREE.Vector3()
  const routeFrame = createRouteFrame()
  const raceFrame = createRaceFrame()

  let ceremony: CeremonyState = 'none'
  let ceremonyTime = 0
  let time = 0
  let lastNow: number | null = null
  let raf = 0
  let disposed = false
  let statsFrames = 0
  let statsTime = 0
  let finishStart = 0
  let finishSpeed = 30
  let caught = false
  let lastPhase = ''
  let flowFlare = 0
  let sparkClock = 0
  let draftClock = 0
  let handoffLabel: string | null = null
  /** Seconds into the current relay cut flight, or -1 when none is in the air. */
  let cutTime = -1
  let cutSide: -1 | 1 = 1
  let cutBlend = 0
  let lastMotion: relayLeg.Motion = 'riding'
  let separated = false

  raceRenderer.renderer.compile(scene, rig.camera)
  const size = raceRenderer.resize(rig.camera)
  particles.setViewportHeight(size.height * raceRenderer.renderer.getPixelRatio())
  const observer = new ResizeObserver(() => {
    const next = raceRenderer.resize(rig.camera)
    particles.setViewportHeight(next.height * raceRenderer.renderer.getPixelRatio())
  })
  observer.observe(host)
  track.update(0, true)

  const unsubscribeCues = options.source.onCue(cue => {
    for (const listener of cueListeners) listener(cue)
  })

  function emit(cue: RaceCue): void {
    for (const listener of cueListeners) listener(cue)
  }

  /** Bursts ride along with the courier so the chase camera never sweeps through them. */
  function emitBurst(position: THREE.Vector3, count: number, color: THREE.Color, speed: number, size: number, life: number, gravity = 0, flatten = 0): void {
    const scaled = Math.max(1, Math.round(count * (raceRenderer.settings.particles / 520)))
    particles.burst(position, { count: scaled, color, speed, size, life, gravity, flatten, carry }, random)
  }

  function handleEvents(events: number, state: relayLeg.State, courierPosition: THREE.Vector3): void {
    if (events === 0) return
    const EVENT = relayLeg.EVENT
    if (events & EVENT.HIT) {
      rig.hit()
      courierView.freeze(70)
      emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 0.9), 36, HIT_SPARK, 9, 0.5, 0.6, 9)
    }
    if (events & EVENT.EDGE_GRIND) {
      rig.hit()
      emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 0.2), 34, GRIND_SPARK, 8, 0.32, 0.5, 12)
    }
    if (events & EVENT.EDGE_SAVE) emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 0.9), 30, GOLD.bright, 7, 0.3, 0.6)
    if (events & EVENT.FALL) {
      rig.hit()
      emitBurst(courierPosition, 30, RED, 6, 0.6, 0.7, 4)
    }
    if (events & EVENT.TETHER_SAVE) emitBurst(presence.batonWorld, 60, GOLD.bright, 10, 0.5, 0.9, 0)
    if (events & (EVENT.LAND | EVENT.HARD_LANDING)) {
      const clean = (events & EVENT.CLEAN_LAND) !== 0
      const hard = (events & EVENT.HARD_LANDING) !== 0
      rig.land(clean ? 0.7 : hard ? 1.6 : 1)
      emitBurst(courierPosition, clean ? 22 : hard ? 26 : 14, clean ? GOLD.line : DUST, clean ? 6 : hard ? 5 : 3, clean ? 0.3 : 0.5, 0.5, 1, 0.85)
    }
    if (events & EVENT.JUMP) emitBurst(courierPosition, 10, DUST, 3, 0.34, 0.4, 0, 0.7)
    if (events & EVENT.NEAR_MISS) {
      rig.boost()
      emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 1), 20, WHITE, 11, 0.22, 0.22)
    }
    if (events & EVENT.BOOST_PAD) rig.boost()
    if (events & EVENT.LANE_ACQUIRED) emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 0.08), 5, GOLD.soft, 2, 0.2, 0.25, 0, 1)
    if (events & (EVENT.FLOW_MAX | EVENT.RISK_CLEAR)) {
      flowFlare = 1
      emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 1), 26, GOLD.bright, 8, 0.28, 0.7)
    }
    if (events & EVENT.RUSH_START) {
      rig.rush()
      emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 1), 80, GOLD.bright, 14, 0.42, 0.9, 0)
    }
    if (events & (EVENT.GHOST_OVERTAKE | EVENT.GHOST_OVERTAKEN)) {
      const at = ghost && ghost.group.visible ? ghost.group.position : courierPosition
      const overtaking = (events & EVENT.GHOST_OVERTAKE) !== 0
      emitBurst(scratch.copy(at).setY(at.y + 1), overtaking ? 40 : 24, overtaking ? GOLD.bright : GHOST_CYAN, overtaking ? 9 : 6, 0.3, 0.6)
      if (overtaking) emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 1.1), 24, GHOST_CYAN, 7, 0.26, 0.5)
    }
    if (events & EVENT.JUMP && isCutLaunch(state)) {
      cutTime = 0
      cutSide = route.forkAt(fromQ(state.dist))?.riskSide ?? 1
      emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 0.6), 60, GOLD.bright, 12, 0.4, 0.8, 2)
    }
    if (events & EVENT.FINISH) emitBurst(scratch.copy(courierPosition).setY(courierPosition.y + 1.2), 70, GOLD.bright, 12, 0.6, 1.2, 2)
  }

  /** A launch off a speed-gated ramp on the risk side of a relay cut. */
  function isCutLaunch(state: relayLeg.State): boolean {
    if (state.path !== 'risk' || state.vy < relayLeg.CUT_LAUNCH_VELOCITY - relayLeg.GRAVITY * 2) return false
    return route.forkAt(fromQ(state.dist))?.label === 'relay-cut'
  }

  function courierAct(snapshot: RenderSnapshot, failedSeconds: number): { act: CourierAct; progress: number } {
    const phase = snapshot.phase === 'paused' ? snapshot.activePhase : snapshot.phase
    if (phase === 'arrival') return { act: snapshot.openingElapsedMs > snapshot.openingMs - 500 ? 'anticipate' : 'idle', progress: 0 }
    if (phase === 'catch') return { act: 'catch', progress: (snapshot.openingElapsedMs - snapshot.openingMs) / Math.max(1, snapshot.catchMs) }
    if (phase === 'racing') return { act: 'ride', progress: 0 }
    if (snapshot.state.motion === 'failed') return { act: failedSeconds >= FAILED_FALL_SECONDS ? 'failed' : 'ride', progress: 0 }
    if (ceremony === 'armed' || ceremony === 'frozen') return { act: 'prepare', progress: 0 }
    if (ceremony === 'launch') return { act: 'throw', progress: Math.min(1, ceremonyTime / 0.9) }
    if (ceremony === 'departed') return { act: 'victory', progress: 1 }
    return { act: 'finish', progress: 0 }
  }

  function cameraShot(snapshot: RenderSnapshot, failedSeconds: number): { shot: CameraShot; progress: number } {
    const phase = snapshot.phase === 'paused' ? snapshot.activePhase : snapshot.phase
    if (phase === 'arrival') return { shot: options.opening === 'relay' ? 'arrival-relay' : 'arrival-short', progress: snapshot.openingElapsedMs / Math.max(1, snapshot.openingMs) }
    if (phase === 'catch') return { shot: 'catch', progress: (snapshot.openingElapsedMs - snapshot.openingMs) / Math.max(1, snapshot.catchMs) }
    if (phase === 'racing') return { shot: 'chase', progress: 0 }
    if (snapshot.state.motion === 'failed') return { shot: failedSeconds >= FAILED_FALL_SECONDS ? 'failed' : 'chase', progress: 0 }
    if (ceremony === 'armed') return { shot: 'armed', progress: 0 }
    if (ceremony === 'frozen') return { shot: 'frozen', progress: Math.min(1, ceremonyTime / 3) }
    if (ceremony === 'launch') return { shot: 'launch', progress: Math.min(1, ceremonyTime / LAUNCH_SECONDS) }
    if (ceremony === 'departed') return { shot: 'departed', progress: Math.min(1, ceremonyTime / DEPART_SECONDS) }
    return { shot: 'finish', progress: 0 }
  }

  /** Where the carried baton goes after a completed finish. */
  function hoverStage(phase: RenderSnapshot['phase'], failed: boolean, sinceFinish: number): HoverStage {
    if (phase !== 'finished' || failed) return 'none'
    if (ceremony === 'launch' || ceremony === 'departed') return 'none'
    if (ceremony === 'armed') return 'armed'
    if (ceremony === 'frozen') return 'frozen'
    return sinceFinish >= SEPARATE_SECONDS ? 'finish' : 'none'
  }

  function drive(view: CourierView, dt: number, act: CourierAct, actProgress: number, events: number, extra: { batonLift: number; blaze: number; flow: number }): CourierDrive {
    return {
      time, dt, act, actProgress, lateralVelocity: view.lateralVelocity, airborne: view.airborne, sliding: view.sliding, stumbling: view.stumbling,
      railing: view.railing, flow: extra.flow, events, batonLift: extra.batonLift, motion: view.motion, edgeSide: view.edgeSide, laneShift: view.laneShift,
      rush: view.rush, shoulder: view.shoulder, blaze: extra.blaze,
    }
  }

  /** Lateral of the road edge on `side` at `d`, from the main centre line. */
  function edgeLateral(path: relayLeg.Path, side: -1 | 1, d: number): number {
    const active = route.activePath(path, d)
    return route.pathOffset(active, d) + side * route.halfWidth(active, d)
  }

  function loop(now: number): void {
    if (disposed) return
    raf = requestAnimationFrame(loop)
    const realDt = lastNow === null ? 1 / 60 : Math.min(0.1, Math.max(0, (now - lastNow) / 1000))
    lastNow = now
    options.source.frame(now)
    const snapshot = options.source.getRenderSnapshot()
    const paused = snapshot.phase === 'paused'
    const timeScale = paused ? 0 : ceremony === 'frozen' ? 0.07 : 1
    const dt = realDt * timeScale
    time += dt
    ceremonyTime += realDt
    if (snapshot.phase !== lastPhase) {
      if (snapshot.phase === 'finished') {
        finishStart = time
        finishSpeed = Math.max(18, courierView.view.speed)
      }
      lastPhase = snapshot.phase
    }

    const phase = paused ? snapshot.activePhase : snapshot.phase
    const state = snapshot.state
    const failed = state.motion === 'failed'
    const sinceFinish = phase === 'finished' ? time - finishStart : 0
    const finish = fromQ(state.track.finishDist)
    if (phase === 'finished' && failed) {
      if (sinceFinish < FAILED_FALL_SECONDS) {
        courierView.update(snapshot.previous, state, 1, realDt, 0)
        courierView.view.height -= 9.8 * sinceFinish * sinceFinish * 0.5
      } else {
        const side = state.edgeSide === 0 ? 1 : state.edgeSide
        courierView.place(fromQ(state.dist), edgeLateral(state.path, side, fromQ(state.dist)) - side * 1.3, realDt, 0)
        courierView.view.edgeSide = state.edgeSide
      }
    } else if (phase === 'finished') {
      const elapsed = time - finishStart
      const target = ceremony === 'none' || ceremony === 'approach' ? finish + FINISH_REST : finish + PLATFORM_TO - 3.2
      const glide = Math.min(1, elapsed / 1.8)
      const eased = 1 - Math.pow(1 - glide, 3)
      const current = courierView.view.dist
      const desired = finish + (target - finish) * eased
      const dist = current + (Math.max(current, desired) - current) * (1 - Math.exp(-4 * realDt))
      courierView.place(dist, courierView.view.lateral * Math.exp(-2.5 * realDt), realDt, finishSpeed * (1 - eased))
    } else if (phase === 'arrival' || phase === 'catch') {
      courierView.place(0, 0, realDt, 0)
    } else if (!paused) {
      courierView.update(snapshot.previous, state, snapshot.alpha, realDt, snapshot.frameEvents)
    }

    const view = courierView.view
    const failedSeconds = failed ? sinceFinish : 0
    if (!paused && lastMotion === 'tethering' && view.motion === 'riding') {
      // The tether hauled the courier back: cut to the respawn with a flare of the baton's light.
      rig.cut()
      presence.cut()
      boardTrail.reset()
      route.point(view.dist, view.lateral, 1, scratch)
      emitBurst(scratch, 70, GOLD.bright, 9, 0.45, 0.9, 0)
    }
    if (failed && failedSeconds >= FAILED_FALL_SECONDS && lastMotion !== 'finished' && view.motion === 'finished') {
      rig.cut()
      placement.snap()
      presence.cut()
      boardTrail.reset()
    }
    lastMotion = view.motion

    writeRaceFrame(raceFrame, snapshot, view.speed)
    options.onFrame?.(raceFrame)
    if (!paused) placement.place(courier, view, realDt)
    route.frame(view.dist, routeFrame)
    carry.copy(routeFrame.forward).multiplyScalar(phase === 'racing' && view.motion === 'riding' ? view.speed * 0.92 : 0)

    if (cutTime >= 0) {
      cutTime += dt
      if (!view.airborne && cutTime > 0.2) cutTime = -1
    }
    cutBlend += ((cutTime >= 0 ? 1 : 0) - cutBlend) * (1 - Math.exp(-6 * realDt))
    const blaze = Math.max(view.rush, cutBlend)

    const { act, progress } = courierAct(snapshot, failedSeconds)
    flowFlare = Math.max(0, flowFlare - dt * 1.5)
    const batonLift = ceremony === 'frozen' ? Math.min(0.4, ceremonyTime * 0.25) : 0
    courier.update(drive(view, dt, act, progress, snapshot.frameEvents, { batonLift, blaze, flow: Math.max(view.flow, flowFlare) }))
    if (courier.baton) courier.baton.object.visible = phase === 'racing' || phase === 'finished' ? ceremony !== 'launch' && ceremony !== 'departed' : caught

    if (ghost && snapshot.ghost && snapshot.ghostPrevious) {
      const showGhost = phase !== 'arrival'
      ghost.setVisible(showGhost)
      if (phase === 'racing' && !paused) ghostView.update(snapshot.ghostPrevious, snapshot.ghost, snapshot.alpha, realDt, snapshot.ghostFrameEvents)
      else if (phase === 'catch') ghostView.place(2.5, -1.9, realDt, 0)
      else if (phase === 'finished' && snapshot.ghost.finished) ghostView.place(Math.min(ghostView.view.dist + realDt * 20, finish + FINISH_REST + 6), 2.2, realDt, 0)
      ghostPlacement.place(ghost, ghostView.view, realDt)
      ghost.update(drive(ghostView.view, dt, phase === 'racing' ? 'ride' : 'idle', 0, snapshot.ghostFrameEvents, { batonLift: 0, blaze: 0, flow: ghostView.view.flow }))
    }

    if (!paused) handleEvents(snapshot.frameEvents, state, courier.group.position)

    const catchProgress = phase === 'catch' ? (snapshot.openingElapsedMs - snapshot.openingMs) / Math.max(1, snapshot.catchMs) : phase === 'arrival' ? 0 : 1
    if (phase === 'arrival' || phase === 'catch') {
      if (options.opening === 'relay' && !flight.flying && !caught && phase === 'catch') {
        route.point(-70, -30, 46, scratch)
        flight.launch(scratch, courier.batonWorld, 12)
      }
      if (flight.flying) {
        const landed = !flight.update(catchProgress / 0.55, courier.batonWorld, time, rig.camera.position)
        if (landed) {
          caught = true
          emitBurst(courier.batonWorld, 50, GOLD.bright, 7, 0.4, 0.8)
        }
      } else if (!caught && phase === 'catch' && catchProgress > (options.opening === 'relay' ? 0.55 : 0.35)) {
        caught = true
        emitBurst(courier.batonWorld, 40, GOLD.bright, 6, 0.4, 0.7)
      }
    } else if (!caught) {
      caught = true
    }

    const leftHand = presence.update({
      time, dt: realDt, camera: rig.camera, courier, view, events: paused ? 0 : snapshot.frameEvents, racing: phase === 'racing', blaze,
      hover: hoverStage(phase, failed, sinceFinish),
    })
    if (leftHand && !separated) {
      separated = true
      emitBurst(presence.batonWorld, 30, GOLD.bright, 4, 0.3, 0.6)
      emit({ kind: 'baton-separate', tick: state.tick })
    }

    if (ceremony === 'launch' || ceremony === 'departed') {
      if (!flight.flying && ceremonyTime < 0.2 && ceremony === 'launch') {
        const release = scratch.copy(presence.batonWorld)
        route.point(finish + PLATFORM_TO + 140, 0, 160, scratchB)
        flight.launch(release, scratchB, 30)
        emitBurst(release, 90, GOLD.bright, 14, 0.6, 1.2, 1)
      }
      if (flight.flying) {
        route.point(finish + PLATFORM_TO + 140, 0, 160, scratchB)
        flight.update(Math.min(1, ceremonyTime / (LAUNCH_SECONDS + DEPART_SECONDS * 0.5)), scratchB, time, rig.camera.position)
      }
    }

    if (flight.flying) launchFocus.copy(flight.worldPosition)
    const focus = flight.flying || ceremony === 'launch' || ceremony === 'departed' ? launchFocus : presence.batonWorld
    const { shot, progress: shotProgress } = cameraShot(snapshot, failedSeconds)
    const pathCentre = route.pathOffset(route.activePath(view.path, view.dist), view.dist)
    const companion = ghost && phase === 'racing' && ghostView.view.path === view.path && Math.abs(ghostView.view.dist - view.dist) < COMPANION_RANGE ? ghost.group.position : null
    const edgeSide = view.edgeSide === 0 ? (view.lateral >= pathCentre ? 1 : -1) : view.edgeSide
    rig.update({
      dt: realDt, time, shot, shotProgress, dist: view.dist, lateral: view.lateral, pathCentre, height: view.height, speed: view.speed,
      lateralVelocity: view.lateralVelocity, flow: view.flow, focus, companion, motion: view.motion, edgeSide: view.edgeSide,
      edgeLateral: edgeLateral(view.path, edgeSide, view.dist), rush: view.rush, cut: cutBlend, cutSide,
    })
    ghost?.keepTagInView(rig.camera)

    const gateState = snapshot.state
    gates.update(gateState, snapshot.frameEvents, dt, flashes)
    for (const flash of flashes) emitBurst(flash.position, flash.pulse ? 22 : 10, flash.pulse ? WHITE : GOLD.bright, flash.pulse ? 9 : 4.5, flash.pulse ? 0.3 : 0.22, 0.45)
    hazards.update(view.dist, raceRenderer.settings.drawDistance, gateState.tick, snapshot.alpha, time, rig.camera.position)
    worldEvents.update({ state: gateState, alpha: snapshot.alpha, dist: view.dist, camera: rig.camera }, time)
    density.update(time, view.dist)
    for (const echoId of echoes.update({ state: gateState, viewDist: view.dist, camera: rig.camera, dt, time, drawDistance: raceRenderer.settings.drawDistance })) {
      emit({ kind: 'echo', tick: gateState.tick, echoId })
    }
    if (ghostline) {
      ghostline.update({ viewDist: view.dist, time, drafting: phase === 'racing' ? view.drafting : 0 })
      if (view.drafting > 0.3 && !paused && raceRenderer.settings.tier !== 'low') {
        draftClock += dt
        while (draftClock > 0.03) {
          draftClock -= 0.03
          // Carried at the courier's own speed, the sparkles stay on the line ahead instead of streaming back past the lens.
          if (ghostline.pointAt(view.dist + 4 + random() * 16, 0.08, scratch)) {
            particles.emit(scratch, carry.x, 0.6 + random() * 1.2, carry.z, DRAFT_SPARKLE, 0.18, 0.4, 0)
          }
        }
      }
    }
    const beat = relayLeg.onBeat(gateState.track, gateState.tick) ? 1 : 0
    materials.update(time, beat)
    track.update(view.dist)

    const falling = view.motion === 'falling' || view.motion === 'tethering' || (failed && view.motion !== 'finished')
    route.point(view.dist, view.lateral, 0.035, shadow.position)
    shadow.quaternion.copy(routeFrame.quaternion)
    hoverGlow.position.copy(shadow.position)
    hoverGlow.quaternion.copy(routeFrame.quaternion)
    const lift = Math.max(0, view.height - 0.26)
    shadow.visible = !falling
    hoverGlow.visible = !lowTier && !falling
    shadow.scale.setScalar(Math.max(0.35, 1 - lift * 0.2))
    shadowMaterial.opacity = Math.max(0.08, 0.55 - lift * 0.12)
    hoverMaterial.opacity = Math.max(0.04, 0.26 - lift * 0.08) * (0.7 + view.flow * 0.5 + view.rush * 0.6)

    const grinding = view.motion === 'grinding'
    if (view.railing || view.sliding || grinding) {
      sparkClock += dt
      const interval = grinding ? 0.012 : 0.025
      while (sparkClock > interval) {
        sparkClock -= interval
        if (grinding) {
          const side = view.edgeSide === 0 ? 1 : view.edgeSide
          route.point(view.dist - 0.2 - random() * 0.5, view.lateral - side * 0.05, 0.1, scratch)
          particles.emit(scratch, carry.x * 0.6 + (random() - 0.5) * 3, 1.5 + random() * 3.5, carry.z * 0.6 + (random() - 0.5) * 3, random() < 0.3 ? WHITE : GRIND_SPARK, 0.3, 0.35, 8)
        } else {
          route.point(view.dist - 0.4, view.lateral + (random() - 0.5) * 0.4, 0.08, scratch)
          particles.emit(scratch, carry.x * 0.8 + (random() - 0.5) * 2, 1.5 + random() * 2, carry.z * 0.8, SPARK, 0.28, 0.3, 6)
        }
      }
    }

    // The road edge beside the courier lights red on the shoulder and pulses while it grinds.
    const warning = phase === 'racing' ? Math.max(view.shoulder * 0.55, grinding ? 1 : 0) : 0
    const warnSide: -1 | 1 = view.edgeSide !== 0 ? view.edgeSide : view.lateral >= pathCentre ? 1 : -1
    edgeGlow.update(route, view.path, warnSide, view.dist - 3, view.dist + 24, 0.18, 0.2, warning * (0.75 + 0.25 * Math.sin(time * (grinding ? 30 : 9))), time)

    particles.update(dt)
    const racingNow = phase === 'racing' && !paused
    const speedIntensity = racingNow ? Math.max(THREE.MathUtils.smoothstep(view.flow, FLOW_HIGH - 0.05, 0.95) * (0.55 + raceFrame.speed01 * 0.45), view.rush) : 0
    speedLines.setColor(lineColor.copy(lineTint).lerp(RUSH_LINES, view.rush))
    speedLines.update(dt, rig.camera, speedIntensity, Math.max(raceFrame.speed01, view.rush))

    route.point(view.dist - 0.75, view.lateral, view.height + 0.02, scratch)
    boardTrail.maxLength = 1.2 + view.flow * 1.3 + view.rush * 1.8
    boardTrail.update(scratch, rig.camera.position, phase === 'racing' && !falling ? 0.2 + view.flow * 0.55 + view.rush * 0.35 : 0.1)

    const approach = Math.max(0, Math.min(1, (view.dist - (finish - 260)) / 260))
    const finale = ceremony === 'none' ? approach * 0.7 : ceremony === 'approach' ? 0.75 : 1
    handoffGate.update(time, finale)
    for (const piece of setPieces) piece.update(worldFrame(dt, view.dist, view.flow, finale))
    world.update(worldFrame(dt, view.dist, view.flow, finale))
    raceRenderer.sky.update(rig.camera, time, finale)

    raceRenderer.key.position.copy(courier.group.position).addScaledVector(scratch.set(...style.lighting.keyDirection).normalize(), 40)
    raceRenderer.key.target.position.copy(courier.group.position)

    raceRenderer.render(rig.camera)

    if (!options.lockQuality && monitor.sample(realDt * 1000)) {
      const lower = lowerTier(raceRenderer.settings.tier)
      if (lower) applyQuality(lower)
    }
    statsFrames++
    statsTime += realDt
    if (statsFrames >= 30) {
      const stats = raceRenderer.stats()
      options.onStats?.({ tier: raceRenderer.settings.tier, calls: stats.calls, triangles: stats.triangles, fps: statsFrames / Math.max(0.001, statsTime) })
      statsFrames = 0
      statsTime = 0
    }
  }

  const frameData: WorldFrame = { time: 0, dt: 0, camera: rig.camera, dist: 0, flow: 0, finale: 0 }
  function worldFrame(dt: number, dist: number, flow: number, finale: number): WorldFrame {
    frameData.time = time
    frameData.dt = dt
    frameData.dist = dist
    frameData.flow = flow
    frameData.finale = finale
    return frameData
  }

  function applyQuality(tier: QualityTier): void {
    raceRenderer.setQuality(tier)
    materials.setQuality(tier)
    presence.setQuality(tier)
    track.setQuality(stripLength(tier), raceRenderer.settings.drawDistance)
    const next = raceRenderer.resize(rig.camera)
    particles.setViewportHeight(next.height * raceRenderer.renderer.getPixelRatio())
    monitor.reset()
  }

  raf = requestAnimationFrame(loop)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      unsubscribeCues()
      cueListeners.clear()
      track.dispose()
      world.dispose()
      for (const piece of setPieces) piece.dispose()
      handoffGate.dispose()
      gates.dispose()
      hazards.dispose()
      worldEvents.dispose()
      density.dispose()
      echoes.dispose()
      ghostline?.dispose()
      courier.dispose()
      ghost?.dispose()
      for (const mesh of [shadow, hoverGlow]) {
        mesh.removeFromParent()
        mesh.geometry.dispose()
      }
      shadowMaterial.dispose()
      hoverMaterial.dispose()
      particles.dispose()
      speedLines.dispose()
      boardTrail.dispose()
      presence.dispose()
      edgeGlow.dispose()
      flight.dispose()
      materials.dispose()
      raceRenderer.dispose()
    },
    setCeremony(state) {
      if (state === ceremony) return
      ceremony = state
      ceremonyTime = 0
    },
    setQuality(tier) {
      applyQuality(tier)
    },
    setHandoffLabel(text) {
      if (text === handoffLabel) return
      handoffLabel = text
      handoffGate.setHandoffLabel(text)
    },
    onCue(listener) {
      cueListeners.add(listener)
      return () => {
        cueListeners.delete(listener)
      }
    },
  }
}
