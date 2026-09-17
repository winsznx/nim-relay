import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { createHazardMaterials, droneGeometry, rotorGeometry, streakGeometry, type HazardMaterials } from './hazard-parts'
import { Q, createPathLanes, createRouteFrame, fromQ, type Route } from './route'

/**
 * Hazards on lane slots, drawn from the simulation's own rules. Static
 * barriers and beams cover exactly their blocked lanes; sweepers and drones
 * move between their two endpoint lanes on their period, and a red floor light
 * marks the lane a mover holds right now.
 */

const RED = new THREE.Color(4, 0.22, 0.28)
const RED_DIM = new THREE.Color(0.9, 0.05, 0.07)
const WHITE = new THREE.Color(1, 1, 1)
const ROTOR_BLUR = new THREE.Color(0.1, 0.105, 0.12)
const GUST_FLOOR = new THREE.Color(0.2, 0.17, 0.13)
const OFF = new THREE.Color(0, 0, 0)
/** Instances stay collapsed until their hazard first comes into view. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const VIEW_BEHIND = 30
/** Warning glyphs: height above the deck per kind, and the window ahead of the courier where they show. */
const WARNING_HEIGHT: Readonly<Record<relayLeg.HazardKind, number>> = { barrier: 1.75, beam: 2.4, sweeper: 1.75, drone: 2.5, gust: 2.3 }
const WARNING_NEAR = 16
const WARNING_FAR = 150
/** Warning glyphs show over only the next few hazards, so a busy stretch does not stack them. */
const WARNING_COUNT = 2
/** World size per metre of camera distance, so the glyph keeps a steady small size on screen. */
const WARNING_SCALE = 0.048
/** Blocked lanes collide within this margin of the lane boundaries, and their blocks stop there too. */
const LANE_MARGIN = relayLeg.HIT_MARGIN / Q
const BEAM_HEIGHT = 1.3
const MAX_LANES = 4

type PartName = 'stripe' | 'plain' | 'light' | 'beacon' | 'drone' | 'rotor' | 'floor' | 'gust' | 'warning'
const PART_NAMES: readonly PartName[] = ['stripe', 'plain', 'light', 'beacon', 'drone', 'rotor', 'floor', 'gust', 'warning']

interface Part {
  mesh: THREE.InstancedMesh
  next: number
}

interface HazardSlots {
  hazard: relayLeg.Hazard
  d: number
  slots: Partial<Record<PartName, number[]>>
}

const PART_BUDGET: Record<relayLeg.HazardKind, Partial<Record<PartName, number>>> = {
  barrier: { stripe: MAX_LANES, light: MAX_LANES, beacon: MAX_LANES * 2, warning: 1 },
  beam: { stripe: MAX_LANES, plain: 3, light: MAX_LANES, beacon: 2, warning: 1 },
  sweeper: { stripe: 1, plain: 1, light: 2, beacon: 1, floor: 1, warning: 1 },
  drone: { drone: 1, rotor: 4, light: 1, beacon: 1, floor: 1, warning: 1 },
  gust: { gust: 14, floor: 2, warning: 1 },
}

/** Contiguous runs of blocked lane slots, so a barrier over two neighbouring lanes is one block. */
function laneRuns(lanes: readonly number[]): [number, number][] {
  const sorted = [...lanes].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const slot of sorted) {
    const last = runs[runs.length - 1]
    if (last && slot - last[1] <= 2) last[1] = slot
    else runs.push([slot, slot])
  }
  return runs
}

export class HazardField {
  readonly group = new THREE.Group()
  private readonly materials: HazardMaterials
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly parts: Record<PartName, Part>
  private readonly entries: HazardSlots[]
  private readonly transform = new THREE.Object3D()
  private readonly frame = createRouteFrame()
  private readonly lanes = createPathLanes()
  private readonly color = new THREE.Color()
  private readonly spin = new THREE.Quaternion()
  private readonly axisY = new THREE.Vector3(0, 1, 0)
  private readonly glyph = new THREE.Vector3()

