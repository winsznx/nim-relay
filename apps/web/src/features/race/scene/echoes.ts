import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { RelayEcho } from '@nim-relay/shared'
import { echoLabel, trackEchoes } from '../relay-echoes'
import { bakeCourierSilhouette, createSilhouetteMaterial } from './courier-silhouette'
import { createLabelAtlas, createLabelMaterial, LABEL_ASPECT } from './echo-labels'
import { fadeNearCamera } from './materials'
import { MeshBuilder } from './mesh-builder'
import { createRouteFrame, fromQ, type Route } from './route'
import { GOLD } from './track-style'

/**
 * Relay Echoes on the route. Marks of a whole run (a ghost record, a rescue, a milestone) stand beside the track as
 * a slim gold obelisk just outside the guard rail. Moments a runner made in motion stand where they happened as a
 * gold spectral silhouette of that runner: an edge save frozen leaning off the rail, a relay cut frozen mid-flight
 * over the cut. Each gets a floating label that becomes readable 120 to 60 m ahead. Passing an echo on its path
 * makes it shimmer and reports it once. Obelisks, each silhouette pose and the labels draw as one instanced call each.
 */

/** Metres from the deck edge to the obelisk: clear of the curb and the guard rail. */
const EDGE_GAP = 1.3
/** An edge save stands this far inside the rail, on the shoulder. */
const SAVE_INSET = 0.5
/** A relay cut hangs this high over its path, mid-flight. */
const CUT_HEIGHT = 2.6
const LABEL_HEIGHT = 4.2
const SILHOUETTE_LABEL_CLEARANCE = 2.5
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
const SILHOUETTE_GOLD = new THREE.Color(2.2, 1.35, 0.4)

type EchoForm = 'obelisk' | 'save' | 'cut'

interface StandingEcho {
  id: string
  form: EchoForm
  /** Route distance in metres, and the simulation's Q16.16 distance that passes it. */
  d: number
  dist: number
  /** Couriers on another path of the fork ride past out of reach. */
  path: relayLeg.Path
  matrix: THREE.Matrix4
  label: THREE.Vector3
  /** Index within the instanced mesh of its form. */
  slot: number
  sincePassed: number
  /** Brightness last written to its instance colour. */
  glow: number
}

export interface EchoFrame {
  state: relayLeg.State
  /** Courier distance on screen, metres. */
  viewDist: number
  camera: THREE.PerspectiveCamera
  dt: number
  time: number
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

function formOf(echo: RelayEcho): EchoForm {
  if (echo.kind === 'edge-save') return 'save'
  if (echo.kind === 'relay-cut') return 'cut'
  return 'obelisk'
}

/** Side of the road whose rail an edge save leant off: a rail side, alternating when both are rails. */
function saveSide(route: Route, path: relayLeg.Path, d: number, index: number): -1 | 1 {
  const lanes = route.lanes(path, d)
  if (lanes.right === 'rail' && lanes.left !== 'rail') return 1
  if (lanes.left === 'rail' && lanes.right !== 'rail') return -1
  return index % 2 === 0 ? 1 : -1
}

const frame = createRouteFrame()
const mirror = new THREE.Matrix4()
const position = new THREE.Vector3()

function stand(route: Route, echo: RelayEcho, index: number): Omit<StandingEcho, 'slot'> | null {
  if (echo.dist === null) return null
  const d = fromQ(echo.dist)
  if (d <= 0 || d > route.finish) return null
  const fork = route.forkAt(d)
  const form = formOf(echo)
  const pioneer = echo.kind === 'risk-pioneer' || echo.kind === 'relay-cut'
  const path: relayLeg.Path = fork ? (pioneer ? 'risk' : 'safe') : 'main'
  const base: Omit<StandingEcho, 'slot' | 'matrix' | 'label'> = { id: echo.id, form, d, dist: echo.dist, path, sincePassed: Number.POSITIVE_INFINITY, glow: REST_GLOW }
  route.frame(d, frame)

  if (form === 'obelisk') {
    // Pioneers stand on the risk side; others alternate sides, or keep to the safe side inside a fork.
    const side = fork ? (path === 'risk' ? fork.riskSide : -fork.riskSide) : index % 2 === 0 ? -1 : 1
    const lateral = route.pathOffset(path, d) + side * (route.halfWidth(path, d) + EDGE_GAP)
    route.flatPoint(d, lateral, position)
    return { ...base, matrix: new THREE.Matrix4().makeTranslation(position), label: position.clone().setY(position.y + LABEL_HEIGHT) }
  }

  if (form === 'save') {
    const side = saveSide(route, path, d, index)
    route.point(d, route.pathOffset(path, d) + side * (route.halfWidth(path, d) - SAVE_INSET), 0.26, position)
    // The pose leans off a right-hand rail; a left-hand save is its mirror image.
    const matrix = new THREE.Matrix4().compose(position, frame.quaternion, new THREE.Vector3(1, 1, 1))
    if (side < 0) matrix.multiply(mirror.makeScale(-1, 1, 1))
    return { ...base, matrix, label: position.clone().addScaledVector(frame.up, LABEL_HEIGHT) }
  }

  route.point(d, route.pathOffset(path, d), CUT_HEIGHT, position)
  const matrix = new THREE.Matrix4().compose(position, frame.quaternion, new THREE.Vector3(1, 1, 1))
  return { ...base, matrix, label: position.clone().addScaledVector(frame.up, SILHOUETTE_LABEL_CLEARANCE) }
}

export class EchoField {
  readonly group = new THREE.Group()
  private readonly standing: StandingEcho[]
  private readonly meshes: Readonly<Record<EchoForm, THREE.InstancedMesh>>
  private readonly silhouetteMaterial: THREE.ShaderMaterial
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
    const counts: Record<EchoForm, number> = { obelisk: 0, save: 0, cut: 0 }
    const shown = trackEchoes(echoes).flatMap((echo, index) => {
      const standing = stand(route, echo, index)
      return standing ? [{ echo, standing: { ...standing, slot: counts[standing.form]++ } }] : []
    })
    this.standing = shown.map(item => item.standing)
    const count = this.standing.length

