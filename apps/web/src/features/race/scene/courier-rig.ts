import * as THREE from 'three'

/**
 * Procedural courier: an adult athlete in a racing suit on a hoverboard, built
 * from rounded primitives and bound rigidly to a small skeleton. All body parts
 * of one material merge into one SkinnedMesh, so the whole courier and board
 * draw in four calls. Local frame: -Z is forward along the route, +Y up.
 */

export type BoneName =
  | 'root' | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'handL' | 'shoulderR' | 'elbowR' | 'handR'
  | 'thighL' | 'kneeL' | 'footL' | 'thighR' | 'kneeR' | 'footR'

interface BoneSpec {
  name: BoneName
  parent: BoneName | null
  offset: readonly [number, number, number]
}

export const HIP_HEIGHT = 0.95
export const THIGH_LENGTH = 0.45
export const SHIN_LENGTH = 0.44
const UPPER_ARM = 0.29
const FOREARM = 0.26

const BONES: readonly BoneSpec[] = [
  { name: 'root', parent: null, offset: [0, 0, 0] },
  { name: 'hips', parent: 'root', offset: [0, HIP_HEIGHT, 0] },
  { name: 'spine', parent: 'hips', offset: [0, 0.11, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.2, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.22, 0] },
  { name: 'head', parent: 'neck', offset: [0, 0.08, 0] },
  { name: 'shoulderL', parent: 'chest', offset: [-0.2, 0.15, 0] },
  { name: 'elbowL', parent: 'shoulderL', offset: [0, -UPPER_ARM, 0] },
  { name: 'handL', parent: 'elbowL', offset: [0, -FOREARM, 0] },
  { name: 'shoulderR', parent: 'chest', offset: [0.2, 0.15, 0] },
  { name: 'elbowR', parent: 'shoulderR', offset: [0, -UPPER_ARM, 0] },
  { name: 'handR', parent: 'elbowR', offset: [0, -FOREARM, 0] },
  { name: 'thighL', parent: 'hips', offset: [-0.1, -0.04, 0] },
  { name: 'kneeL', parent: 'thighL', offset: [0, -THIGH_LENGTH, 0] },
  { name: 'footL', parent: 'kneeL', offset: [0, -SHIN_LENGTH, 0] },
  { name: 'thighR', parent: 'hips', offset: [0.1, -0.04, 0] },
  { name: 'kneeR', parent: 'thighR', offset: [0, -THIGH_LENGTH, 0] },
  { name: 'footR', parent: 'kneeR', offset: [0, -SHIN_LENGTH, 0] },
]

export type CourierSlot = 'suit' | 'armor' | 'visor' | 'glow'

export interface CourierPalette {
  suit: THREE.Color
  suitPanel: THREE.Color
  armor: THREE.Color
  armorTrim: THREE.Color
  board: THREE.Color
  boardTrim: THREE.Color
  light: THREE.Color
  visorLight: THREE.Color
}

export interface CourierRig {
  root: THREE.Bone
  bones: Record<BoneName, THREE.Bone>
  skeleton: THREE.Skeleton
  geometries: Record<CourierSlot, THREE.BufferGeometry>
}

class PartCollector {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly colors: number[] = []
  readonly skinIndex: number[] = []

  add(geometry: THREE.BufferGeometry, bindMatrix: THREE.Matrix4, boneIndex: number, color: THREE.Color): void {
    const source = geometry.index ? geometry.toNonIndexed() : geometry
    source.computeVertexNormals()
    const position = source.getAttribute('position')
    const normal = source.getAttribute('normal')
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(bindMatrix)
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(bindMatrix)
      n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize()
      this.positions.push(p.x, p.y, p.z)
      this.normals.push(n.x, n.y, n.z)
      this.colors.push(color.r, color.g, color.b)
      this.skinIndex.push(boneIndex, 0, 0, 0)
    }
    if (source !== geometry) source.dispose()
    geometry.dispose()
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const count = this.positions.length / 3
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4))
    const weights = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) weights[i * 4] = 1
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
    geometry.computeBoundingSphere()
    return geometry
  }
}

/** Capsule-like limb segment running from the bone origin down its local -Y. */
function limb(length: number, radiusTop: number, radiusBottom: number, radial = 10): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radial, 3)
  body.translate(0, -length / 2, 0)
  return body
}

