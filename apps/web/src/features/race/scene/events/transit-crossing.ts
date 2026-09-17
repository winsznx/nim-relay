import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { Q, fromQ } from '../route'
import type { EventBuilder } from './clock'
import { eventBodyLateral } from './clock'
import { AMBER, AMBER_LOW, FLOOR_AMBER, FLOOR_RED, RED, RED_LOW, SIDES, STEEL, STEEL_LIGHT, WHITE_LAMP, blink, edgeLateral } from './kit'

/**
 * Transit crossing: rails set into the deck run out past both edges onto
 * viaduct stubs. The carrier waits off the road on its rail stub; when the
 * event triggers the crossing signals flash, then the carrier glides across
 * the lanes on the engine's schedule and parks off the far edge. Only while it
 * is on the road does it block, low enough to jump.
 */

const RAIL_GAP = 0.72
const STUB_BEYOND = 5
const POST_HEIGHT = 2.9
const RAILS = [-RAIL_GAP, RAIL_GAP] as const
const LAMP_ALONG = [-1.28, 1.28] as const

export const transitCrossing: EventBuilder = (event, { route, parts }) => {
  const d0 = fromQ(event.dist)
  const lanes = route.lanes(event.path, d0)
  const centre = route.pathOffset(event.path, d0)
  const first = centre + ((event.lanes[0] ?? 0) * lanes.width) / 2
  const last = centre + ((event.lanes[event.lanes.length - 1] ?? 0) * lanes.width) / 2
  const heading = Math.sign(last - first) || 1
  const reachLeft = Math.min(first, last) - relayLeg.VEHICLE_HALF / Q - STUB_BEYOND
  const reachRight = Math.max(first, last) + relayLeg.VEHICLE_HALF / Q + STUB_BEYOND
  const edges = [edgeLateral(route, event.path, d0, -1), edgeLateral(route, event.path, d0, 1)] as const
  const bodyHalf = relayLeg.VEHICLE_HALF / Q
  const blockHalf = (relayLeg.VEHICLE_HALF - relayLeg.HIT_MARGIN) / Q
  const stubs = [[reachLeft, edges[0] - 0.2], [edges[1] + 0.2, reachRight]] as const
  const color = new THREE.Color()

  return {
    from: d0 - 9,
    to: d0 + 3,
    draw(clock, frame) {
      const warning = clock.phase === 'telegraph' || clock.phase === 'active'
      const live = clock.collision === relayLeg.COLLISION.LOW

      for (const along of RAILS) {
        parts.put('body', d0 + along, (reachLeft + reachRight) / 2, 0.012, reachRight - reachLeft, 0.03, 0.14, STEEL_LIGHT)
        parts.put('lamp', d0 + along - 0.09, (reachLeft + reachRight) / 2, 0.03, reachRight - reachLeft, 0.012, 0.03, warning ? color.copy(AMBER).multiplyScalar(0.5 + 0.5 * blink(frame.time, 3)) : AMBER_LOW)
      }
      for (const [low, high] of stubs) {
        if (high <= low) continue
        parts.put('body', d0, (low + high) / 2, -0.35, high - low, 0.7, 2.6, STEEL)
        parts.put('body', d0, (low + high) / 2, -1.6, 1.2, 1.8, 1.4, STEEL)
      }

      for (const side of SIDES) {
        const post = edges[side === -1 ? 0 : 1] + side * 0.6
        parts.put('body', d0 - 2.2, post, POST_HEIGHT / 2, 0.14, POST_HEIGHT, 0.14, STEEL)
        parts.put('body', d0 - 2.2, post, POST_HEIGHT - 0.35, 1.3, 0.12, 0.06, STEEL_LIGHT, 0, 0, 0.6)
        parts.put('body', d0 - 2.2, post, POST_HEIGHT - 0.35, 1.3, 0.12, 0.06, STEEL_LIGHT, 0, 0, -0.6)
        for (const lamp of SIDES) {
          const on = warning ? blink(frame.time, 2.2, lamp === 1 ? 0.5 : 0) : 0
          parts.put('lamp', d0 - 2.27, post + lamp * 0.24, POST_HEIGHT - 0.9, 0.24, 0.24, 0.05, on ? RED : RED_LOW)
        }
      }

      const lateral = centre + eventBodyLateral(event, clock, lanes.width, 0)
      const lead = lateral + heading * bodyHalf
      const tail = lateral - heading * bodyHalf
      parts.put('body', d0, lateral, 0.62, bodyHalf * 2, 0.78, 2.5, STEEL_LIGHT)
      parts.put('body', d0, lateral, 1.1, bodyHalf * 2 - 0.9, 0.24, 1.9, STEEL)
      parts.put('lamp', d0, lateral, 0.86, bodyHalf * 2 - 0.4, 0.13, 2.53, color.copy(WHITE_LAMP).multiplyScalar(0.45))
      parts.put('lamp', d0, lateral, 0.26, bodyHalf * 2 - 0.2, 0.05, 2.1, live ? RED : AMBER_LOW)
      parts.put('lamp', d0, lead + heading * 0.02, 0.62, 0.04, 0.28, 1.8, WHITE_LAMP)
      parts.put('lamp', d0, tail - heading * 0.02, 0.62, 0.04, 0.2, 1.6, RED)
      for (const along of LAMP_ALONG) {
        parts.put('beacon', d0 + along, lead - heading * 0.4, 1.28, 0.16, 0.2, 0.16, color.copy(AMBER).multiplyScalar(warning ? blink(frame.time, 3.4) : 0.2))
      }
      if (live) parts.put('floor', d0 - 1.8, lateral, 0.03, blockHalf * 2, 1, 4, FLOOR_RED)
      if (clock.phase === 'telegraph') parts.put('floor', d0 - 7, centre, 0.03, 3.6, 1, (edges[1] - edges[0]) - 0.6, FLOOR_AMBER, -heading * Math.PI / 2)
    },
  }
}
