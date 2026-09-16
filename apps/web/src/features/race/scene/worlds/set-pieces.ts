import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { MeshBuilder } from '../mesh-builder'
import { fromQ, type Route } from '../route'
import { pathIntervals } from '../track-spans'
import { createWindowMaterial, instancedField, mountainGeometry, seededRandom, towerGeometry, type Placement } from './common'
import type { WorldFrame, WorldStyle } from './types'

/**
 * Authored set pieces keyed by the engine's SetPieceKind. Each is built once
 * at mount from route geometry, so it frames the exact stretch of track the
 * simulation marks, and animates cheaply while the courier is near it.
 */

export interface SetPiece {
  group: THREE.Group
  update(frame: WorldFrame): void
  dispose(): void
}

interface Context {
  route: Route
  piece: relayLeg.SetPiece
  floorY: number
  style: WorldStyle
}

type Builder = (context: Context) => SetPiece

const p = (): THREE.Vector3 => new THREE.Vector3()

function finishMeshes(group: THREE.Group, builders: readonly [MeshBuilder, THREE.Material][], extra: readonly { dispose(): void }[] = []): () => void {
  const geometries: THREE.BufferGeometry[] = []
  for (const [builder, material] of builders) {
    if (builder.vertexCount === 0) continue
    const geometry = builder.build()
    geometries.push(geometry)
    group.add(new THREE.Mesh(geometry, material))
  }
  return () => {
    group.removeFromParent()
    for (const geometry of geometries) geometry.dispose()
    for (const item of extra) item.dispose()
    for (const [, material] of builders) material.dispose()
  }
}

/** Lateral extent of every path at `d`, ignoring gap holes so a full-width gap never collapses a set piece around the other path. */
function union(route: Route, d: number): { left: number; right: number } {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (const interval of pathIntervals(route, d)) {
    left = Math.min(left, interval.left)
    right = Math.max(right, interval.right)
  }
  return Number.isFinite(left) ? { left, right } : { left: -route.halfWidth('main', d), right: route.halfWidth('main', d) }
}

/** Box between two route-space points (d, lateral, height) with a given cross-section. */
function beam(builder: MeshBuilder, route: Route, a: readonly [number, number, number], b: readonly [number, number, number], width: number, color: THREE.Color): void {
  const start = route.point(a[0], a[1], a[2], p())
  const end = route.point(b[0], b[1], b[2], p())
  const axis = new THREE.Vector3().subVectors(end, start)
  const length = axis.length()
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize())
  matrix.compose(start.clone().lerp(end, 0.5), quaternion, new THREE.Vector3(width, length, width))
  const box = new THREE.BoxGeometry(1, 1, 1)
  builder.append(box, matrix, color)
  box.dispose()
}

const suspensionBridge: Builder = ({ route, piece, floorY }) => {
  const group = new THREE.Group()
  const structure = new MeshBuilder()
  const glow = new MeshBuilder()
  const concrete = new THREE.Color('#3b3e48')
  const cableLight = new THREE.Color(2.4, 1.9, 1.3)
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const towers = [d0 + 14, d0 + length - 14]
  const deckHeight = (d: number): number => route.point(d, 0, 0, p()).y
  const top = 36
  for (const d of towers) {
    const half = route.halfWidth('main', d) + 2.6
    for (const side of [-1, 1] as const) {
      beam(structure, route, [d, side * half, floorY - deckHeight(d)], [d, side * (half - 1.2), top], 2.2, concrete)
      beam(glow, route, [d - 1.15, side * (half - 0.9), 2], [d - 1.15, side * (half - 1.4), top - 2], 0.14, cableLight)
    }
    beam(structure, route, [d, -half + 1, top - 3], [d, half - 1, top - 3], 2.4, concrete)
    beam(structure, route, [d, -half + 0.6, -3], [d, half - 0.6, -3], 1.6, concrete)
  }
  for (const side of [-1, 1] as const) {
    const lateral = side * (route.halfWidth('main', d0 + length / 2) + 1.8)
    const segments = 26
    let previous: [number, number, number] | null = null
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const d = towers[0]! + (towers[1]! - towers[0]!) * t
      const sag = 4 + (top - 6) * Math.pow(2 * t - 1, 2)
      const point: [number, number, number] = [d, lateral, sag]
      if (previous) beam(glow, route, previous, point, 0.16, cableLight)
      if (i > 0 && i < segments && i % 2 === 0) beam(glow, route, [d, lateral, 0.3], [d, lateral, sag], 0.05, cableLight.clone().multiplyScalar(0.45))
      previous = point
    }
  }
  const dispose = finishMeshes(group, [
    [structure, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 })],
    [glow, new THREE.MeshBasicMaterial({ vertexColors: true })],
  ])
  return { group, update: () => undefined, dispose }
}

