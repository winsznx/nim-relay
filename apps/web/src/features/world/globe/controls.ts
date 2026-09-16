import * as THREE from 'three'
import { easeInOutCubic, latLonToVector, lonDelta } from './geo'

/**
 * Touch-first globe camera: drag to spin with inertia, pinch or wheel to zoom,
 * a slow idle drift, and eased flights to a place. The camera orbits a fixed
 * Earth so the real day/night terminator stays attached to geography.
 */

export interface Framing {
  /** Horizontal position of the globe centre, 0 left to 1 right. */
  centerX: number
  /** Vertical position of the globe centre, 0 top to 1 bottom. */
  centerY: number
  /** Share of the viewport width the globe spans at zoom 1. */
  fill: number
}

interface Flight {
  fromLat: number
  fromLon: number
  deltaLon: number
  toLat: number
  fromZoom: number
  toZoom: number
  start: number
  duration: number
  done: () => void
}

const MIN_LAT = -62
const MAX_LAT = 72
const MIN_ZOOM = 0.42
const MAX_ZOOM = 1.45
const IDLE_MS = 3500

export class GlobeControls {
  lat = 20
  lon = 10
  zoom = 1
  private velocityLon = 0
  private velocityLat = 0
  private lastInteraction = -Infinity
  private flight: Flight | null = null
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private gesture: { x: number; y: number; at: number; moved: boolean; multi: boolean } | null = null
  private lastMove = 0
  private pinchDistance = 0

  constructor(
    private readonly element: HTMLElement,
    private readonly onTap: (x: number, y: number) => void,
  ) {
    element.addEventListener('pointerdown', this.down)
    element.addEventListener('pointermove', this.move)
    element.addEventListener('pointerup', this.up)
    element.addEventListener('pointercancel', this.cancel)
    element.addEventListener('wheel', this.wheel, { passive: false })
  }

  private degreesPerPixel(): number {
    return (150 / Math.max(320, this.element.clientHeight)) * this.zoom
  }

  private interrupt(now: number): void {
    this.lastInteraction = now
    if (this.flight) {
      this.flight.done()
      this.flight = null
    }
  }

  private readonly down = (event: PointerEvent) => {
    this.interrupt(event.timeStamp)
    this.element.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    this.velocityLon = 0
    this.velocityLat = 0
    this.lastMove = event.timeStamp
    if (this.pointers.size === 1) this.gesture = { x: event.clientX, y: event.clientY, at: event.timeStamp, moved: false, multi: false }
    else {
      if (this.gesture) this.gesture.multi = true
      this.pinchDistance = this.currentPinchDistance()
    }
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  private readonly move = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) return
    this.lastInteraction = event.timeStamp
    const next = { x: event.clientX, y: event.clientY }
    this.pointers.set(event.pointerId, next)
    if (this.pointers.size >= 2) {
      const distance = this.currentPinchDistance()
      if (this.pinchDistance > 0 && distance > 0) this.zoom = THREE.MathUtils.clamp((this.zoom * this.pinchDistance) / distance, MIN_ZOOM, MAX_ZOOM)
      this.pinchDistance = distance
      return
    }
    if (this.gesture && Math.hypot(next.x - this.gesture.x, next.y - this.gesture.y) > 7) this.gesture.moved = true
    const scale = this.degreesPerPixel()
    const dLon = -(next.x - previous.x) * scale
    const dLat = (next.y - previous.y) * scale
    this.lon += dLon
    this.lat = THREE.MathUtils.clamp(this.lat + dLat, MIN_LAT, MAX_LAT)
    const dt = Math.max(1, event.timeStamp - this.lastMove) / 1000
    this.lastMove = event.timeStamp
    this.velocityLon = THREE.MathUtils.lerp(this.velocityLon, dLon / dt, 0.35)
    this.velocityLat = THREE.MathUtils.lerp(this.velocityLat, dLat / dt, 0.35)
  }

  private readonly up = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId)
    const gesture = this.gesture
    if (this.pointers.size === 0) {
      this.gesture = null
      if (event.timeStamp - this.lastMove > 80) {
        this.velocityLon = 0
        this.velocityLat = 0
      }
      if (gesture && !gesture.moved && !gesture.multi && event.timeStamp - gesture.at < 450) {
        const rect = this.element.getBoundingClientRect()
        this.onTap(event.clientX - rect.left, event.clientY - rect.top)
      }
    } else {
      this.pinchDistance = this.currentPinchDistance()
    }
  }

  private readonly cancel = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId)
    if (this.pointers.size === 0) this.gesture = null
  }

  private readonly wheel = (event: WheelEvent) => {
    event.preventDefault()
    this.interrupt(event.timeStamp)
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM)
  }

  flyTo(lat: number, lon: number, zoom: number, now: number, durationMs: number): Promise<void> {
    this.flight?.done()
    return new Promise(resolve => {
      this.flight = {
        fromLat: this.lat,
        fromLon: this.lon,
        deltaLon: lonDelta(this.lon, lon),
        toLat: THREE.MathUtils.clamp(lat, MIN_LAT, MAX_LAT),
        fromZoom: this.zoom,
        toZoom: THREE.MathUtils.clamp(zoom, MIN_ZOOM, MAX_ZOOM),
        start: now,
        duration: Math.max(1, durationMs),
        done: resolve,
      }
      this.velocityLon = 0
      this.velocityLat = 0
      this.lastInteraction = now
    })
  }

  /** Advances inertia, idle drift and flights. `drift` is degrees per second while idle. */
  update(now: number, dtSeconds: number, drift: number): void {
    const flight = this.flight
    if (flight) {
      const t = Math.min(1, (now - flight.start) / flight.duration)
      const eased = easeInOutCubic(t)
      this.lat = flight.fromLat + (flight.toLat - flight.fromLat) * eased
      this.lon = flight.fromLon + flight.deltaLon * eased
      this.zoom = flight.fromZoom + (flight.toZoom - flight.fromZoom) * eased
      this.lastInteraction = now
      if (t >= 1) {
        this.flight = null
        flight.done()
      }
      return
    }
    if (this.pointers.size > 0) return
    const friction = Math.exp(-dtSeconds * 3.4)
    this.velocityLon *= friction
    this.velocityLat *= friction
    this.lon += this.velocityLon * dtSeconds
    this.lat = THREE.MathUtils.clamp(this.lat + this.velocityLat * dtSeconds, MIN_LAT, MAX_LAT)
    if (now - this.lastInteraction > IDLE_MS && Math.abs(this.velocityLon) < 1) this.lon -= drift * dtSeconds
  }

  /** Places the camera for the current view. Returns the distance at zoom 1, used to scale point sizes. */
  apply(camera: THREE.PerspectiveCamera, width: number, height: number, framing: Framing): number {
    const aspect = width / Math.max(1, height)
    const verticalFov = THREE.MathUtils.degToRad(camera.fov)
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
    const span = Math.min(horizontalFov * framing.fill, verticalFov * 0.68)
    const fitDistance = 1 / Math.sin(span / 2)
    latLonToVector(this.lat, this.lon, fitDistance * this.zoom, camera.position)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    camera.setViewOffset(width, height, width * (0.5 - framing.centerX), height * (0.5 - framing.centerY), width, height)
    return fitDistance
  }

  dispose(): void {
    this.flight?.done()
    this.element.removeEventListener('pointerdown', this.down)
    this.element.removeEventListener('pointermove', this.move)
    this.element.removeEventListener('pointerup', this.up)
    this.element.removeEventListener('pointercancel', this.cancel)
    this.element.removeEventListener('wheel', this.wheel)
  }
}