function sphere(radius: number, scale: readonly [number, number, number], at: readonly [number, number, number], detail = 12): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, detail, Math.max(6, Math.round(detail * 0.7)))
  geometry.scale(scale[0], scale[1], scale[2])
  geometry.translate(at[0], at[1], at[2])
  return geometry
}

function box(size: readonly [number, number, number], at: readonly [number, number, number], radius = 0.02): THREE.BufferGeometry {
  const geometry = roundedBox(size[0], size[1], size[2], radius)
  geometry.translate(at[0], at[1], at[2])
  return geometry
}

/** A box with bevelled edges built from an extruded rounded rectangle (cheap, reads soft under rim light). */
function roundedBox(width: number, height: number, depth: number, radius: number): THREE.BufferGeometry {
  const r = Math.min(radius, width / 2 - 0.001, height / 2 - 0.001)
  const shape = new THREE.Shape()
  const x = -width / 2
  const y = -height / 2
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  const bevel = Math.min(r, depth / 2 - 0.001)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0.002,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 3,
  })
  geometry.translate(0, 0, -(depth - bevel * 2) / 2)
  return geometry
}

function transformed(geometry: THREE.BufferGeometry, rotation: readonly [number, number, number]): THREE.BufferGeometry {
  geometry.rotateX(rotation[0])
  geometry.rotateY(rotation[1])
  geometry.rotateZ(rotation[2])
  return geometry
}

export function buildCourierRig(palette: CourierPalette): CourierRig {
  const bones = {} as Record<BoneName, THREE.Bone>
  const ordered: THREE.Bone[] = []
  for (const spec of BONES) {
    const bone = new THREE.Bone()
    bone.name = spec.name
    bone.position.set(...spec.offset)
    bones[spec.name] = bone
    ordered.push(bone)
    if (spec.parent) bones[spec.parent].add(bone)
  }
  const root = bones.root
  root.updateMatrixWorld(true)

  const collectors: Record<CourierSlot, PartCollector> = {
    suit: new PartCollector(),
    armor: new PartCollector(),
    visor: new PartCollector(),
    glow: new PartCollector(),
  }
  const indexOf = (name: BoneName): number => ordered.indexOf(bones[name])
  const put = (slot: CourierSlot, name: BoneName, geometry: THREE.BufferGeometry, color: THREE.Color): void => {
    collectors[slot].add(geometry, bones[name].matrixWorld, indexOf(name), color)
  }

  buildTorso(put, palette)
  buildHead(put, palette)
  for (const side of [-1, 1] as const) {
    buildArm(put, palette, side)
    buildLeg(put, palette, side)
  }
  buildBoard(put, palette)

  const skeleton = new THREE.Skeleton(ordered)
  return {
    root,
    bones,
    skeleton,
    geometries: {
      suit: collectors.suit.build(),
      armor: collectors.armor.build(),
      visor: collectors.visor.build(),
      glow: collectors.glow.build(),
    },
  }
}

type Put = (slot: CourierSlot, bone: BoneName, geometry: THREE.BufferGeometry, color: THREE.Color) => void

function buildTorso(put: Put, palette: CourierPalette): void {
  put('suit', 'hips', sphere(0.15, [1.05, 0.72, 0.8], [0, 0.0, 0.0]), palette.suit)
  put('armor', 'hips', box([0.3, 0.07, 0.2], [0, 0.07, 0], 0.03), palette.armorTrim)
  put('suit', 'spine', limb(0.22, 0.135, 0.125), palette.suit)
  put('suit', 'spine', transformed(limb(0.22, 0.135, 0.125), [Math.PI, 0, 0]).translate(0, 0.0, 0), palette.suit)
  put('suit', 'chest', sphere(0.2, [1.0, 0.95, 0.72], [0, 0.1, 0.0]), palette.suit)
  put('armor', 'chest', sphere(0.19, [0.98, 0.72, 0.5], [0, 0.13, -0.05]), palette.armor)
  put('suit', 'chest', box([0.26, 0.28, 0.1], [0, 0.1, 0.12], 0.04), palette.suitPanel)
  put('glow', 'chest', box([0.028, 0.24, 0.02], [0, 0.1, 0.176], 0.008), palette.light)
  put('armor', 'chest', box([0.18, 0.1, 0.06], [0, 0.23, 0.15], 0.025), palette.armorTrim)
  put('suit', 'neck', limb(0.1, 0.055, 0.065, 8).translate(0, 0.08, 0), palette.suitPanel)
}

