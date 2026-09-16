import * as THREE from 'three'

export const EARTH_RADIUS = 1

/** Latitude/longitude in degrees to a point on (or above) the globe. Longitude 0 faces +Z, 90°E faces +X. */
export function latLonToVector(lat: number, lon: number, radius = EARTH_RADIUS, target = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(lat)
  const theta = THREE.MathUtils.degToRad(lon)
  return target.set(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)).multiplyScalar(radius)
}

export function vectorToLatLon(vector: THREE.Vector3): { lat: number; lon: number } {
  const unit = vector.clone().normalize()
  return { lat: THREE.MathUtils.radToDeg(Math.asin(unit.y)), lon: THREE.MathUtils.radToDeg(Math.atan2(unit.x, unit.z)) }
}

/** Signed shortest difference from one longitude to another, in degrees. */
export function lonDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180
}

/**
 * Great-circle arc lifted above the surface in proportion to distance, so long
 * hops read as flights and neighbouring countries stay close to the ground.
 */
export function arcPoints(from: THREE.Vector3, to: THREE.Vector3, segments: number): THREE.Vector3[] {
  const a = from.clone().normalize()
  const b = to.clone().normalize()
  const angle = a.angleTo(b)
  const lift = 0.035 + Math.min(0.42, angle * 0.24)
  const sinAngle = Math.sin(angle)
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const direction =
      sinAngle < 1e-4
        ? a.clone().lerp(b, t).normalize()
        : a
            .clone()
            .multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
            .add(b.clone().multiplyScalar(Math.sin(t * angle) / sinAngle))
    points.push(direction.multiplyScalar(EARTH_RADIUS + 0.012 + Math.sin(Math.PI * t) * lift))
  }
  return points
}

/** Approximate subsolar point for a moment in time, so the night side is where it is actually night. */
export function subsolarPoint(time: number): { lat: number; lon: number } {
  const date = new Date(time)
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const dayOfYear = (time - start) / 86_400_000
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10))
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  return { lat: declination, lon: -15 * (utcHours - 12) }
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