const transitCrossing: Builder = ({ route, piece }) => {
  const group = new THREE.Group()
  const structure = new MeshBuilder()
  const glow = new MeshBuilder()
  const steel = new THREE.Color('#262a33')
  const railLight = new THREE.Color(1.6, 1.2, 0.7)
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const crossings = [
    { d: d0 + length * 0.3, height: 8.5, angle: 0.45 },
    { d: d0 + length * 0.72, height: 12, angle: -0.35 },
  ]
  for (const crossing of crossings) {
    const reach = 120
    const along = Math.tan(crossing.angle) * reach
    beam(structure, route, [crossing.d - along, -reach, crossing.height], [crossing.d + along, reach, crossing.height], 3.2, steel)
    beam(glow, route, [crossing.d - along, -reach, crossing.height - 1.7], [crossing.d + along, reach, crossing.height - 1.7], 0.18, railLight)
    for (const side of [-1, 1] as const) {
      const lateral = side * 14
      const d = crossing.d + Math.tan(crossing.angle) * lateral
      beam(structure, route, [d, lateral, -40], [d, lateral, crossing.height], 1.6, steel)
    }
  }
  const box = towerGeometry()
  const carMaterial = createWindowMaterial({ base: '#1d2029', windowA: '#ffe2b5', windowB: '#fff1d8', lit: 0.95, floorHeight: 1.6, windowWidth: 1.4, intensity: 2.4 })
  const cars = new THREE.InstancedMesh(box, carMaterial, crossings.length * 4)
  cars.frustumCulled = false
  group.add(cars)
  const transform = new THREE.Object3D()
  const dispose = finishMeshes(
    group,
    [
      [structure, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5 })],
      [glow, new THREE.MeshBasicMaterial({ vertexColors: true })],
    ],
    [box, carMaterial, cars],
  )
  return {
    group,
    update(frame) {
      let index = 0
      crossings.forEach((crossing, c) => {
        const cycle = (frame.time * 0.12 + c * 0.5) % 1
        const lateral = -110 + cycle * 220
        for (let k = 0; k < 4; k++) {
          const l = lateral - k * 17
          const d = crossing.d + Math.tan(crossing.angle) * l
          route.point(d, l, crossing.height + 0.2, transform.position)
          transform.rotation.set(0, -route.headingAt(d) + Math.PI / 2 - crossing.angle, 0)
          transform.scale.set(3, 3.3, 16)
          transform.updateMatrix()
          cars.setMatrixAt(index++, transform.matrix)
        }
      })
      cars.instanceMatrix.needsUpdate = true
    },
    dispose,
  }
}

/** Accent light per world for tunnels: sparse strips, never the gold or red that carry gameplay meaning. */
const TUNNEL_ACCENTS: Readonly<Partial<Record<relayLeg.World, readonly [THREE.Color, THREE.Color]>>> = {
  metro: [new THREE.Color(2.3, 0.3, 1.45), new THREE.Color(0.75, 0.7, 2.5)],
  alpine: [new THREE.Color(1.3, 1.5, 1.95), new THREE.Color(1.3, 1.5, 1.95)],
  ocean: [new THREE.Color(0.45, 0.85, 2.3), new THREE.Color(0.6, 0.7, 2.1)],
}

