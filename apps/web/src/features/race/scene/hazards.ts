import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { createHazardMaterials, droneGeometry, podGeometry, rotorGeometry, streakGeometry, type HazardMaterials } from './hazard-parts'
import { createRouteFrame, fromQ, type Route } from './route'

/**
 * Hazards drawn from the simulation's own rules. Movers read `hazardLateral`,
 * doors `doorOpenSide`, trains `trainBlockedSide`; floor lights switch on the
 * exact tick the collision rule switches, and every moving body finishes
 * closing before its side becomes dangerous.
 */

const RED = new THREE.Color(4, 0.22, 0.28)
const RED_DIM = new THREE.Color(0.9, 0.05, 0.07)
const GOLD_OPEN = new THREE.Color(2.2, 1.15, 0.2)
const WHITE = new THREE.Color(1, 1, 1)
const POD_BODY = new THREE.Color(0.55, 0.57, 0.62)
const ROTOR_BLUR = new THREE.Color(0.1, 0.105, 0.12)
const GUST_FLOOR = new THREE.Color(0.2, 0.17, 0.13)
const POD_WINDOW = new THREE.Color(1.5, 1.45, 1.3)
const OFF = new THREE.Color(0, 0, 0)
/** Instances stay collapsed until their hazard first comes into view. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
const DOOR_LEAD_TICKS = 6
const TRAIN_MOVE_TICKS = 6
const VIEW_BEHIND = 30
/** Warning glyphs: height above the deck per kind, and the window ahead of the courier where they show. */
const WARNING_HEIGHT: Readonly<Record<relayLeg.HazardKind, number>> = { barrier: 1.75, beam: 2.4, sweeper: 1.75, drone: 2.5, door: 3.8, train: 5.8, gust: 2.3 }
const WARNING_NEAR = 16
const WARNING_FAR = 200
/** World size per metre of camera distance, so the glyph keeps a steady small size on screen. */
const WARNING_SCALE = 0.048

type PartName = 'stripe' | 'plain' | 'light' | 'beacon' | 'drone' | 'rotor' | 'pod' | 'floor' | 'gust' | 'curtain' | 'warning'
const PART_NAMES: readonly PartName[] = ['stripe', 'plain', 'light', 'beacon', 'drone', 'rotor', 'pod', 'floor', 'gust', 'curtain', 'warning']

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
  barrier: { stripe: 1, light: 1, beacon: 2, warning: 1 },
  beam: { stripe: 1, plain: 2, light: 1, beacon: 2, warning: 1 },
  sweeper: { stripe: 1, plain: 1, light: 2, beacon: 1, warning: 1 },
  drone: { drone: 1, rotor: 4, light: 1, beacon: 1, warning: 1 },
  door: { plain: 4, curtain: 2, light: 3, floor: 2, warning: 1 },
  train: { plain: 5, pod: 1, light: 3, floor: 2, warning: 1 },
  gust: { gust: 14, floor: 2, warning: 1 },
}