    const obeliskMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    fadeNearCamera(obeliskMaterial, 'echo-obelisk')
    this.silhouetteMaterial = createSilhouetteMaterial(SILHOUETTE_GOLD)
    this.meshes = {
      obelisk: new THREE.InstancedMesh(counts.obelisk > 0 ? obeliskGeometry() : new THREE.BufferGeometry(), obeliskMaterial, Math.max(1, counts.obelisk)),
      // Leaning off the rail: body away from it, board edge down into it, arms out for balance.
      save: new THREE.InstancedMesh(
        counts.save > 0 ? bakeCourierSilhouette({ lean: -0.85, crouch: 0.7, pitch: 0.45, armsOut: 1, twist: -0.3, boardRoll: -0.32 }) : new THREE.BufferGeometry(),
        this.silhouetteMaterial,
        Math.max(1, counts.save),
      ),
      // Mid-flight over the cut: knees tucked, arms wide, board nose up.
      cut: new THREE.InstancedMesh(
        counts.cut > 0 ? bakeCourierSilhouette({ tuck: 1, armsOut: 1, pitch: 0.25, crouch: 0.2, boardPitch: 0.2 }) : new THREE.BufferGeometry(),
        this.silhouetteMaterial,
        Math.max(1, counts.cut),
      ),
    }
    this.meshes.obelisk.name = 'echo-obelisks'
    this.meshes.save.name = 'echo-saves'
    this.meshes.cut.name = 'echo-cuts'
    this.atlas = createLabelAtlas(shown.map(item => echoLabel(item.echo)))
    this.labels = new THREE.InstancedMesh(new THREE.PlaneGeometry(LABEL_ASPECT, 1), createLabelMaterial(this.atlas, count), Math.max(1, count))
    this.labels.name = 'echo-labels'
    // Drawn before other transparent effects, so hazard warnings and gate flashes always read over a label.
    this.labels.renderOrder = -1
    for (const form of ['obelisk', 'save', 'cut'] as const) this.prepare(this.meshes[form], counts[form])
    this.prepare(this.labels, count)
    this.standing.forEach((item, index) => {
      const mesh = this.meshes[item.form]
      mesh.setMatrixAt(item.slot, item.matrix)
      mesh.setColorAt(item.slot, this.color.setScalar(REST_GLOW))
      this.labels.setMatrixAt(index, HIDDEN)
      this.labels.setColorAt(index, this.color.setRGB(0, 0, index))
    })
    for (const mesh of Object.values(this.meshes)) mesh.instanceMatrix.needsUpdate = true
  }

  private prepare(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count
    mesh.visible = false
    mesh.frustumCulled = false
    this.group.add(mesh)
  }

  /** Shimmers and labels the echoes for this frame. Returns the ids of echoes the simulation passed since the last frame. */
  update(frame: EchoFrame): readonly string[] {
    this.passed.length = 0
    if (this.standing.length === 0) return this.passed
    const { state, camera } = frame
    camera.getWorldDirection(this.forward)
    this.silhouetteMaterial.uniforms.uTime!.value = frame.time
    const nearby: Record<EchoForm, boolean> = { obelisk: false, save: false, cut: false }
    const glowChanged: Record<EchoForm, boolean> = { obelisk: false, save: false, cut: false }
    let labelled = false
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
        glowChanged[item.form] = true
        this.meshes[item.form].setColorAt(item.slot, this.color.setScalar(glow))
      }
      const ahead = item.d - frame.viewDist
      nearby[item.form] ||= ahead > -VIEW_BEHIND && ahead < frame.drawDistance
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
    for (const form of ['obelisk', 'save', 'cut'] as const) {
      const mesh = this.meshes[form]
      mesh.visible = nearby[form]
      if (glowChanged[form] && mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.labels.visible = labelled
    this.labels.instanceMatrix.needsUpdate = true
    if (this.labels.instanceColor) this.labels.instanceColor.needsUpdate = true
    return this.passed
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const mesh of [...Object.values(this.meshes), this.labels]) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
    if (this.meshes.obelisk.material instanceof THREE.Material) this.meshes.obelisk.material.dispose()
    this.silhouetteMaterial.dispose()
    if (this.labels.material instanceof THREE.Material) this.labels.material.dispose()
    this.atlas.dispose()
  }
}