const tunnel: Builder = ({ route, piece, style }) => {
  const group = new THREE.Group()
  const structure = new MeshBuilder()
  const glow = new MeshBuilder()
  const wall = new THREE.Color('#0b0c11')
  const rib = new THREE.Color('#15171e')
  const lamp = new THREE.Color(1.05, 0.98, 0.9)
  const accents = TUNNEL_ACCENTS[style.id] ?? [style.track.edgeLight, style.track.edgeLight]
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const step = 9
  const height = 9
  const profile = (d: number): [number, number][] => {
    const { left, right } = union(route, d)
    const l = left - 3.5
    const r = right + 3.5
    return [[l, -7], [l, height * 0.6], [l + 3, height], [r - 3, height], [r, height * 0.6], [r, -7]]
  }
  let ribIndex = 0
  for (let d = d0; d < d0 + length; d += step, ribIndex++) {
    const a = profile(d)
    const b = profile(d + step)
    for (let i = 0; i + 1 < a.length; i++) {
      const [la0, ha0] = a[i]!
      const [la1, ha1] = a[i + 1]!
      const [lb0, hb0] = b[i]!
      const [lb1, hb1] = b[i + 1]!
      structure.quad(route.point(d, la1, ha1, p()), route.point(d, la0, ha0, p()), route.point(d + step, lb0, hb0, p()), route.point(d + step, lb1, hb1, p()), wall)
    }
    for (let i = 0; i + 1 < a.length; i++) {
      const [l0, h0] = a[i]!
      const [l1, h1] = a[i + 1]!
      beam(structure, route, [d, l0 * 0.97, h0], [d, l1 * 0.97, h1], 0.6, rib)
    }
    const [left] = a[0]!
    const [right] = a[a.length - 1]!
    if (ribIndex % 2 === 0) {
      const mid = (a[2]![0] + a[3]![0]) / 2
      glow.quad(route.point(d + 3, mid - 0.25, height - 0.05, p()), route.point(d + 5.2, mid - 0.25, height - 0.05, p()), route.point(d + 5.2, mid + 0.25, height - 0.05, p()), route.point(d + 3, mid + 0.25, height - 0.05, p()), lamp)
    }
    if (ribIndex % 3 === 1) {
      const accent = accents[ribIndex % 2]!
      for (const lateral of [left * 0.96, right * 0.96]) beam(glow, route, [d - 0.35, lateral, 0.6], [d - 0.35, lateral, 4.2], 0.07, accent)
    }
    if (style.id === 'metro' && ribIndex % 5 === 2) {
      const sign = accents[0]
      const side = ribIndex % 2 === 0 ? left * 0.955 : right * 0.955
      beam(glow, route, [d + 3.2, side, 3.15], [d + 5.8, side, 3.15], 0.09, sign)
      beam(glow, route, [d + 3.2, side, 2.45], [d + 5.8, side, 2.45], 0.05, sign.clone().multiplyScalar(0.55))
    }
  }
  const dispose = finishMeshes(group, [
    [structure, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.08, envMapIntensity: 0.2, side: THREE.DoubleSide })],
    [glow, new THREE.MeshBasicMaterial({ vertexColors: true })],
  ])
  return { group, update: () => undefined, dispose }
}

const cliffDrop: Builder = ({ route, piece, floorY }) => {
  const group = new THREE.Group()
  const random = seededRandom(piece.dist)
  const rock = mountainGeometry(random, 0.72, '#1d2533', '#d6e2f0')
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const placements: Placement[] = []
  for (let i = 0; i < 5; i++) {
    const d = d0 - 20 + i * (length + 40) / 4
    const side = i % 2 === 0 ? -1 : 1
    const position = route.flatPoint(d, side * (34 + random() * 18), p()).setY(floorY - 10)
    placements.push({ position, rotation: random() * Math.PI, scale: new THREE.Vector3(26 + random() * 16, 110 + random() * 40, 26 + random() * 16), random: random(), side, dist: d })
  }
  const mesh = instancedField(rock, material, placements)
  group.add(mesh)
  const glow = new MeshBuilder()
  const ice = new THREE.Color(0.9, 1.5, 2.2)
  for (let i = 0; i < 3; i++) {
    const d = d0 + length * (0.2 + i * 0.3)
    beam(glow, route, [d, -30 - i * 3, 40], [d + 3, -28 - i * 3, floorY - route.point(d, 0, 0, p()).y], 0.7 - i * 0.15, ice)
  }
  const dispose = finishMeshes(group, [[glow, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })]], [rock, material, mesh])
  return { group, update: () => undefined, dispose }
}

