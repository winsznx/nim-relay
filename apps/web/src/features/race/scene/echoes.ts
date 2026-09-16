import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho } from '@nim-relay/shared'
import { echoLabel, trackEchoes } from '../relay-echoes'
import { createLabelAtlas, createLabelMaterial, LABEL_ASPECT } from './echo-labels'
import { fadeNearCamera } from './materials'
import { MeshBuilder } from './mesh-builder'
import { fromQ, type Route } from './route'
import { GOLD } from './track-style'

/**
 * Relay Echoes standing beside the track: a slim gold obelisk just outside the guard rail, off the deck and every
 * collision lane, with a floating label that becomes readable 120 to 60 m ahead. Passing an echo on its path makes
 * it shimmer and reports it once. All obelisks share one instanced mesh and all labels another.
 */

/** Metres from the deck edge to the obelisk: clear of the curb and the guard rail. */
const EDGE_GAP = 1.3
const LABEL_HEIGHT = 4.2
const CROWN_HEIGHT = 2.75
/** The label fades in between these distances ahead of the courier, and out between these view depths. */
const READABLE_FROM = 120
const READABLE_BY = 60
const LABEL_GONE = 4
const LABEL_FULL = 10
/** Label height per metre of view depth, so it keeps one small size on screen. */
const LABEL_SCALE = 0.036
const VIEW_BEHIND = 30
const REST_GLOW = 0.75
const SHIMMER_GLOW = 2.4
const SHIMMER_SECONDS = 0.9
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

interface StandingEcho {
  id: string
  /** Route distance in metres, and the simulation's Q16.16 distance that passes it. */
  d: number
  dist: number
  /** Couriers on another path of the fork ride past out of reach. */
  path: relayLeg.Path
  base: THREE.Vector3
  label: THREE.Vector3
  sincePassed: number
  /** Obelisk brightness last written to its instance colour. */
  glow: number
}

export interface EchoFrame {
  state: relayLeg.State
  /** Courier distance on screen, metres. */
  viewDist: number
  camera: THREE.PerspectiveCamera
  dt: number
  drawDistance: number
}

function hexagon(radius: number, y: number): THREE.Vector3[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
  })
}

/** A tapering hexagonal column over a ground halo, crowned by a floating hex crystal. Vertex colours carry the glow. */
function obeliskGeometry(): THREE.BufferGeometry {
  const builder = new MeshBuilder()
  const foot = new THREE.Color(0.3, 0.14, 0.02)
  const haloInner = hexagon(0.52, 0.03)
  const haloOuter = hexagon(0.76, 0.03)
  const bottom = hexagon(0.36, 0.12)
  const top = hexagon(0.11, 2.35)
  const equator = hexagon(0.26, CROWN_HEIGHT)
  const apex = new THREE.Vector3(0, CROWN_HEIGHT + 0.36, 0)
  const nadir = new THREE.Vector3(0, CROWN_HEIGHT - 0.36, 0)
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6
    builder.quad(haloInner[i]!, haloOuter[i]!, haloOuter[j]!, haloInner[j]!, GOLD.soft)
    builder.quad(bottom[i]!, bottom[j]!, top[j]!, top[i]!, foot, [0, 0, 0, 0], GOLD.line)
    builder.triangle(equator[i]!, equator[j]!, apex, GOLD.bright)
    builder.triangle(equator[j]!, equator[i]!, nadir, GOLD.line)
  }
  return builder.build()
}

function stand(route: Route, echo: RelayEcho, index: number): StandingEcho | null {
  if (echo.dist === null) return null
  const d = fromQ(echo.dist)
  if (d <= 0 || d > route.finish) return null
  const { fork } = route
  const inFork = d > fork.from && d < fork.to
  // Risk echoes stand on the risk side; others alternate sides, or keep to the safe side inside the fork.
  const path: relayLeg.Path = echo.kind === 'risk-pioneer' ? 'risk' : inFork ? 'safe' : 'main'
  const side = path === 'risk' ? fork.riskSide : path === 'safe' || index % 2 === 0 ? -fork.riskSide : fork.riskSide
  const lateral = route.pathOffset(path, d) + side * (route.halfWidth(path, d) + EDGE_GAP)
  const base = route.flatPoint(d, lateral, new THREE.Vector3())
  return {
    id: echo.id,
    d,
    dist: echo.dist,
    path,
    base,
    label: base.clone().setY(base.y + LABEL_HEIGHT),
    sincePassed: Number.POSITIVE_INFINITY,
    glow: REST_GLOW,
  }
}