function buildHead(put: Put, palette: CourierPalette): void {
  put('armor', 'head', sphere(0.135, [0.94, 1.02, 1.08], [0, 0.12, 0.012], 16), palette.armor)
  put('armor', 'head', box([0.035, 0.05, 0.2], [0, 0.245, 0.03], 0.012), palette.armorTrim)
  put('visor', 'head', sphere(0.118, [1.02, 0.52, 0.78], [0, 0.115, -0.07], 16), palette.armorTrim)
  put('glow', 'head', box([0.2, 0.012, 0.012], [0, 0.083, -0.155], 0.004), palette.visorLight)
  for (const side of [-1, 1] as const) {
    put('armor', 'head', sphere(0.045, [0.5, 1, 1], [side * 0.125, 0.11, 0.01], 10), palette.armorTrim)
  }
}

function buildArm(put: Put, palette: CourierPalette, side: -1 | 1): void {
  const shoulder = side === -1 ? 'shoulderL' : 'shoulderR'
  const elbow = side === -1 ? 'elbowL' : 'elbowR'
  const hand = side === -1 ? 'handL' : 'handR'
  put('armor', shoulder, sphere(0.078, [1.05, 0.95, 1.05], [side * 0.012, 0.0, 0]), palette.armor)
  put('suit', shoulder, limb(UPPER_ARM, 0.058, 0.048), palette.suit)
  put('suit', elbow, limb(FOREARM, 0.047, 0.037), palette.suit)
  put('armor', elbow, box([0.085, 0.14, 0.085], [0, -0.16, 0], 0.03), palette.armor)
  put('glow', elbow, box([0.012, 0.1, 0.012], [side * 0.045, -0.16, 0], 0.004), palette.light)
  put('armor', hand, box([0.075, 0.1, 0.05], [0, -0.04, 0], 0.022), palette.armorTrim)
}

function buildLeg(put: Put, palette: CourierPalette, side: -1 | 1): void {
  const thigh = side === -1 ? 'thighL' : 'thighR'
  const knee = side === -1 ? 'kneeL' : 'kneeR'
  const foot = side === -1 ? 'footL' : 'footR'
  put('suit', thigh, limb(THIGH_LENGTH, 0.085, 0.062), palette.suit)
  put('suit', thigh, box([0.05, 0.28, 0.04], [side * 0.075, -0.2, 0], 0.018), palette.suitPanel)
  put('glow', thigh, box([0.01, 0.22, 0.012], [side * 0.098, -0.2, 0], 0.004), palette.light)
  put('suit', knee, limb(SHIN_LENGTH, 0.06, 0.045), palette.suit)
  put('armor', knee, sphere(0.062, [0.95, 1.1, 0.8], [0, -0.01, -0.035]), palette.armor)
  put('armor', knee, box([0.1, 0.2, 0.1], [0, -0.3, 0], 0.035), palette.armor)
  put('armor', foot, box([0.11, 0.08, 0.27], [0, 0.0, -0.05], 0.035), palette.armorTrim)
  put('suit', foot, box([0.1, 0.03, 0.26], [0, -0.045, -0.05], 0.012), palette.suit)
}

function buildBoard(put: Put, palette: CourierPalette): void {
  const deck = roundedBox(0.44, 1.42, 0.07, 0.2)
  deck.rotateX(-Math.PI / 2)
  deck.translate(0, 0.0, 0)
  put('armor', 'root', deck, palette.board)
  const rail = roundedBox(0.46, 1.44, 0.03, 0.2)
  rail.rotateX(-Math.PI / 2)
  rail.translate(0, 0.045, 0)
  put('suit', 'root', rail, palette.boardTrim)
  for (const z of [-0.5, 0.5]) {
    put('glow', 'root', sphere(0.085, [1.3, 0.25, 1.3], [0, -0.05, z], 12), palette.light)
    put('suit', 'root', sphere(0.11, [1.25, 0.4, 1.25], [0, -0.035, z], 12), palette.boardTrim)
  }
  put('glow', 'root', box([0.36, 0.012, 1.1], [0, 0.04, 0], 0.004), palette.light)
  put('glow', 'root', box([0.02, 0.02, 1.2], [-0.225, 0.0, 0], 0.006), palette.light)
  put('glow', 'root', box([0.02, 0.02, 1.2], [0.225, 0.0, 0], 0.006), palette.light)
  for (const side of [-1, 1] as const) {
    put('armor', 'root', box([0.012, 0.09, 0.2], [side * 0.14, -0.07, 0.6], 0.004), palette.boardTrim)
  }
}
