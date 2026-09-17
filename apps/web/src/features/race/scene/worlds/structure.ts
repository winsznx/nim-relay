import * as THREE from 'three'
import type { MeshBuilder } from '../mesh-builder'
import type { Route } from '../route'
import { pathIntervals } from '../track-spans'

/**
 * Building blocks for set pieces: merged meshes with disposal, boxes between
 * route-space points, and the lateral extent of every path so structure beside
 * the road clears forks that swing apart.
 */

const p = (): THREE.Vector3 => new THREE.Vector3()

export function finishMeshes(group: THREE.Group, builders: readonly [MeshBuilder, THREE.Material][], extra: readonly { dispose(): void }[] = []): () => void {
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
export function union(route: Route, d: number): { left: number; right: number } {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (const interval of pathIntervals(route, d)) {
    left = Math.min(left, interval.left)
    right = Math.max(right, interval.right)
  }
  return Number.isFinite(left) ? { left, right } : { left: -route.halfWidth('main', d), right: route.halfWidth('main', d) }
}

/** Box between two route-space points (d, lateral, height) with a given cross-section. */
export function beam(builder: MeshBuilder, route: Route, a: readonly [number, number, number], b: readonly [number, number, number], width: number, color: THREE.Color): void {
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

/** Widest lateral extent of every path over a stretch, so structure beside it clears forks that swing apart. */
export function stretchExtent(route: Route, from: number, to: number): { left: number; right: number } {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (let d = from; d <= to; d += 5) {
    const extent = union(route, d)
    left = Math.min(left, extent.left)
    right = Math.max(right, extent.right)
  }
  return { left, right }
}
