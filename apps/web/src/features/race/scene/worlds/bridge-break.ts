import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { MeshBuilder } from '../mesh-builder'
import { fromQ, type Route } from '../route'
import { createChaseLights, type ChaseLights } from './chase-lights'
import { beam, finishMeshes, stretchExtent } from './structure'
import type { WorldFrame } from './types'

/**
 * The coast finale's broken bridge: two great towers carry the main cables
 * over the fork, and on the relay cut's side the cable has snapped and hangs
 * through the gap. The deck around the gap ends in torn concrete and bent
 * rebar, and a shattered pier stands in the water below, so the gap reads as a
 * bridge that has failed rather than a hole in a road. The falling span and
 * debris are the bridge-break world event's.
 */

const TOWER_TOP = 48
const TOWER_CLEARANCE = 3.2
const CONCRETE = new THREE.Color('#3b3e48')
const TORN = new THREE.Color('#2a2c33')
const REBAR = new THREE.Color('#121317')
const CABLE = new THREE.Color(2.4, 1.9, 1.3)
const AIR_LAMP = new THREE.Color(3.4, 0.25, 0.22)

interface BreakContext {
  route: Route
  piece: relayLeg.SetPiece
  floorY: number
}

export function buildBridgeBreak({ route, piece, floorY }: BreakContext): { group: THREE.Group; update(frame: WorldFrame): void; dispose(): void } {
  const group = new THREE.Group()
  group.name = 'bridge-break'
  const structure = new MeshBuilder()
  const glow = new MeshBuilder()
  const d0 = fromQ(piece.dist)
  const length = fromQ(piece.length)
  const gap = route.track.gaps.find(zone => zone.path === 'risk' && fromQ(zone.from) >= d0 && fromQ(zone.to) <= d0 + length)
  const deckHeight = (d: number): number => route.point(d, 0, 0, new THREE.Vector3()).y
  const cables: THREE.Vector3[][] = []

  if (gap) {
    const gapFrom = fromQ(gap.from)
    const gapTo = fromQ(gap.to)
    const towers = [gapFrom - 30, gapTo + 30]
    const extent = stretchExtent(route, towers[0]!, towers[1]!)
    const sides = [extent.left - TOWER_CLEARANCE, extent.right + TOWER_CLEARANCE] as const
    const riskSide = Math.sign(route.pathOffset('risk', (gapFrom + gapTo) / 2)) || 1
    const brokenIndex = riskSide < 0 ? 0 : 1

    for (const d of towers) {
      sides.forEach((lateral, index) => {
        const inward = index === 0 ? 1 : -1
        beam(structure, route, [d, lateral, floorY - deckHeight(d)], [d, lateral + inward * 1.4, TOWER_TOP], 2.6, CONCRETE)
        beam(glow, route, [d - 1.35, lateral + inward * 1.0, 2], [d - 1.35, lateral + inward * 1.6, TOWER_TOP - 2], 0.16, CABLE)
        beam(glow, route, [d, lateral + inward * 1.4, TOWER_TOP + 0.6], [d, lateral + inward * 1.4, TOWER_TOP + 1.4], 0.7, AIR_LAMP)
      })
      beam(structure, route, [d, sides[0] + 1, TOWER_TOP - 4], [d, sides[1] - 1, TOWER_TOP - 4], 2.8, CONCRETE)
    }

    sides.forEach((side, index) => {
      const lateral = side + (index === 0 ? 1 : -1)
      const segments = 30
      const snapFrom = (gapFrom - towers[0]!) / (towers[1]! - towers[0]!)
      const snapTo = (gapTo - towers[0]!) / (towers[1]! - towers[0]!)
      let previous: [number, number, number] | null = null
      let run: THREE.Vector3[] = []
      for (let i = 0; i <= segments; i++) {
        const t = i / segments
        const d = towers[0]! + (towers[1]! - towers[0]!) * t
        const sag = 5 + (TOWER_TOP - 8) * Math.pow(2 * t - 1, 2)
        const broken = index === brokenIndex && t > snapFrom && t < snapTo
        const point: [number, number, number] = [d, lateral, sag]
        if (previous && !broken) beam(glow, route, previous, point, 0.18, CABLE)
        if (!broken && i > 0 && i < segments && i % 2 === 0) beam(glow, route, [d, lateral, 0.4], [d, lateral, sag], 0.05, CABLE.clone().multiplyScalar(0.4))
        if (broken) {
          if (run.length > 1) cables.push(run)
          run = []
        } else {
          run.push(route.point(d, lateral, sag + 0.2, new THREE.Vector3()))
        }
        previous = broken ? null : point
      }
      if (run.length > 1) cables.push(run)
      if (index === brokenIndex) {
        const hangFrom = 5 + (TOWER_TOP - 8) * Math.pow(2 * snapFrom - 1, 2)
        const hangTo = 5 + (TOWER_TOP - 8) * Math.pow(2 * snapTo - 1, 2)
        beam(glow, route, [gapFrom, lateral, hangFrom], [gapFrom + 5, lateral - riskSide * 1.5, -14], 0.16, CABLE.clone().multiplyScalar(0.7))
        beam(glow, route, [gapTo, lateral, hangTo], [gapTo - 7, lateral - riskSide * 2.5, -18], 0.16, CABLE.clone().multiplyScalar(0.7))
      }
    })

    tornEdge(structure, route, gapFrom, 1)
    tornEdge(structure, route, gapTo, -1)

    const pier = (gapFrom + gapTo) / 2
    const pierLateral = route.pathOffset('risk', pier)
    const pierTop = -11
    beam(structure, route, [pier, pierLateral, floorY - deckHeight(pier)], [pier, pierLateral, pierTop], 3.2, CONCRETE)
    for (let k = 0; k < 4; k++) {
      const angle = (k / 4) * Math.PI * 2
      beam(structure, route, [pier + Math.cos(angle) * 0.9, pierLateral + Math.sin(angle) * 0.9, pierTop - 0.5], [pier + Math.cos(angle) * 1.6, pierLateral + Math.sin(angle) * 1.4, pierTop + 1.4 + k * 0.35], 0.7, TORN)
    }
  }

  const chase: ChaseLights | null = cables.length > 0 ? createChaseLights(cables, new THREE.Color(3.2, 2.2, 1.1)) : null
  if (chase) group.add(chase.points)
  const dispose = finishMeshes(group, [
    [structure, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 })],
    [glow, new THREE.MeshBasicMaterial({ vertexColors: true })],
  ], chase ? [chase] : [])
  const centre = d0 + length / 2
  return { group, update: frame => chase?.update(frame.time, Math.abs(frame.dist - centre) < 600), dispose }
}

