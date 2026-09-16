import type { GlobeHandle } from './globe'

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

let globe: GlobeHandle | null = null
let unavailable = false
let pendingArrival: ArrivalRequest | null = null
let pendingFlight: { relayId: string; done: () => void } | null = null
const playedArrivals = new Set<string>()

export function attachGlobe(handle: GlobeHandle): void {
  globe = handle
  unavailable = false
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
}

/** The globe can't render here (no WebGL or no geography): settle anything waiting for it. */
export function markGlobeUnavailable(): void {
  unavailable = true
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