  constructor(
    private readonly route: Route,
    private readonly detail: boolean,
  ) {
    this.group.name = 'hazards'
    this.materials = createHazardMaterials()
    const hazards = route.track.hazards
    const totals: Record<PartName, number> = { stripe: 0, plain: 0, light: 0, beacon: 0, drone: 0, rotor: 0, floor: 0, gust: 0, warning: 0 }
    for (const hazard of hazards) {
      for (const name of PART_NAMES) totals[name] += PART_BUDGET[hazard.kind][name] ?? 0
    }
    const box = this.keep(new THREE.BoxGeometry(1, 1, 1))
    const beacon = this.keep(new THREE.OctahedronGeometry(0.5, 0))
    const floor = this.keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
    const emissive = new Set<THREE.Material>([this.materials.light, this.materials.additive, this.materials.gust, this.materials.floor, this.materials.warning])
    const make = (name: PartName, geometry: THREE.BufferGeometry, material: THREE.Material): Part => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, totals[name]))
      mesh.count = totals[name]
      mesh.visible = totals[name] > 0
      mesh.frustumCulled = false
      mesh.name = `hazard-${name}`
      for (let i = 0; i < Math.max(1, mesh.count); i++) {
        mesh.setColorAt(i, emissive.has(material) ? OFF : WHITE)
        mesh.setMatrixAt(i, HIDDEN)
      }
      this.group.add(mesh)
      return { mesh, next: 0 }
    }
    this.parts = {
      stripe: make('stripe', box, this.materials.stripe),
      plain: make('plain', box, this.materials.plain),
      light: make('light', box, this.materials.light),
      beacon: make('beacon', beacon, this.materials.light),
      drone: make('drone', this.keep(droneGeometry()), this.materials.plain),
      rotor: make('rotor', this.keep(rotorGeometry()), this.materials.additive),
      floor: make('floor', floor, this.materials.floor),
      gust: make('gust', this.keep(streakGeometry()), this.materials.gust),
      warning: make('warning', this.keep(new THREE.PlaneGeometry(1, 1)), this.materials.warning),
    }
    this.entries = hazards.map(hazard => {
      const slots: Partial<Record<PartName, number[]>> = {}
      for (const name of PART_NAMES) {
        const count = PART_BUDGET[hazard.kind][name] ?? 0
        if (count === 0) continue
        const part = this.parts[name]
        slots[name] = Array.from({ length: count }, () => part.next++)
      }
      return { hazard, d: fromQ(hazard.dist), slots }
    })
    this.parts.rotor.mesh.visible = this.detail && this.parts.rotor.mesh.count > 0
    for (const entry of this.entries) this.placeStatic(entry)
    for (const part of Object.values(this.parts)) {
      part.mesh.instanceMatrix.needsUpdate = true
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true
    }
  }

  private keep<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  /** Places an instance at route distance d, lateral offset, height, with optional scale and yaw. */
  private put(name: PartName, slot: number, d: number, lateral: number, height: number, sx: number, sy: number, sz: number, yaw = 0): void {
    const t = this.transform
    this.route.frame(d, this.frame)
    this.route.point(d, lateral, height, t.position)
    t.quaternion.copy(this.frame.quaternion)
    if (yaw !== 0) t.quaternion.multiply(this.spin.setFromAxisAngle(this.axisY, yaw))
    t.scale.set(sx, sy, sz)
    t.updateMatrix()
    this.parts[name].mesh.setMatrixAt(slot, t.matrix)
  }

  private tint(name: PartName, slot: number, color: THREE.Color): void {
    this.parts[name].mesh.setColorAt(slot, color)
  }

  private placeStatic(entry: HazardSlots): void {
    const { hazard, d, slots } = entry
    const lanes = this.route.lanes(hazard.path, d, this.lanes)
    const centre = this.route.pathOffset(hazard.path, d)
    const halfWidth = (lanes.count * lanes.width) / 2 + lanes.shoulder
    switch (hazard.kind) {
      case 'barrier': {
        laneRuns(hazard.lanes).forEach(([low, high], run) => {
          const spansRoad = low <= 1 - lanes.count && high >= lanes.count - 1
          const left = spansRoad ? centre - halfWidth : centre + ((low - 1) * lanes.width) / 2 + LANE_MARGIN
          const right = spansRoad ? centre + halfWidth : centre + ((high + 1) * lanes.width) / 2 - LANE_MARGIN
          const x = (left + right) / 2
          const width = right - left
          this.put('stripe', slots.stripe![run]!, d, x, 0.42, width, 0.84, 0.36)
          this.put('light', slots.light![run]!, d - 0.19, x, 0.8, width - 0.08, 0.05, 0.03)
          this.tint('light', slots.light![run]!, RED)
          for (const [i, slot] of [slots.beacon![run * 2]!, slots.beacon![run * 2 + 1]!].entries()) {
            this.put('beacon', slot, d, i === 0 ? left : right, 0.98, 0.14, 0.2, 0.14)
            this.tint('beacon', slot, RED)
          }
        })
        return
      }
      case 'beam': {
        this.put('plain', slots.plain![0]!, d, centre - halfWidth - 0.4, 1.75, 0.22, 3.5, 0.26)
        this.put('plain', slots.plain![1]!, d, centre + halfWidth + 0.4, 1.75, 0.22, 3.5, 0.26)
        this.put('plain', slots.plain![2]!, d, centre, 3.45, halfWidth * 2 + 1.1, 0.24, 0.3)
        laneRuns(hazard.lanes).forEach(([low, high], run) => {
          const left = centre + ((low - 1) * lanes.width) / 2 + 0.06
          const right = centre + ((high + 1) * lanes.width) / 2 - 0.06
          const x = (left + right) / 2
          this.put('stripe', slots.stripe![run]!, d, x, BEAM_HEIGHT + 0.17, right - left, 0.34, 0.32)
          this.put('light', slots.light![run]!, d - 0.17, x, BEAM_HEIGHT, right - left - 0.1, 0.045, 0.03)
          this.tint('light', slots.light![run]!, RED)
        })
        slots.beacon!.forEach((slot, i) => {
          this.put('beacon', slot, d, centre + (i === 0 ? -1 : 1) * (halfWidth + 0.4), 3.72, 0.16, 0.22, 0.16)
          this.tint('beacon', slot, RED)
        })
        return
      }
      case 'sweeper': {
        const a = centre + ((hazard.lanes[0] ?? 0) * lanes.width) / 2
        const b = centre + ((hazard.lanes[1] ?? hazard.lanes[0] ?? 0) * lanes.width) / 2
        this.put('plain', slots.plain![0]!, d, (a + b) / 2, 0.03, Math.abs(b - a) + lanes.width * 0.8, 0.06, 0.3)
        return
      }
      case 'drone':
        this.tint('light', slots.light![0]!, RED)
        this.tint('beacon', slots.beacon![0]!, RED)
        for (const slot of slots.rotor!) this.tint('rotor', slot, ROTOR_BLUR)
        return
      case 'gust': {
        const length = fromQ(hazard.length)
        const push = Math.sign(hazard.amplitude) || 1
        slots.gust!.forEach((slot, i) => {
          const along = d + ((i + 0.5) / slots.gust!.length) * length
          const height = 0.35 + ((i * 7) % 5) * 0.32
          this.put('gust', slot, along, centre + (((i * 13) % 7) - 3) * halfWidth * 0.2, height, halfWidth * 1.6, 0.2, 1)
          this.color.setRGB(1, i / slots.gust!.length, push > 0 ? 1 : 0)
          this.tint('gust', slot, this.color)
        })
        slots.floor!.forEach((slot, i) => {
          const lateral = centre + (i === 0 ? -0.5 : 0.5) * halfWidth
          this.put('floor', slot, d + 2, lateral, 0.03, 3.2, 1, halfWidth * 0.8, push > 0 ? -Math.PI / 2 : Math.PI / 2)
          this.tint('floor', slot, GUST_FLOOR)
        })
        return
      }
    }
  }

  /** Updates moving hazards near the courier. `tick` and `alpha` match the courier's interpolation. */
  update(dist: number, drawDistance: number, tick: number, alpha: number, time: number, camera: THREE.Vector3): void {
    this.materials.update(time)
    const blink = Math.sin(time * 9) > 0 ? 1 : 0.35
    let warnings = 0
    for (const entry of this.entries) {
      if (entry.d < dist - VIEW_BEHIND || entry.d > dist + drawDistance) continue
      if (warnings < WARNING_COUNT && this.updateWarning(entry, dist, Math.min(WARNING_FAR, drawDistance), tick, alpha, camera)) warnings++
      else this.parts.warning.mesh.setMatrixAt(entry.slots.warning![0]!, HIDDEN)
      switch (entry.hazard.kind) {
        case 'sweeper':
          this.updateSweeper(entry, tick, alpha, blink)
          break
        case 'drone':
          this.updateDrone(entry, tick, alpha, time)
          break
        case 'barrier':
        case 'beam':
          for (const slot of entry.slots.beacon ?? []) this.tint('beacon', slot, this.color.copy(RED).multiplyScalar(blink))
          break
        case 'gust':
          break
      }
    }
    this.parts.warning.mesh.visible = warnings > 0
    for (const part of Object.values(this.parts)) {
      part.mesh.instanceMatrix.needsUpdate = true
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true
    }
  }

  /** Floats a warning triangle over a hazard that is still far enough ahead to need one. Returns whether it shows. */
  private updateWarning(entry: HazardSlots, dist: number, far: number, tick: number, alpha: number, camera: THREE.Vector3): boolean {
    const slot = entry.slots.warning![0]!
    const ahead = entry.d - dist
    const fade = THREE.MathUtils.smoothstep(ahead, WARNING_NEAR, WARNING_NEAR + 14) * (1 - THREE.MathUtils.smoothstep(ahead, far * 0.8, far))
    if (fade <= 0.001) {
      this.parts.warning.mesh.setMatrixAt(slot, HIDDEN)
      return false
    }
    const { hazard, d } = entry
    const moving = hazard.kind === 'sweeper' || hazard.kind === 'drone'
    const lateral = moving ? this.lateralAt(hazard, d, tick, alpha) : this.blockedCentre(hazard, d)
    this.route.point(d, lateral, WARNING_HEIGHT[hazard.kind], this.glyph)
    const size = Math.max(0.45, this.glyph.distanceTo(camera) * WARNING_SCALE)
    this.transform.position.copy(this.glyph)
    this.transform.quaternion.identity()
    this.transform.scale.setScalar(size)
    this.transform.updateMatrix()
    this.parts.warning.mesh.setMatrixAt(slot, this.transform.matrix)
    this.tint('warning', slot, this.color.setRGB(fade, 0, 0))
    return true
  }

  private blockedCentre(hazard: relayLeg.Hazard, d: number): number {
    if (hazard.kind === 'gust' || hazard.lanes.length === 0) return this.route.pathOffset(hazard.path, d)
    let sum = 0
    for (const slot of hazard.lanes) sum += slot
    return this.route.slotLateral(hazard.path, sum / hazard.lanes.length, d)
  }

  /** A mover's lateral position from the main centre line, interpolated between ticks like the courier. */
  private lateralAt(hazard: relayLeg.Hazard, d: number, tick: number, alpha: number): number {
    const width = Math.round(this.route.lanes(hazard.path, d, this.lanes).width * Q)
    const previous = relayLeg.hazardLaneAt(hazard, Math.max(0, tick - 1), width)
    const current = relayLeg.hazardLaneAt(hazard, tick, width)
    return this.route.pathOffset(hazard.path, d) + fromQ(previous + (current - previous) * alpha)
  }

  /** The lane a mover holds right now, as a floor light. */
  private holdFloor(entry: HazardSlots, tick: number, color: THREE.Color): void {
    const { hazard, d, slots } = entry
    const lanes = this.route.lanes(hazard.path, d, this.lanes)
    const slot = (fromQ(relayLeg.hazardLaneAt(hazard, tick, Math.round(lanes.width * Q))) * 2) / lanes.width
    const held = Math.round((slot + lanes.count - 1) / 2) * 2 - (lanes.count - 1)
    this.put('floor', slots.floor![0]!, d - 2.6, this.route.slotLateral(hazard.path, held, d), 0.03, lanes.width - 0.4, 1, 4.6)
    this.tint('floor', slots.floor![0]!, color)
  }

  private updateSweeper(entry: HazardSlots, tick: number, alpha: number, blink: number): void {
    const { hazard, d, slots } = entry
    const x = this.lateralAt(hazard, d, tick, alpha)
    const width = this.route.lanes(hazard.path, d, this.lanes).width - LANE_MARGIN * 2
    this.put('stripe', slots.stripe![0]!, d, x, 0.45, width, 0.78, 0.55)
    this.put('light', slots.light![0]!, d - 0.29, x, 0.82, width - 0.06, 0.05, 0.03)
    this.put('light', slots.light![1]!, d, x, 0.07, width + 0.12, 0.06, 0.62)
    this.tint('light', slots.light![0]!, RED)
    this.tint('light', slots.light![1]!, RED_DIM)
    this.put('beacon', slots.beacon![0]!, d, x, 0.98, 0.16, 0.22, 0.16)
    this.tint('beacon', slots.beacon![0]!, this.color.copy(RED).multiplyScalar(blink))
    this.holdFloor(entry, tick, this.color.copy(RED).multiplyScalar(0.5))
  }

  private updateDrone(entry: HazardSlots, tick: number, alpha: number, time: number): void {
    const { hazard, d, slots } = entry
    const x = this.lateralAt(hazard, d, tick, alpha)
    const hover = Math.sin(time * 3 + d) * 0.05
    const bank = (this.lateralAt(hazard, d, tick + 1, alpha) - x) * 3
    const width = this.route.lanes(hazard.path, d, this.lanes).width - LANE_MARGIN * 2
    this.put('drone', slots.drone![0]!, d, x, 1.42 + hover, 1, 1, 1, bank)
    this.put('light', slots.light![0]!, d, x, 1.14 + hover, width, 0.05, 0.12)
    this.put('beacon', slots.beacon![0]!, d - 0.45, x, 1.25 + hover, 0.2, 0.2, 0.2)
    const rotors = slots.rotor!
    for (let i = 0; i < rotors.length; i++) {
      const corner = i < 2 ? -1 : 1
      const along = i % 2 === 0 ? -0.62 : 0.62
      this.put('rotor', rotors[i]!, d + along, x + corner * 0.9, 1.5 + hover, 1, 1, 1, time * 40 + i)
    }
    this.holdFloor(entry, tick, this.color.copy(RED).multiplyScalar(0.5))
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const part of Object.values(this.parts)) part.mesh.dispose()
    for (const geometry of this.geometries) geometry.dispose()
    this.materials.dispose()
  }
}
