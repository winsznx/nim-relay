import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { Q, fromQ } from '../route'
import type { EventBuilder } from './clock'
import { eventBodyLateral } from './clock'
import { AMBER, AMBER_LOW, FLOOR_AMBER, FLOOR_RED, PAINT, RED, RED_STRIPE, SIDES, STEEL, WHITE_LAMP, blink, smooth } from './kit'

/**
 * Maintenance machine: a heavy hover rig parked high beside the road until it
 * triggers, then it drops to working height in its start lane with strobes
 * flashing and drifts across the road on the engine's schedule. Only its low
 * sweeper bar collides (jump it); the hull rides well above head height.
 */

const HULL_HEIGHT = 4.1
const PARKED_LIFT = 7
const FAN_RADIUS = 0.85

export const maintenanceDrone: EventBuilder = (event, { route, parts }) => {
  const d0 = fromQ(event.dist)
  const lanes = route.lanes(event.path, d0)
  const centre = route.pathOffset(event.path, d0)
  const color = new THREE.Color()
  const halfSpan = relayLeg.MACHINE_HALF / Q
  const barHalf = (relayLeg.MACHINE_HALF - relayLeg.HIT_MARGIN) / Q
  let lastLateral: number | null = null

  return {
    from: d0 - 4,
    to: d0 + 5,
    draw(clock, frame) {
      const lateral = centre + eventBodyLateral(event, clock, lanes.width, 0)
      const drift = lastLateral === null ? 0 : lateral - lastLateral
      lastLateral = lateral
      const lowered = clock.phase === 'dormant' ? 0 : clock.phase === 'telegraph' ? smooth(clock.progress) : 1
      const lift = PARKED_LIFT * (1 - lowered)
      const bob = Math.sin(frame.time * 2.1) * 0.06
      const lean = Math.max(-0.12, Math.min(0.12, drift * 4))
      const live = clock.collision === relayLeg.COLLISION.LOW
      const warning = clock.phase === 'telegraph' || (clock.phase !== 'dormant' && clock.age < relayLeg.MACHINE_WARN_TICKS + 20)

      const hull = HULL_HEIGHT + lift + bob
      parts.put('body', d0 + 0.6, lateral, hull, halfSpan * 2 + 0.6, 1.0, 3.4, PAINT, 0, 0, lean)
      parts.put('stripe', d0 - 1.12, lateral, hull - 0.32, halfSpan * 2 + 0.62, 0.34, 0.06, PAINT, 0, 0, lean)
      parts.put('body', d0 + 0.6, lateral, hull + 0.72, halfSpan * 1.3, 0.45, 2.2, STEEL, 0, 0, lean)
      parts.put('lamp', d0 - 1.12, lateral, hull - 0.1, halfSpan * 2 + 0.4, 0.12, 0.04, live ? RED : AMBER_LOW)
      for (const side of SIDES) {
        for (const along of SIDES) {
          const fx = lateral + side * (halfSpan + 0.55)
          const fd = d0 + 0.6 + along * 1.5
          parts.put('body', fd, fx, hull + 0.35, FAN_RADIUS * 2.2, 0.28, FAN_RADIUS * 2.2, STEEL, 0, 0, lean)
          parts.put('rotor', fd, fx, hull + 0.52, FAN_RADIUS * 2, 1, FAN_RADIUS * 2, color.setRGB(0.18, 0.19, 0.22), frame.time * 30)
        }
        const beaconOn = warning ? blink(frame.time, 4, side * 0.25) : live ? 0.35 + 0.65 * blink(frame.time, 1.5, side * 0.5) : 0.25
        parts.put('beacon', d0 - 0.8, lateral + side * (halfSpan + 0.1), hull + 0.62, 0.3, 0.36, 0.3, color.copy(AMBER).multiplyScalar(beaconOn))
        parts.put('body', d0, lateral + side * barHalf, (hull + 0.45) / 2 + 0.2, 0.16, hull - 0.5, 0.16, STEEL)
      }

      const bar = 0.46 + lift
      parts.put('stripe', d0, lateral, bar, barHalf * 2, 0.66, 0.62, RED_STRIPE)
      parts.put('lamp', d0 - 0.33, lateral, bar + 0.26, barHalf * 2 - 0.1, 0.07, 0.03, live ? RED : AMBER_LOW)
      parts.put('body', d0, lateral, bar - 0.38, barHalf * 2 + 0.2, 0.16, 0.9, STEEL)

      if (clock.phase !== 'dormant') {
        const spill = color.copy(WHITE_LAMP).multiplyScalar(0.12 * lowered)
        parts.put('cone', d0 + 0.6, lateral - halfSpan * 0.5, hull - 0.5, 1.4, hull - 0.5, 1.4, spill)
        parts.put('cone', d0 + 0.6, lateral + halfSpan * 0.5, hull - 0.5, 1.4, hull - 0.5, 1.4, spill)
        parts.put('floor', d0 - 1.4, lateral, 0.03, barHalf * 2, 1, 4.2, FLOOR_RED)
        const heading = Math.sign((event.lanes[event.lanes.length - 1] ?? 0) - (event.lanes[0] ?? 0)) || 1
        if (clock.phase !== 'settled') parts.put('floor', d0 - 1.4, lateral + heading * (barHalf + lanes.width * 0.6), 0.03, 3.4, 1, lanes.width, FLOOR_AMBER, -heading * Math.PI / 2)
      }
    },
  }
}