const turbineField: Builder = ({ route, piece, floorY }) => {
  const group = new THREE.Group()
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const towerGeometryShape = new THREE.CylinderGeometry(0.8, 1.6, 1, 10).translate(0, 0.5, 0)
  const bladeShape = new THREE.BoxGeometry(1.1, 26, 0.3).translate(0, 13, 0)
  const material = new THREE.MeshStandardMaterial({ color: '#e7ddd2', roughness: 0.5, metalness: 0.2 })
  const tipMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.25) })
  const tip = new THREE.OctahedronGeometry(0.8, 0)
  const turbines: Placement[] = []
  for (let d = d0; d < d0 + length; d += 32) {
    for (const side of [-1, 1] as const) {
      const lateral = side * 38
      const position = route.flatPoint(d + side * 8, lateral, p()).setY(floorY)
      const deck = route.point(d, 0, 0, p()).y
      turbines.push({ position, rotation: -route.headingAt(d), scale: new THREE.Vector3(1, deck - floorY + 22, 1), random: (d * 13) % 1, side, dist: d })
    }
  }
  const towers = instancedField(towerGeometryShape, material, turbines)
  const blades = new THREE.InstancedMesh(bladeShape, material, turbines.length * 3)
  const tips = new THREE.InstancedMesh(tip, tipMaterial, turbines.length)
  for (const mesh of [blades, tips]) mesh.frustumCulled = false
  group.add(towers, blades, tips)
  const transform = new THREE.Object3D()
  const hub = new THREE.Vector3()
  const facing = new THREE.Quaternion()
  const spin = new THREE.Quaternion()
  const axis = new THREE.Vector3(0, 0, 1)
  const up = new THREE.Vector3(0, 1, 0)
  return {
    group,
    update(frame) {
      turbines.forEach((turbine, index) => {
        hub.copy(turbine.position).setY(turbine.position.y + turbine.scale.y)
        facing.setFromAxisAngle(up, turbine.rotation)
        for (let b = 0; b < 3; b++) {
          spin.setFromAxisAngle(axis, frame.time * 0.9 + turbine.random * 6 + (b * Math.PI * 2) / 3)
          transform.position.copy(hub)
          transform.quaternion.copy(facing).multiply(spin)
          transform.scale.setScalar(1)
          transform.updateMatrix()
          blades.setMatrixAt(index * 3 + b, transform.matrix)
        }
        transform.position.copy(hub).setY(hub.y + 2)
        transform.quaternion.identity()
        transform.updateMatrix()
        tips.setMatrixAt(index, transform.matrix)
      })
      blades.instanceMatrix.needsUpdate = true
      tips.instanceMatrix.needsUpdate = true
      tipMaterial.color.setRGB(3 * (0.3 + 0.7 * Math.max(0, Math.sin(frame.time * 1.8))), 0.22, 0.22)
    },
    dispose() {
      group.removeFromParent()
      for (const mesh of [towers, blades, tips]) mesh.dispose()
      for (const item of [towerGeometryShape, bladeShape, tip, material, tipMaterial]) item.dispose()
    },
  }
}