/** Jagged concrete teeth hanging below a deck edge at `d` and rebar reaching out over the gap; `facing` 1 when the gap lies ahead. */
function tornEdge(builder: MeshBuilder, route: Route, d: number, facing: 1 | -1): void {
  const half = route.halfWidth('risk', d)
  const centre = route.pathOffset('risk', d)
  const teeth = 6
  for (let i = 0; i < teeth; i++) {
    const t = (i + 0.5) / teeth
    const lateral = centre - half + t * half * 2
    const depth = 0.9 + ((i * 7) % 5) * 0.32
    beam(builder, route, [d - facing * 0.3, lateral, -0.4], [d + facing * (0.1 + ((i * 3) % 4) * 0.12), lateral + (i % 2 === 0 ? 0.25 : -0.25), -0.4 - depth], 0.7, TORN)
  }
  for (let i = 0; i < 9; i++) {
    const lateral = centre - half + ((i + 0.5) / 9) * half * 2
    const reach = 0.7 + ((i * 5) % 4) * 0.28
    const droop = 0.15 + ((i * 3) % 3) * 0.2
    beam(builder, route, [d - facing * 0.2, lateral, -0.25], [d + facing * reach, lateral + ((i * 11) % 3 - 1) * 0.15, -0.25 - droop], 0.05, REBAR)
  }
}
