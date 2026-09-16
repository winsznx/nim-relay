import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { fadeNearCamera } from './materials'
import { MeshBuilder } from './mesh-builder'
import { createRouteFrame, fromQ, type Route } from './route'

/**
 * Gold gates: pairs of light blades marking the perfect window, with a gold
 * threshold on the deck. Pulse gates are drawn as two lanes; the lit lane snaps
 * across on every beat and the other lane stays ghosted. Every gate of a kind
 * shares one instanced mesh.
 */

type GateState = 'pending' | 'perfect' | 'missed' | 'skipped'

export interface GateFlash {
  position: THREE.Vector3
  kind: relayLeg.GateKind
  pulse: boolean
}

const BLADE_HEIGHT = 1.75
const PENDING = new THREE.Color(2.3, 1.18, 0.2)
const PULSE_LIT = new THREE.Color(3.2, 1.9, 0.55)
const PULSE_GHOST = new THREE.Color(0.22, 0.13, 0.04)
const PASSED = new THREE.Color(0.55, 0.28, 0.05)
const MISSED = new THREE.Color(0.28, 0.07, 0.06)
const FLASH = new THREE.Color(6, 3.6, 1.3)
const OFF = new THREE.Color(0, 0, 0)
/** Seconds after a gate is passed over which its blades sink into the deck, before the chase camera reaches them. */
const RETRACT_FROM = 0.05
const RETRACT_TO = 0.2

/**
 * One gate of light: two tapered blades curving gently inwards like an open
 * arch, bright at the base and fading upwards, with a cap spark and a gold
 * threshold across the perfect window. Vertex colours carry the gradient;
 * instance colours carry gate state.
 */
function gateShape(builder: MeshBuilder, half: number): void {
  const bright = new THREE.Color(1, 1, 1)
  const faint = new THREE.Color(0.28, 0.28, 0.28)
  const segments = 6
  const at = (side: -1 | 1, t: number, edge: -1 | 1, out: THREE.Vector3): THREE.Vector3 => {
    const width = 0.075 * (1 - t) + 0.014
    const lean = 0.22 * t * t
    return out.set(side * (half + 0.12 - lean) + edge * width, 0.04 + t * (BLADE_HEIGHT - 0.04), 0)
  }
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const d = new THREE.Vector3()
  const low = new THREE.Color()
  const high = new THREE.Color()
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments
      const t1 = (i + 1) / segments
      low.copy(bright).lerp(faint, t0)
      high.copy(bright).lerp(faint, t1)
      at(side, t0, -1, a)
      at(side, t0, 1, b)
      at(side, t1, 1, c)
      at(side, t1, -1, d)
      builder.quad(a, b, c, d, low, [0, 0, 0, 0], high)
      builder.quad(b, a, d, c, low, [0, 0, 0, 0], high)
    }
    const tip = at(side, 1, -1, a).x + 0.014
    const cap = BLADE_HEIGHT + 0.07
    builder.quad(new THREE.Vector3(tip - 0.05, cap, 0), new THREE.Vector3(tip, cap - 0.05, 0), new THREE.Vector3(tip + 0.05, cap, 0), new THREE.Vector3(tip, cap + 0.05, 0), bright)
    builder.quad(new THREE.Vector3(tip + 0.05, cap, 0), new THREE.Vector3(tip, cap - 0.05, 0), new THREE.Vector3(tip - 0.05, cap, 0), new THREE.Vector3(tip, cap + 0.05, 0), bright)
    const foot = side * (half + 0.12)
    builder.quad(new THREE.Vector3(foot - 0.16, 0.03, 0.12), new THREE.Vector3(foot + 0.16, 0.03, 0.12), new THREE.Vector3(foot + 0.16, 0.03, -0.12), new THREE.Vector3(foot - 0.16, 0.03, -0.12), bright)
  }
  const threshold = new THREE.Color(0.42, 0.42, 0.42)
  builder.quad(new THREE.Vector3(-half, 0.028, 0.04), new THREE.Vector3(half, 0.028, 0.04), new THREE.Vector3(half, 0.028, -0.04), new THREE.Vector3(-half, 0.028, -0.04), threshold)
}

interface KindMeshes {
  lights: THREE.InstancedMesh
}

