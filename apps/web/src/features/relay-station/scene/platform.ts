import * as THREE from 'three'
import type { StationSurfaceId } from '../view-model'
import type { StationKit } from './kit'
import { DECK, PLACEMENT, TERRACE } from './layout'
import { COLOR } from './palette'
import { HASH, createGlassMaterial } from './shaders'

export interface Platform {
  readonly object: THREE.Group
  /** Turns the live portal's floor pool cyan while a relay is live. */
  setLive(live: boolean): void
}

const POOLS = 8
const BEVEL = 0.16
const RAIL_HEIGHT = 1.08

/** The elevated deck: polished stone with pools of lamp light, a glass balustrade and a lit edge. */
export function createPlatform(kit: StationKit): Platform {
  const object = new THREE.Group()
  object.name = 'platform'
  const shape = deckShape()

  const slab = new THREE.ExtrudeGeometry(shape, { depth: DECK.thickness, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 2, curveSegments: 12 })
  slab.rotateX(Math.PI / 2).translate(0, -BEVEL, 0)
  kit.track(slab)

  const pools = Array.from({ length: POOLS }, () => new THREE.Vector4())
  const poolColors = Array.from({ length: POOLS }, () => COLOR.lamp.clone())
  const poolSpots: readonly [StationSurfaceId, number, number][] = [
    ['courier', 2.1, 0.12],
    ['chronicle', 2.0, 0.05],
    ['departures', 2.4, 0.08],
    ['vault', 2.2, 0.08],
    ['rankings', 1.8, 0.07],
    ['live', 2.0, 0.09],
    ['world', 3.4, 0.08],
  ]
  poolSpots.forEach(([id, radius, strength], index) => {
    const { position, yaw } = PLACEMENT[id]
    pools[index]?.set(position.x + Math.sin(yaw) * 0.9, position.z + Math.cos(yaw) * 0.9, radius, strength)
  })
  pools[POOLS - 1]?.set(0, DECK.front - 1, 5, 0.02)
  const livePool = poolColors[5]

  const floor = kit.track(new THREE.MeshStandardMaterial({ color: '#0d121c', roughness: 0.3, metalness: 0.45 }))
  floor.onBeforeCompile = shader => {
    shader.uniforms.uPools = { value: pools }
    shader.uniforms.uPoolColors = { value: poolColors }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFloorWorld;\nuniform vec4 uPools[${POOLS}];\nuniform vec3 uPoolColors[${POOLS}];\n${HASH}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 tileCoord = vFloorWorld.xz / vec2(2.4, 1.6);
        vec2 tileEdge = abs(fract(tileCoord) - 0.5);
        float seam = smoothstep(0.482, 0.5, max(tileEdge.x, tileEdge.y));
        diffuseColor.rgb *= (0.88 + 0.18 * hash21(floor(tileCoord))) * (1.0 - seam * 0.45);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        vec3 pooled = vec3(0.0);
        for (int i = 0; i < ${POOLS}; i++) {
          vec2 offset = vFloorWorld.xz - uPools[i].xy;
          pooled += uPoolColors[i] * uPools[i].w * exp(-dot(offset, offset) / (uPools[i].z * uPools[i].z));
        }
        totalEmissiveRadiance += pooled * (1.0 - seam * 0.5);`,
      )
  }
  floor.customProgramCacheKey = () => 'relay-station-floor'

  const deck = new THREE.Mesh(slab, [floor, kit.materials.structureDeep])
  deck.receiveShadow = kit.settings.shadows
  object.add(deck)

  const terraceSlab = kit.track(new THREE.ExtrudeGeometry(terraceShape(), { depth: TERRACE.height, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 12 }))
  terraceSlab.rotateX(Math.PI / 2).translate(0, TERRACE.height, 0)
  const terrace = new THREE.Mesh(terraceSlab, [floor, kit.materials.structureDeep])
  terrace.receiveShadow = kit.settings.shadows
  object.add(terrace)
  addStairs(kit)

  addBalustrade(kit, object, shape)

  return {
    object,
    setLive(live) {
      livePool?.copy(live ? COLOR.cyan : COLOR.lamp)
    },
  }
}

function deckShape(): THREE.Shape {
  const { halfWidth, front, back, corner } = DECK
  const shape = new THREE.Shape()
  shape.moveTo(-halfWidth + corner, back)
  shape.lineTo(halfWidth - corner, back)
  shape.quadraticCurveTo(halfWidth, back, halfWidth, back + corner)
  shape.lineTo(halfWidth, front - corner)
  shape.quadraticCurveTo(halfWidth, front, halfWidth - corner, front)
  shape.lineTo(-halfWidth + corner, front)
  shape.quadraticCurveTo(-halfWidth, front, -halfWidth, front - corner)
  shape.lineTo(-halfWidth, back + corner)
  shape.quadraticCurveTo(-halfWidth, back, -halfWidth + corner, back)
  return shape
}

function terraceShape(): THREE.Shape {
  const { halfWidth, back, corner } = DECK
  const shape = new THREE.Shape()
  shape.moveTo(-halfWidth, TERRACE.front)
  shape.lineTo(halfWidth, TERRACE.front)
  shape.lineTo(halfWidth, back + corner)
  shape.quadraticCurveTo(halfWidth, back, halfWidth - corner, back)
  shape.lineTo(-halfWidth + corner, back)
  shape.quadraticCurveTo(-halfWidth, back, -halfWidth, back + corner)
  shape.lineTo(-halfWidth, TERRACE.front)
  return shape
}

/** Broad central steps up to the terrace, with the terrace edge lit to either side. */
function addStairs(kit: StationKit): void {
  const rise = TERRACE.height / TERRACE.steps
  const run = 0.34
  for (let step = 0; step < TERRACE.steps; step++) {
    const height = rise * (step + 1)
    const depth = run * (TERRACE.steps - step)
    const geometry = new THREE.BoxGeometry(TERRACE.stairHalfWidth * 2, height, depth)
    kit.structure.add(geometry, new THREE.Matrix4().makeTranslation(0, height / 2, TERRACE.front + depth / 2))
  }
  const edge = DECK.halfWidth - TERRACE.stairHalfWidth
  for (const side of [-1, 1]) {
    const x = side * (TERRACE.stairHalfWidth + edge / 2)
    kit.lights.add(new THREE.BoxGeometry(edge - 0.2, 0.02, 0.02), new THREE.Matrix4().makeTranslation(x, TERRACE.height + 0.012, TERRACE.front + 0.02), 0)
  }
}

function addBalustrade(kit: StationKit, parent: THREE.Object3D, shape: THREE.Shape): void {
  const outline = shape.getSpacedPoints(220)
  outline.pop()
  const count = outline.length
  const positions = new Float32Array(count * 2 * 3)
  const normals = new Float32Array(count * 2 * 3)
  const indices: number[] = []
  const rail: THREE.Vector3[] = []
  const lip: THREE.Vector3[] = []
  const tangent = new THREE.Vector2()

  for (let i = 0; i < count; i++) {
    const point = outline[i]
    const previous = outline[(i - 1 + count) % count]
    const next = outline[(i + 1) % count]
    if (!point || !previous || !next) continue
    tangent.subVectors(next, previous).normalize()
    const nx = tangent.y
    const nz = -tangent.x
    const x = point.x - nx * 0.06
    const z = point.y - nz * 0.06
    const floor = z < TERRACE.front ? TERRACE.height : 0
    positions.set([x, floor + 0.02, z, x, floor + RAIL_HEIGHT, z], i * 6)
    normals.set([nx, 0, nz, nx, 0, nz], i * 6)
    const a = i * 2
    const b = ((i + 1) % count) * 2
    indices.push(a, b, a + 1, b, b + 1, a + 1)
    rail.push(new THREE.Vector3(x, floor + RAIL_HEIGHT, z))
    lip.push(new THREE.Vector3(point.x + nx * (BEVEL + 0.02), -0.12, point.y + nz * (BEVEL + 0.02)))
  }

  const glassGeometry = kit.track(new THREE.BufferGeometry())
  glassGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  glassGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  glassGeometry.setIndex(indices)
  const glass = new THREE.Mesh(glassGeometry, kit.track(createGlassMaterial(kit.uniforms, new THREE.Color('#9fb4e0'), 0.55)))
  glass.renderOrder = 2
  parent.add(glass)

  const identity = new THREE.Matrix4()
  kit.lights.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail, true), 440, 0.022, 4, true), identity, 0)
  kit.lights.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lip, true), 440, 0.03, 4, true), identity, 0)
}