export class EchoField {
  readonly group = new THREE.Group()
  private readonly standing: StandingEcho[]
  private readonly obelisks: THREE.InstancedMesh
  private readonly labels: THREE.InstancedMesh
  private readonly atlas: THREE.CanvasTexture
  private readonly passed: string[] = []
  private readonly transform = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly forward = new THREE.Vector3()
  private readonly toLabel = new THREE.Vector3()
  private lastDist = 0

  constructor(route: Route, echoes: readonly RelayEcho[]) {
    this.group.name = 'relay-echoes'
    const shown = trackEchoes(echoes).flatMap((echo, index) => {
      const standing = stand(route, echo, index)
      return standing ? [{ echo, standing }] : []
    })
    this.standing = shown.map(item => item.standing)
    const count = this.standing.length

    const obeliskMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    fadeNearCamera(obeliskMaterial, 'echo-obelisk')
    this.obelisks = new THREE.InstancedMesh(obeliskGeometry(), obeliskMaterial, Math.max(1, count))
    this.obelisks.name = 'echo-obelisks'
    this.atlas = createLabelAtlas(shown.map(item => echoLabel(item.echo)))
    this.labels = new THREE.InstancedMesh(new THREE.PlaneGeometry(LABEL_ASPECT, 1), createLabelMaterial(this.atlas, count), Math.max(1, count))
    this.labels.name = 'echo-labels'
    // Drawn before other transparent effects, so hazard warnings and gate flashes always read over a label.
    this.labels.renderOrder = -1
    for (const mesh of [this.obelisks, this.labels]) {
      mesh.count = count
      mesh.visible = false
      mesh.frustumCulled = false
      this.group.add(mesh)
    }
    this.standing.forEach((item, index) => {
      this.transform.position.copy(item.base)
      this.transform.updateMatrix()
      this.obelisks.setMatrixAt(index, this.transform.matrix)
      this.obelisks.setColorAt(index, this.color.setScalar(REST_GLOW))
      this.labels.setMatrixAt(index, HIDDEN)
      this.labels.setColorAt(index, this.color.setRGB(0, 0, index))
    })
    this.obelisks.instanceMatrix.needsUpdate = true
  }

  /** Shimmers and labels the echoes for this frame. Returns the ids of echoes the simulation passed since the last frame. */
  update(frame: EchoFrame): readonly string[] {
    this.passed.length = 0
    if (this.standing.length === 0) return this.passed
    const { state, camera } = frame
    camera.getWorldDirection(this.forward)
    let nearby = false
    let labelled = false
    let glowChanged = false
    this.standing.forEach((item, index) => {
      if (this.lastDist < item.dist && state.dist >= item.dist && (item.path === 'main' || item.path === state.path)) {
        item.sincePassed = 0
        this.passed.push(item.id)
      } else {
        item.sincePassed += frame.dt
      }
      const shimmer = item.sincePassed < SHIMMER_SECONDS ? (1 - item.sincePassed / SHIMMER_SECONDS) ** 2 : 0
      const glow = REST_GLOW + shimmer * SHIMMER_GLOW
      if (glow !== item.glow) {
        item.glow = glow
        glowChanged = true
        this.obelisks.setColorAt(index, this.color.setScalar(glow))
      }
      const ahead = item.d - frame.viewDist
      nearby ||= ahead > -VIEW_BEHIND && ahead < frame.drawDistance
      const depth = this.toLabel.subVectors(item.label, camera.position).dot(this.forward)
      const fade = (1 - THREE.MathUtils.smoothstep(ahead, READABLE_BY, READABLE_FROM)) * THREE.MathUtils.smoothstep(depth, LABEL_GONE, LABEL_FULL)
      if (fade <= 0.001) {
        this.labels.setMatrixAt(index, HIDDEN)
        return
      }
      labelled = true
      this.transform.position.copy(item.label)
      this.transform.scale.setScalar(depth * LABEL_SCALE)
      this.transform.updateMatrix()
      this.labels.setMatrixAt(index, this.transform.matrix)
      this.labels.setColorAt(index, this.color.setRGB(fade, shimmer, index))
    })
    this.transform.scale.setScalar(1)
    this.lastDist = state.dist
    this.obelisks.visible = nearby
    this.labels.visible = labelled
    if (glowChanged && this.obelisks.instanceColor) this.obelisks.instanceColor.needsUpdate = true
    this.labels.instanceMatrix.needsUpdate = true
    if (this.labels.instanceColor) this.labels.instanceColor.needsUpdate = true
    return this.passed
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const mesh of [this.obelisks, this.labels]) {
      mesh.geometry.dispose()
      if (mesh.material instanceof THREE.Material) mesh.material.dispose()
      mesh.dispose()
    }
    this.atlas.dispose()
  }
}