const waveArch: Builder = ({ route, piece }) => {
  const group = new THREE.Group()
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const geometry = new THREE.TorusGeometry(19, 3.2, 10, 40, Math.PI)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPosition;
      void main() {
        float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
        float rim = pow(1.0 - facing, 2.0);
        float foam = smoothstep(0.82, 1.0, sin(vUv.x * 60.0 - uTime * 3.0 + vUv.y * 9.0) * 0.5 + 0.5);
        vec3 color = vec3(0.12, 0.55, 0.62) * (0.25 + rim * 1.4) + vec3(1.2, 1.4, 1.5) * foam * 0.35;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })
  const count = 5
  const arches = new THREE.InstancedMesh(geometry, material, count)
  arches.frustumCulled = false
  const transform = new THREE.Object3D()
  const frameQuaternion = new THREE.Quaternion()
  for (let i = 0; i < count; i++) {
    const d = d0 + (length * (i + 0.5)) / count
    route.point(d, 0, -6, transform.position)
    const heading = route.headingAt(d)
    frameQuaternion.setFromEuler(new THREE.Euler(0, -heading, 0))
    transform.quaternion.copy(frameQuaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (i - 2) * 0.12)))
    transform.scale.set(1 + i * 0.04, 1.05 - Math.abs(i - 2) * 0.06, 1)
    transform.updateMatrix()
    arches.setMatrixAt(i, transform.matrix)
  }
  group.add(arches)
  return {
    group,
    update(frame) {
      material.uniforms.uTime!.value = frame.time
    },
    dispose() {
      group.removeFromParent()
      arches.dispose()
      geometry.dispose()
      material.dispose()
    },
  }
}

const skylineJump: Builder = ({ route, piece, floorY, style }) => {
  const group = new THREE.Group()
  const random = seededRandom(piece.dist + 17)
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const warm = style.id === 'solar'
  const facade = createWindowMaterial({
    base: warm ? '#241a18' : '#1a1d27', windowA: warm ? '#ffc184' : '#ffd6a0', windowB: warm ? '#ffe0b8' : '#bcd0ff',
    lit: 0.34, floorHeight: 3.4, windowWidth: 2.6, intensity: 1.5, crown: 2.2, crownColor: '#ffc56e',
  })
  const box = towerGeometry()
  const towers: Placement[] = []
  for (let d = d0 - 10; d < d0 + length + 10; d += 17) {
    for (const side of [-1, 1] as const) {
      const { left, right } = union(route, d)
      const edge = side === -1 ? left : right
      const width = 10 + random() * 8
      const lateral = edge + side * (width / 2 + 5 + random() * 6)
      const position = route.flatPoint(d, lateral, p()).setY(floorY)
      const deck = route.point(d, 0, 0, p()).y
      towers.push({ position, rotation: -route.headingAt(d), scale: new THREE.Vector3(width, deck - floorY + (random() < 0.5 ? -3 : 6 + random() * 30), 12 + random() * 6), random: random(), side, dist: d })
    }
  }
  const mesh = instancedField(box, facade, towers)
  group.add(mesh)
  const signs = new MeshBuilder()
  const gold = new THREE.Color(3, 1.65, 0.35)
  towers.forEach((tower, index) => {
    if (index % 3 !== 0) return
    const top = tower.position.y + tower.scale.y
    const deck = route.point(tower.dist, 0, 0, p()).y
    const height = top - deck + 1
    const { left, right } = union(route, tower.dist)
    const lateral = (tower.side === -1 ? left : right) + tower.side * 4.6
    beam(signs, route, [tower.dist, lateral, height], [tower.dist, lateral, height + 2.2], 0.12, gold)
    beam(signs, route, [tower.dist, lateral, height + 2.2], [tower.dist, lateral - tower.side * 3.5, height + 2.2], 0.12, gold)
  })
  const dispose = finishMeshes(group, [[signs, new THREE.MeshBasicMaterial({ vertexColors: true })]], [box, facade, mesh])
  return { group, update: () => undefined, dispose }
}

const BUILDERS: Partial<Record<relayLeg.SetPieceKind, Builder>> = {
  'suspension-bridge': suspensionBridge,
  'transit-crossing': transitCrossing,
  tunnel,
  'cliff-drop': cliffDrop,
  'turbine-field': turbineField,
  'wave-arch': waveArch,
  'skyline-jump': skylineJump,
}

export function buildSetPieces(route: Route, floorY: number, style: WorldStyle): SetPiece[] {
  return route.track.setPieces.flatMap(piece => {
    const builder = BUILDERS[piece.kind]
    return builder ? [builder({ route, piece, floorY, style })] : []
  })
}