export class HazardField {
  readonly group = new THREE.Group()
  private readonly materials: HazardMaterials
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly parts: Record<PartName, Part>
  private readonly entries: HazardSlots[]
  private readonly transform = new THREE.Object3D()
  private readonly frame = createRouteFrame()
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
    const totals: Record<PartName, number> = { stripe: 0, plain: 0, light: 0, beacon: 0, drone: 0, rotor: 0, pod: 0, floor: 0, gust: 0, curtain: 0, warning: 0 }
    for (const hazard of hazards) {
      for (const name of PART_NAMES) totals[name] += PART_BUDGET[hazard.kind][name] ?? 0
    }
    const box = this.keep(new THREE.BoxGeometry(1, 1, 1))
    const beacon = this.keep(new THREE.OctahedronGeometry(0.5, 0))
    const floor = this.keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
    const make = (name: PartName, geometry: THREE.BufferGeometry, material: THREE.Material): Part => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, totals[name]))
      mesh.count = totals[name]
      mesh.visible = totals[name] > 0
      mesh.frustumCulled = false
      mesh.name = `hazard-${name}`
      const emissive = material === this.materials.light || material === this.materials.additive || material === this.materials.gust || material === this.materials.curtain || material === this.materials.floor || material === this.materials.warning
      for (let i = 0; i < Math.max(1, mesh.count); i++) {
        mesh.setColorAt(i, emissive ? OFF : WHITE)
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
      pod: make('pod', this.keep(podGeometry()), this.materials.plain),
      floor: make('floor', floor, this.materials.floor),
      gust: make('gust', this.keep(streakGeometry()), this.materials.gust),
      curtain: make('curtain', this.keep(streakGeometry()), this.materials.curtain),
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
    const centre = this.route.pathOffset(hazard.path, d)
    const halfWidth = fromQ(relayLeg.halfWidthAt(this.route.track, hazard.dist, hazard.path))
    const x = centre + fromQ(hazard.x)
    const half = fromQ(hazard.half)
    switch (hazard.kind) {
      case 'barrier': {
        this.put('stripe', slots.stripe![0]!, d, x, 0.42, half * 2, 0.84, 0.36)
        this.put('light', slots.light![0]!, d - 0.19, x, 0.8, half * 2 - 0.08, 0.05, 0.03)
        this.tint('light', slots.light![0]!, RED)
        slots.beacon!.forEach((slot, i) => {
          this.put('beacon', slot, d, x + (i === 0 ? -half : half), 0.98, 0.14, 0.2, 0.14)
          this.tint('beacon', slot, RED)
        })
        return
      }
      case 'beam': {
        this.put('stripe', slots.stripe![0]!, d, centre, 1.38, halfWidth * 2 + 0.7, 0.34, 0.32)
        this.put('light', slots.light![0]!, d - 0.17, centre, 1.2, halfWidth * 2 + 0.5, 0.045, 0.03)
        this.tint('light', slots.light![0]!, RED)
        slots.plain!.forEach((slot, i) => this.put('plain', slot, d, centre + (i === 0 ? -1 : 1) * (halfWidth + 0.45), 0.8, 0.2, 1.6, 0.24))
        slots.beacon!.forEach((slot, i) => {
          this.put('beacon', slot, d, centre + (i === 0 ? -1 : 1) * (halfWidth + 0.45), 1.72, 0.16, 0.22, 0.16)
          this.tint('beacon', slot, RED)
        })
        return
      }
      case 'sweeper':
        this.put('plain', slots.plain![0]!, d, centre, 0.03, halfWidth * 2, 0.06, 0.3)
        return
      case 'drone':
        this.tint('light', slots.light![0]!, RED)
        this.tint('beacon', slots.beacon![0]!, RED)
        for (const slot of slots.rotor!) this.tint('rotor', slot, ROTOR_BLUR)
        return
      case 'door': {
        const [left, right, top, divider] = slots.plain!
        this.put('plain', left!, d, centre - halfWidth - 0.24, 1.55, 0.22, 3.1, 0.3)
        this.put('plain', right!, d, centre + halfWidth + 0.24, 1.55, 0.22, 3.1, 0.3)
        this.put('plain', top!, d, centre, 3.02, halfWidth * 2 + 0.7, 0.34, 0.36)
        this.put('plain', divider!, d, x, 1.45, half * 2, 2.9, 0.26)
        this.put('light', slots.light![2]!, d - 0.14, x, 1.45, 0.05, 2.7, 0.02)
        this.tint('light', slots.light![2]!, RED)
        return
      }
      case 'train': {
        const [left, right, top, rail] = slots.plain!
        this.put('plain', left!, d, centre - halfWidth - 0.5, 2.4, 0.42, 4.8, 0.42)
        this.put('plain', right!, d, centre + halfWidth + 0.5, 2.4, 0.42, 4.8, 0.42)
        this.put('plain', top!, d, centre, 4.9, halfWidth * 2 + 1.6, 0.36, 0.7)
        this.put('plain', rail!, d, centre, 4.6, halfWidth * 2 + 1.2, 0.14, 0.3)
        return
      }
      case 'gust': {
        const length = fromQ(hazard.length)
        const push = Math.sign(hazard.amplitude) || 1
        slots.gust!.forEach((slot, i) => {
          const along = d + ((i + 0.5) / slots.gust!.length) * length
          const height = 0.35 + ((i * 7) % 5) * 0.32
          this.put('gust', slot, along, centre + ((i * 13) % 7 - 3) * halfWidth * 0.2, height, halfWidth * 1.6, 0.2, 1)
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

  /** Updates moving and timed hazards near the courier. `tick` and `alpha` match the courier's interpolation. */
  update(dist: number, drawDistance: number, tick: number, alpha: number, time: number, camera: THREE.Vector3): void {
    this.materials.update(time)
    const blink = Math.sin(time * 9) > 0 ? 1 : 0.35
    let warnings = 0
    for (const entry of this.entries) {
      if (entry.d < dist - VIEW_BEHIND || entry.d > dist + drawDistance) continue
      if (this.updateWarning(entry, dist, Math.min(WARNING_FAR, drawDistance), tick, alpha, camera)) warnings++
      switch (entry.hazard.kind) {
        case 'sweeper':
          this.updateSweeper(entry, tick, alpha, blink)
          break
        case 'drone':
          this.updateDrone(entry, tick, alpha, time)
          break
        case 'door':
          this.updateDoor(entry, tick, alpha)
          break
        case 'train':
          this.updateTrain(entry, tick, alpha)
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
    const lateral = this.route.pathOffset(hazard.path, d) + (moving ? this.lateralAt(hazard, tick, alpha) : hazard.kind === 'barrier' ? fromQ(hazard.x) : 0)
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

  private lateralAt(hazard: relayLeg.Hazard, tick: number, alpha: number): number {
    const previous = relayLeg.hazardLateral(hazard, Math.max(0, tick - 1))
    const current = relayLeg.hazardLateral(hazard, tick)
    return fromQ(previous + (current - previous) * alpha)
  }

  private updateSweeper(entry: HazardSlots, tick: number, alpha: number, blink: number): void {
    const { hazard, d, slots } = entry
    const x = this.route.pathOffset(hazard.path, d) + this.lateralAt(hazard, tick, alpha)
    const half = fromQ(hazard.half)
    this.put('stripe', slots.stripe![0]!, d, x, 0.45, half * 2, 0.78, 0.55)
    this.put('light', slots.light![0]!, d - 0.29, x, 0.82, half * 2 - 0.06, 0.05, 0.03)
    this.put('light', slots.light![1]!, d, x, 0.07, half * 2 + 0.12, 0.06, 0.62)
    this.tint('light', slots.light![0]!, RED)
    this.tint('light', slots.light![1]!, RED_DIM)
    this.put('beacon', slots.beacon![0]!, d, x, 0.98, 0.16, 0.22, 0.16)
    this.tint('beacon', slots.beacon![0]!, this.color.copy(RED).multiplyScalar(blink))
  }

  private updateDrone(entry: HazardSlots, tick: number, alpha: number, time: number): void {
    const { hazard, d, slots } = entry
    const x = this.route.pathOffset(hazard.path, d) + this.lateralAt(hazard, tick, alpha)
    const hover = Math.sin(time * 3 + d) * 0.05
    const bank = (this.lateralAt(hazard, tick + 1, alpha) - this.lateralAt(hazard, tick, alpha)) * 3
    this.put('drone', slots.drone![0]!, d, x, 1.42 + hover, 1, 1, 1, bank)
    this.put('light', slots.light![0]!, d, x, 1.14 + hover, fromQ(hazard.half) * 2 - 0.1, 0.05, 0.12)
    this.put('beacon', slots.beacon![0]!, d - 0.45, x, 1.25 + hover, 0.2, 0.2, 0.2)
    slots.rotor!.forEach((slot, i) => {
      const corner = i < 2 ? -1 : 1
      const along = i % 2 === 0 ? -0.62 : 0.62
      this.put('rotor', slot, d + along, x + corner * 0.9, 1.5 + hover, 1, 1, 1, time * 40 + i)
    })
  }

  /** 0 = closed (blocking), 1 = fully raised. Closing completes on the switch tick; opening starts after it. */
  private doorRaise(hazard: relayLeg.Hazard, side: -1 | 1, tick: number, alpha: number): number {
    const openNow = relayLeg.doorOpenSide(hazard, tick) === side
    if (!openNow) return 0
    for (let k = 1; k <= DOOR_LEAD_TICKS; k++) {
      if (relayLeg.doorOpenSide(hazard, tick + k) !== side) return Math.max(0, (k - 1 - alpha) / DOOR_LEAD_TICKS)
    }
    for (let k = 0; k < DOOR_LEAD_TICKS; k++) {
      if (relayLeg.doorOpenSide(hazard, tick - k - 1) !== side) return Math.min(1, (k + alpha) / DOOR_LEAD_TICKS)
    }
    return 1
  }

  private updateDoor(entry: HazardSlots, tick: number, alpha: number): void {
    const { hazard, d, slots } = entry
    const centre = this.route.pathOffset(hazard.path, d)
    const halfWidth = fromQ(relayLeg.halfWidthAt(this.route.track, hazard.dist, hazard.path))
    const post = fromQ(hazard.half)
    const x = centre + fromQ(hazard.x)
    const open = relayLeg.doorOpenSide(hazard, tick)
    for (const side of [-1, 1] as const) {
      const index = side === -1 ? 0 : 1
      const width = side === -1 ? x - post - (centre - halfWidth) : centre + halfWidth - (x + post)
      const middle = side === -1 ? centre - halfWidth + width / 2 : x + post + width / 2
      const raise = this.doorRaise(hazard, side, tick, alpha)
      const eased = raise * raise * (3 - 2 * raise)
      const height = Math.max(0.001, 2.75 * (1 - eased))
      this.put('curtain', slots.curtain![index]!, d, middle, 2.85 - height / 2, width, height, 1)
      this.tint('curtain', slots.curtain![index]!, RED)
      this.put('light', slots.light![index]!, d - 0.2, middle, 2.82, width, 0.05, 0.03)
      this.tint('light', slots.light![index]!, raise > 0.5 ? GOLD_OPEN : RED)
      this.put('floor', slots.floor![index]!, d - 3.4, middle, 0.03, width - 0.25, 1, 5.5)
      this.tint('floor', slots.floor![index]!, open === side ? this.color.copy(GOLD_OPEN).multiplyScalar(0.6) : this.color.copy(RED).multiplyScalar(0.5))
    }
  }

  private updateTrain(entry: HazardSlots, tick: number, alpha: number): void {
    const { hazard, d, slots } = entry
    const centre = this.route.pathOffset(hazard.path, d)
    const halfWidth = fromQ(relayLeg.halfWidthAt(this.route.track, hazard.dist, hazard.path))
    const divider = fromQ(hazard.x)
    const blocked = relayLeg.trainBlockedSide(hazard, tick)
    let travel: number = blocked
    for (let k = 1; k <= TRAIN_MOVE_TICKS; k++) {
      if (relayLeg.trainBlockedSide(hazard, tick + k) !== blocked) {
        const progress = (TRAIN_MOVE_TICKS - k + alpha) / (TRAIN_MOVE_TICKS * 2)
        travel = blocked - 2 * blocked * progress * progress * (3 - 2 * progress)
        break
      }
    }
    for (let k = 0; k < TRAIN_MOVE_TICKS; k++) {
      if (relayLeg.trainBlockedSide(hazard, tick - k - 1) !== blocked) {
        const progress = (TRAIN_MOVE_TICKS + k + alpha) / (TRAIN_MOVE_TICKS * 2)
        travel = -blocked + 2 * blocked * progress * progress * (3 - 2 * progress)
        break
      }
    }
    const blend = (travel + 1) / 2
    const leftCentre = (divider - halfWidth) / 2
    const rightCentre = (divider + halfWidth) / 2
    const podX = centre + leftCentre + (rightCentre - leftCentre) * blend
    const podWidth = (halfWidth + divider) + (halfWidth - divider - (halfWidth + divider)) * blend
    const bodyWidth = Math.max(1, podWidth * 0.92)
    this.put('pod', slots.pod![0]!, d, podX, 1.2, bodyWidth, 2.2, 1.05)
    this.tint('pod', slots.pod![0]!, POD_BODY)
    this.put('plain', slots.plain![4]!, d, podX, 3.45, 0.26, 2.3, 0.26)
    this.put('light', slots.light![0]!, d - 2.12, podX, 0.35, bodyWidth * 0.82, 0.08, 0.04)
    this.tint('light', slots.light![0]!, RED)
    this.put('light', slots.light![1]!, d - 2.24, podX, 1.5, bodyWidth * 0.62, 0.28, 0.02)
    this.tint('light', slots.light![1]!, POD_WINDOW)
    this.put('light', slots.light![2]!, d, podX, 2.33, bodyWidth * 0.45, 0.04, 3.2)
    this.tint('light', slots.light![2]!, RED_DIM)
    for (const side of [-1, 1] as const) {
      const index = side === -1 ? 0 : 1
      const width = side === -1 ? halfWidth + divider : halfWidth - divider
      const middle = centre + (side === -1 ? leftCentre : rightCentre)
      this.put('floor', slots.floor![index]!, d - 4.2, middle, 0.03, Math.max(0.2, width - 0.25), 1, 6)
      this.tint('floor', slots.floor![index]!, blocked === side ? this.color.copy(RED).multiplyScalar(0.5) : this.color.copy(GOLD_OPEN).multiplyScalar(0.6))
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const part of Object.values(this.parts)) part.mesh.dispose()
    for (const geometry of this.geometries) geometry.dispose()
    this.materials.dispose()
  }
}
