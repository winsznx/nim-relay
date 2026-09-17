import * as THREE from 'three'
import type { MeshBuilder } from './mesh-builder'
import type { Route } from './route'

/**
 * Route-space drawing helpers for streamed track chunks. Every helper places
 * vertices through `Route.point`, so paint, curbs and zones follow the exact
 * lateral positions the simulation uses.
 */

export type Lateral = (d: number) => number

/** Scratch vectors so building a chunk allocates only its output arrays. */
export class Points {
  private readonly pool = Array.from({ length: 16 }, () => new THREE.Vector3())
  private cursor = 0
  constructor(private readonly route: Route) {}
  at(d: number, lateral: number, height: number): THREE.Vector3 {
    const point = this.pool[this.cursor]!
    this.cursor = (this.cursor + 1) % this.pool.length
    return this.route.point(d, lateral, height, point)
  }
}

export function overlaps(zoneFrom: number, zoneTo: number, from: number, to: number): boolean {
  return zoneTo > from && zoneFrom < to
}

/** Evenly spaced cuts from `from` to `to`, at most `step` apart. */
export function strips(from: number, to: number, step: number): number[] {
  const count = Math.max(1, Math.ceil((to - from) / step))
  return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count)
}

/** Flat quad lifted `lift` above the deck between distances a..b and laterals that may vary with distance. */
export function deckQuad(
  builder: MeshBuilder,
  points: Points,
  a: number,
  b: number,
  left: Lateral,
  right: Lateral,
  lift: number,
  color: THREE.Color,
  uv: readonly [number, number, number, number] = [0, 0, 1, 1],
): void {
  builder.quad(points.at(a, left(a), lift), points.at(a, right(a), lift), points.at(b, right(b), lift), points.at(b, left(b), lift), color, uv)
}

/**
 * Vertical wall along the route at a lateral line, from `bottom` to `top`.
 * `facing` -1 faces towards negative lateral (left), 1 towards positive.
 */
export function wall(
  builder: MeshBuilder,
  points: Points,
  a: number,
  b: number,
  lateral: Lateral,
  bottom: number,
  top: number,
  facing: -1 | 1,
  color: THREE.Color,
  topColor: THREE.Color = color,
): void {
  if (facing === -1) {
    builder.quad(points.at(b, lateral(b), bottom), points.at(a, lateral(a), bottom), points.at(a, lateral(a), top), points.at(b, lateral(b), top), color, [0, 0, 0, 0], topColor)
  } else {
    builder.quad(points.at(a, lateral(a), bottom), points.at(b, lateral(b), bottom), points.at(b, lateral(b), top), points.at(a, lateral(a), top), color, [0, 0, 0, 0], topColor)
  }
}

/**
 * Vertical face across the route at distance `d`. `facing` 1 faces down the
 * route (forward), -1 faces back towards an approaching courier.
 */
export function transverse(
  builder: MeshBuilder,
  points: Points,
  d: number,
  left: number,
  right: number,
  bottom: number,
  top: number,
  facing: -1 | 1,
  color: THREE.Color,
): void {
  if (facing === -1) {
    builder.quad(points.at(d, left, top), points.at(d, left, bottom), points.at(d, right, bottom), points.at(d, right, top), color)
  } else {
    builder.quad(points.at(d, left, bottom), points.at(d, left, top), points.at(d, right, top), points.at(d, right, bottom), color)
  }
}

/**
 * Chevron flat on a surface at height `h`, its tip at `d`. `direction` 1 points
 * down the route, -1 back up it. `lean` tilts the tip sideways (merge arrows).
 */
export function chevron(
  builder: MeshBuilder,
  points: Points,
  d: number,
  centre: number,
  halfSpan: number,
  h: number,
  color: THREE.Color,
  thickness = 0.16,
  direction: 1 | -1 = 1,
  lean = 0,
): void {
  const depth = halfSpan * 0.45 * direction
  const tip = centre + lean
  const t = thickness * direction
  builder.quad(
    points.at(d - depth, centre - halfSpan, h), points.at(d, tip, h),
    points.at(d + t, tip, h), points.at(d - depth + t, centre - halfSpan, h), color,
  )
  builder.quad(
    points.at(d, tip, h), points.at(d - depth, centre + halfSpan, h),
    points.at(d - depth + t, centre + halfSpan, h), points.at(d + t, tip, h), color,
  )
}

/**
 * Diagonal warning stripes on the deck between laterals `left` and `right`
 * from `a` to `b`. Stripe parity comes from absolute distance, so stripes line
 * up across chunk boundaries. A null `dark` leaves the deck showing between.
 */
export function stripes(
  builder: MeshBuilder,
  points: Points,
  a: number,
  b: number,
  left: Lateral,
  right: Lateral,
  lift: number,
  bright: THREE.Color,
  dark: THREE.Color | null,
  period = 0.9,
  skew = 0.45,
): void {
  const half = period / 2
  const clamp = (d: number): number => Math.max(a, Math.min(b, d))
  const last = Math.ceil(b / half)
  for (let k = Math.floor((a - Math.max(0, skew)) / half); k <= last; k++) {
    const color = (k & 1) === 0 ? bright : dark
    if (!color) continue
    const d = k * half
    const nearLeft = clamp(d)
    const farLeft = clamp(d + half)
    const nearRight = clamp(d + skew)
    const farRight = clamp(d + half + skew)
    if (farLeft - nearLeft <= 1e-4 && farRight - nearRight <= 1e-4) continue
    builder.quad(
      points.at(nearLeft, left(nearLeft), lift), points.at(nearRight, right(nearRight), lift),
      points.at(farRight, right(farRight), lift), points.at(farLeft, left(farLeft), lift), color,
    )
  }
}
