import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { eventBodyLateral } from './clock'
import { FLOOR_AMBER, FLOOR_RED, RED, RED_LOW, blink, smooth } from './kit'

/**
 * Drone formation: security drones hold high above the road until the event
 * triggers, descend to head height through the telegraph with their red scan
 * beams sweeping the lanes below, then step across the lanes together on the
 * engine's beat. While they are down, the lanes under them need a slide.
 */

const HIGH = 6
const LOW = 1.45
const SCAN = new THREE.Color(1.4, 0.06, 0.08)

export const dronePattern: EventBuilder = (event, { route, parts }) => {
  const d0 = fromQ(event.dist)
  const lanes = route.lanes(event.path, d0)
  const centre = route.pathOffset(event.path, d0)
  const count = relayLeg.eventBodyCount(event)
  const previous = new Float32Array(count).fill(Number.NaN)
  const color = new THREE.Color()
  const rotor = new THREE.Color(0.14, 0.15, 0.17)

  return {
    from: d0 - 3,
    to: d0 + 3,
    draw(clock, frame) {
      const descent = clock.phase === 'dormant' ? 0 : clock.phase === 'telegraph' ? smooth(clock.progress) : 1
      const height = HIGH + (LOW - HIGH) * descent + Math.sin(frame.time * 2.6) * 0.05
      const live = clock.collision === relayLeg.COLLISION.OVERHEAD
      for (let i = 0; i < count; i++) {
        const lateral = centre + eventBodyLateral(event, clock, lanes.width, i)
        const last = previous[i]!
        const velocity = Number.isNaN(last) || frame.dt <= 0 ? 0 : (lateral - last) / frame.dt
        previous[i] = lateral
        const bank = Math.max(-0.35, Math.min(0.35, -velocity * 0.05))
        parts.put('drone', d0, lateral, height, 1.2, 1.2, 1.2, color.setRGB(0.2, 0.21, 0.24), 0, 0, bank)
        for (let r = 0; r < 4; r++) {
          const across = r < 2 ? -1.08 : 1.08
          const along = r % 2 === 0 ? -0.74 : 0.74
          parts.put('rotor', d0 + along, lateral + across, height + 0.1, 0.8, 1, 0.8, rotor, frame.time * 40 + r)
        }
        const flash = blink(frame.time, 2.5, i * 0.37)
        parts.put('beacon', d0 - 0.55, lateral, height - 0.2, 0.24, 0.24, 0.24, flash ? RED : RED_LOW)
        parts.put('lamp', d0, lateral, height - 0.3, lanes.width - 0.9, 0.05, 0.14, live ? RED : RED_LOW)
        if (clock.phase === 'dormant') continue
        const sweep = Math.sin(frame.time * 2.2 + i * 1.7) * 0.18
        parts.put('cone', d0 + 0.2, lateral, height - 0.25, 1.1, height - 0.2, 1.1, color.copy(SCAN).multiplyScalar(0.35 + 0.4 * descent), 0, sweep * 0.5, sweep)
        parts.put('floor', d0 - 1.3, lateral, 0.03, lanes.width - 0.6, 1, 3.6, live ? FLOOR_RED : FLOOR_AMBER)
      }
    },
  }
}