export class GateField {
  readonly group = new THREE.Group()
  private readonly states: GateState[]
  private readonly flashAge: Float32Array
  /** Slot of each gate's first lane within its kind; pulse gates own two consecutive slots. */
  private readonly slot: Int32Array
  private readonly positions: THREE.Vector3[][]
  private readonly passedLane: Int8Array
  private readonly meshes: Record<relayLeg.GateKind, KindMeshes>
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly lightMaterials: THREE.Material[] = []
  private readonly color = new THREE.Color()
  /** Base placement of every lane instance, so passed gates can be flattened without recomputing route frames. */
  private readonly placements: { position: THREE.Vector3; quaternion: THREE.Quaternion; hidden: boolean }[][]
  private readonly matrix = new THREE.Matrix4()
  private readonly scale = new THREE.Vector3()
  private lastGateIdx = 0
  private forkPath: relayLeg.Path = 'main'

  constructor(private readonly route: Route) {
    const gates = route.track.gates
    this.states = gates.map(() => 'pending')
    this.flashAge = new Float32Array(gates.length).fill(99)
    this.slot = new Int32Array(gates.length)
    this.passedLane = new Int8Array(gates.length)
    this.positions = gates.map(() => [new THREE.Vector3(), new THREE.Vector3()])
    this.placements = gates.map(gate => (gate.kind === 'pulse' ? [0, 1] : [0]).map(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), hidden: false })))
    this.group.name = 'gates'

    const build = (kind: relayLeg.GateKind): KindMeshes => {
      const ofKind = gates.filter(gate => gate.kind === kind)
      const lanes = kind === 'pulse' ? 2 : 1
      const half = ofKind.length > 0 ? fromQ(ofKind[0]!.half) : 1
      const lightBuilder = new MeshBuilder()
      gateShape(lightBuilder, half)
      const lightGeometry = lightBuilder.build()
      this.geometries.push(lightGeometry)
      const lightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true })
      fadeNearCamera(lightMaterial, 'gate-light')
      this.lightMaterials.push(lightMaterial)
      const lights = new THREE.InstancedMesh(lightGeometry, lightMaterial, Math.max(1, ofKind.length * lanes))
      lights.count = ofKind.length * lanes
      lights.visible = ofKind.length > 0
      lights.frustumCulled = false
      lights.name = `gate-${kind}-lights`
      this.group.add(lights)
      return { lights }
    }
    this.meshes = { gold: build('gold'), pulse: build('pulse') }
    this.place()
  }

  private place(): void {
    const transform = new THREE.Object3D()
    const frame = createRouteFrame()
    const next: Record<relayLeg.GateKind, number> = { gold: 0, pulse: 0 }
    this.route.track.gates.forEach((gate, index) => {
      const { lights } = this.meshes[gate.kind]
      const first = next[gate.kind]
      this.slot[index] = first
      const lanes = gate.kind === 'pulse' ? [gate.x, -gate.x] : [gate.x]
      next[gate.kind] += lanes.length
      const d = fromQ(gate.dist)
      this.route.frame(d, frame)
      lanes.forEach((x, lane) => {
        const hidden = lane === 1 && gate.x === 0
        this.route.point(d, this.route.pathOffset(gate.path, d) + fromQ(x), 0, transform.position)
        transform.quaternion.copy(frame.quaternion)
        transform.scale.setScalar(hidden ? 0 : 1)
        transform.updateMatrix()
        const placement = this.placements[index]![lane]!
        placement.position.copy(transform.position)
        placement.quaternion.copy(transform.quaternion)
        placement.hidden = hidden
        lights.setMatrixAt(first + lane, transform.matrix)
        lights.setColorAt(first + lane, gate.kind === 'pulse' ? PULSE_GHOST : PENDING)
        this.positions[index]![lane]!.copy(transform.position).addScaledVector(frame.up, 1)
      })
    })
    for (const kind of ['gold', 'pulse'] as const) {
      const { lights } = this.meshes[kind]
      lights.instanceMatrix.needsUpdate = true
      if (lights.instanceColor) lights.instanceColor.needsUpdate = true
    }
  }

  /** Resolves gates passed since the last frame, animates their lights and reports perfect flashes. */
  update(state: relayLeg.State, frameEvents: number, dt: number, flashes: GateFlash[]): void {
    flashes.length = 0
    const track = state.track
    const gates = track.gates
    const resolved = state.gateIdx - this.lastGateIdx
    if (state.path !== 'main') this.forkPath = state.path
    for (let index = this.lastGateIdx; index < state.gateIdx; index++) {
      const gate = gates[index]!
      const active = gate.dist >= track.fork.from && gate.dist < track.fork.to ? this.forkPath : 'main'
      if (gate.path !== active) {
        this.states[index] = 'skipped'
        continue
      }
      const litX = relayLeg.pulseGateLateral(gate, state.tick)
      this.passedLane[index] = litX === gate.x ? 0 : 1
      const perfect = resolved === 1 ? (frameEvents & relayLeg.EVENT.PERFECT_GATE) !== 0 : Math.abs(state.x - litX) <= gate.half
      this.states[index] = perfect ? 'perfect' : 'missed'
      this.flashAge[index] = 0
      if (perfect) {
        flashes.push({ position: this.positions[index]![this.passedLane[index]!]!, kind: gate.kind, pulse: (frameEvents & relayLeg.EVENT.PULSE_HIT) !== 0 })
      }
    }
    this.lastGateIdx = state.gateIdx

    const beatWindow = relayLeg.onBeat(track, state.tick) ? 1 : 0
    const low = Math.max(0, this.lastGateIdx - 6)
    const high = Math.min(gates.length, this.lastGateIdx + 48)
    let goldDirty = false
    let pulseDirty = false
    let goldMoved = false
    let pulseMoved = false
    for (let index = low; index < high; index++) {
      const gate = gates[index]!
      const age = (this.flashAge[index]! += dt)
      const { lights } = this.meshes[gate.kind]
      const first = this.slot[index]!
      if (this.states[index] === 'perfect' || this.states[index] === 'missed') {
        const standing = 1 - THREE.MathUtils.smoothstep(age, RETRACT_FROM, RETRACT_TO)
        const lanes = this.placements[index]!
        for (let lane = 0; lane < lanes.length; lane++) {
          const placement = lanes[lane]!
          this.scale.set(1, placement.hidden ? 0 : Math.max(0.001, standing), 1)
          lights.setMatrixAt(first + lane, this.matrix.compose(placement.position, placement.quaternion, this.scale))
        }
        if (gate.kind === 'gold') goldMoved = true
        else pulseMoved = true
      }
      if (gate.kind === 'gold') {
        lights.setColorAt(first, this.resolvedColor(index, PENDING, age))
        goldDirty = true
        continue
      }
      const litLane = this.states[index] === 'pending' ? (relayLeg.pulseGateLateral(gate, state.tick) === gate.x ? 0 : 1) : this.passedLane[index]!
      for (const lane of [0, 1] as const) {
        const lit = this.color.copy(PULSE_LIT).lerp(FLASH, beatWindow * 0.35)
        const color = lane === litLane ? this.resolvedColor(index, lit, age) : this.states[index] === 'pending' ? PULSE_GHOST : OFF
        lights.setColorAt(first + lane, color)
      }
      pulseDirty = true
    }
    if (goldDirty && this.meshes.gold.lights.instanceColor) this.meshes.gold.lights.instanceColor.needsUpdate = true
    if (pulseDirty && this.meshes.pulse.lights.instanceColor) this.meshes.pulse.lights.instanceColor.needsUpdate = true
    if (goldMoved) this.meshes.gold.lights.instanceMatrix.needsUpdate = true
    if (pulseMoved) this.meshes.pulse.lights.instanceMatrix.needsUpdate = true
  }

  private resolvedColor(index: number, pending: THREE.Color, age: number): THREE.Color {
    switch (this.states[index]) {
      case 'pending':
        return pending
      case 'skipped':
        return OFF
      case 'missed':
        return MISSED
      case 'perfect': {
        const flash = Math.max(0, 1 - age / 0.45)
        return this.color.copy(PASSED).lerp(FLASH, flash * flash)
      }
      default:
        return pending
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const kind of ['gold', 'pulse'] as const) this.meshes[kind].lights.dispose()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.lightMaterials) material.dispose()
  }
}
