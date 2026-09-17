import * as THREE from 'three'
import { RAMP_HEIGHT } from '../track-features'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { AMBER, AMBER_LOW, SIDES, STEEL, STEEL_LIGHT, blink, edgeLateral, smooth } from './kit'
import { drawSpeedGate, gapAfter, gatedRamp } from './speed-gate'

/**
 * Rising bridge. On the risk path the deck before a real gap is a launch ramp
 * that only clears the gap at the event's speed; a speed gate beside it fills
 * with the courier's speed. Hydraulic rams brace the ramp lip and landing
 * lights mark the far side. Beside the safe path, bascule leaves lift clear of
 * the road as the event plays, the bridge opening around the courier.
 */

const LEAF_LENGTH = 16
const LEAF_WIDTH = 6
const LEAF_ANGLE = 1.05
/** The two bascule leaves: before the middle of the span, and after it. */
const LEAVES = [[0, -1], [1, 1]] as const

export const risingBridge: EventBuilder = (event, { route, parts }) => {
  const d0 = fromQ(event.dist)
  const length = fromQ(event.length)
  const gated = gatedRamp(route.track, event)
  const gap = gated ? gapAfter(route.track, gated) : null
  const fork = route.forkAt(d0)
  const gapEdges = gap ? [gap.from, gap.to] : []
  const color = new THREE.Color()

  return {
    from: d0 - 5,
    to: d0 + length + 20,
    draw(clock, frame) {
      const opening = clock.phase === 'dormant' ? 0 : clock.phase === 'telegraph' ? smooth(clock.progress) : 1
      const alarm = clock.phase === 'telegraph'
      if (gated) {
        drawSpeedGate(parts, route, event, gated, frame.state, frame.time, color)
        const half = route.laneSpan(event.path, gated.to) - 0.4
        const centre = route.pathOffset(event.path, gated.to)
        for (const side of SIDES) {
          const top = RAMP_HEIGHT - 0.1
          parts.put('body', gated.to - 0.6, centre + side * half, (top - 3.2) / 2, 0.32, top + 3.2, 0.32, STEEL_LIGHT, 0, -0.35, 0)
          parts.put('body', gated.to - 1.8, centre + side * half, -2.2, 0.5, 2.4, 0.5, STEEL)
        }
      }
      if (gap) {
        for (const at of gapEdges) {
          for (const side of SIDES) {
            const lateral = edgeLateral(route, event.path, at, side) - side * 0.3
            const on = alarm ? blink(frame.time, 4, side * 0.25) : 0.3
            parts.put('beacon', at + (at === gap.from ? -0.4 : 0.4), lateral, 0.35, 0.22, 0.3, 0.22, color.copy(AMBER).multiplyScalar(on))
          }
        }
        const landing = route.laneSpan(event.path, gap.to + 1)
        for (let k = 0; k < 5; k++) {
          const lit = (Math.floor(frame.time * 8) + k) % 5 === 0 ? AMBER : AMBER_LOW
          parts.put('lamp', gap.to + 1.2 + k * 1.6, route.pathOffset(event.path, gap.to + 1) - landing + 0.3, 0.03, 0.18, 0.04, 0.7, lit)
          parts.put('lamp', gap.to + 1.2 + k * 1.6, route.pathOffset(event.path, gap.to + 1) + landing - 0.3, 0.03, 0.18, 0.04, 0.7, lit)
        }
      }
      if (fork) {
        const safeSide: -1 | 1 = fork.riskSide === 1 ? -1 : 1
        const along = d0 + length / 2
        const outer = edgeLateral(route, 'safe', along, safeSide) + safeSide * (LEAF_WIDTH / 2 + 3)
        for (const [index, direction] of LEAVES) {
          const hinge = along + direction * LEAF_LENGTH
          const angle = LEAF_ANGLE * opening
          const d = hinge - direction * Math.cos(angle) * LEAF_LENGTH / 2
          const height = -0.3 + Math.sin(angle) * LEAF_LENGTH / 2
          parts.put('body', d, outer, height, LEAF_WIDTH, 0.6, LEAF_LENGTH, STEEL_LIGHT, 0, -direction * angle, 0)
          parts.put('lamp', d, outer - safeSide * (LEAF_WIDTH / 2 + 0.02), height, 0.04, 0.12, LEAF_LENGTH - 1, alarm ? color.copy(AMBER).multiplyScalar(blink(frame.time, 3, index * 0.5)) : AMBER_LOW, 0, -direction * angle, 0)
        }
      }
    },
  }
}
