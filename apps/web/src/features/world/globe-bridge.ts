import type { GlobeDisc, GlobeHandle } from './globe'

/**
 * Lets screens direct the one persistent globe (fly to a relay, play an
 * arrival) without owning it. Requests made before the globe is ready wait;
 * on devices that cannot draw the globe they complete immediately.
 */

interface ArrivalRequest {
  relayId: string
  fromCountry: string | null
  toCountry: string | null
}

/** Whether the globe finished loading its geography, or can't be drawn here. */
export type GlobeStatus = 'pending' | 'ready' | 'unavailable'

let globe: GlobeHandle | null = null
/** The globe on screen, from the moment it mounts, whether or not its geography loaded. */
let drawn: GlobeHandle | null = null
let unavailable = false
let status: GlobeStatus = 'pending'
const statusListeners = new Set<() => void>()
let pendingArrival: ArrivalRequest | null = null
let pendingFlight: { relayId: string; done: () => void } | null = null
const playedArrivals = new Set<string>()

function setStatus(next: GlobeStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener()
}

export function globeStatus(): GlobeStatus {
  return status
}

export function subscribeGlobeStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** The globe was mounted; it can be measured before its geography loads. */
export function showGlobe(handle: GlobeHandle): void {
  drawn = handle
}

/** Where the Earth is on screen, for pointing at it. Null when no globe is drawn. */
export function globeDisc(): GlobeDisc | null {
  return drawn?.disc() ?? null
}

export function attachGlobe(handle: GlobeHandle): void {
  globe = handle
  unavailable = false
  setStatus('ready')
  if (pendingArrival) {
    handle.arrive(pendingArrival.relayId, pendingArrival.fromCountry, pendingArrival.toCountry)
    pendingArrival = null
  } else if (pendingFlight) {
    const { relayId, done } = pendingFlight
    pendingFlight = null
    void handle.flyToRelay(relayId).then(done)
  }
}

export function detachGlobe(handle: GlobeHandle): void {
  if (globe === handle) globe = null
  if (drawn === handle) drawn = null
}

/** The globe can't render here (no WebGL or no geography): settle anything waiting for it. */
export function markGlobeUnavailable(): void {
  unavailable = true
  setStatus('unavailable')
  pendingArrival = null
  pendingFlight?.done()
  pendingFlight = null
}

/** Resolves when the camera arrives, or immediately if a newer flight replaces this one or there is no globe. */
export function flyToRelay(relayId: string): Promise<void> {
  if (globe) return globe.flyToRelay(relayId)
  if (unavailable) return Promise.resolve()
  pendingFlight?.done()
  return new Promise(resolve => {
    pendingFlight = { relayId, done: resolve }
  })
}

/** Plays a baton arrival once per key, e.g. per verified handoff or incoming-baton notice. */
export function playArrival(key: string, request: ArrivalRequest): void {
  if (playedArrivals.has(key)) return
  playedArrivals.add(key)
  if (globe) globe.arrive(request.relayId, request.fromCountry, request.toCountry)
  else if (!unavailable) pendingArrival = request
}
