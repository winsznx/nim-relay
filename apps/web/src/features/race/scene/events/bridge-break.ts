import * as THREE from 'three'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { GOLD } from '../track-style'
import { AMBER, RED, RED_LOW, SIDES, STEEL, blink, edgeLateral } from './kit'
import { drawSpeedGate, gapAfter, gatedRamp } from './speed-gate'

/**
 * The finale. The relay cut's ramp is speed-gated over a real gap. On the
 * coast the missing span still hangs from the far side of the gap, cracked and
 * creaking, until the event triggers: its last bolts shear in a burst of sparks
 * and it tears away into the sea below with a trail of debris, leaving the gap
 * and the finish beyond it clear to see. Other worlds shed debris from the gap
 * edges instead. Red strobes line both edges of the gap throughout.
 */

const GRAVITY = 9.8
const HANG_ANGLE = 0.62
const DEBRIS = 18
const DEBRIS_SECONDS = 4.5
const SLAB_SECONDS = 5
const CONCRETE = new THREE.Color(0.2, 0.2, 0.215)
const DUST = new THREE.Color(0.55, 0.36, 0.24)
const SPARK = new THREE.Color(4, 2.1, 0.7)

interface Chunk {
  d: number
  lateral: number
  height: number
  velocity: THREE.Vector3
  spin: THREE.Vector3
  size: number
}

function hash(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export const bridgeBreak: EventBuilder = (event, { route, parts, style }) => {
  const gated = gatedRamp(route.track, event)
  const gap = gated ? gapAfter(route.track, gated) : null
  const grand = style.id === 'coast'
  const color = new THREE.Color()
  const d0 = fromQ(event.dist)
  const slabLength = gap ? Math.min(16, (gap.to - gap.from) * 0.42) : 0
  const gapEdges = gap ? [gap.from, gap.to] : []
  const slabWidth = gap ? route.halfWidth(event.path, gap.to) * 2 + 0.2 : 0
  const chunks: Chunk[] = gap
    ? Array.from({ length: DEBRIS }, (_, i) => {
        const far = i % 3 !== 0
        const at = far ? gap.to - hash(i) * 2 : gap.from + hash(i) * 1.5
        const side = hash(i + 3) * 2 - 1
        return {
          d: at,
          lateral: route.pathOffset(event.path, at) + side * route.halfWidth(event.path, at) * 0.9,
          height: -0.2 - hash(i + 5) * 0.4,
          velocity: new THREE.Vector3(side * (1 + hash(i + 7) * 3), 1.5 + hash(i + 11) * 4, (far ? -1 : 1) * (1 + hash(i + 13) * 4)),
          spin: new THREE.Vector3(hash(i + 17) * 6 - 3, hash(i + 19) * 6 - 3, hash(i + 23) * 6 - 3),
          size: 0.35 + hash(i + 29) * 0.9,
        }
      })
    : []

  return {
    from: d0 - 5,
    to: (gap?.to ?? d0) + 20,
    draw(clock, frame) {
      if (gated) drawSpeedGate(parts, route, event, gated, frame.state, frame.time, color)
      if (!gap) return
      const seconds = clock.age < 0 ? -1 : clock.age / 60
      const triggered = seconds >= 0

      for (const at of gapEdges) {
        for (const side of SIDES) {
          const lateral = edgeLateral(route, event.path, at, side) - side * 0.35
          const on = triggered ? blink(frame.time, 6, side * 0.25 + (at === gap.from ? 0 : 0.5)) : blink(frame.time, 1.2, side * 0.5)
          parts.put('beacon', at + (at === gap.from ? -0.5 : 0.5), lateral, 0.3, 0.24, 0.32, 0.24, on ? RED : RED_LOW)
        }
      }

      if (grand && seconds < SLAB_SECONDS) {
        const centre = route.pathOffset(event.path, gap.to)
        const falling = Math.max(0, seconds)
        const angle = HANG_ANGLE + (triggered ? falling * 1.1 : Math.sin(frame.time * 1.3) * 0.015)
        const drop = triggered ? 0.5 * GRAVITY * falling * falling : 0
        const d = gap.to - Math.cos(angle) * slabLength / 2 - falling * 2.5
        const height = -Math.sin(angle) * slabLength / 2 - drop
        parts.put('body', d, centre, height, slabWidth, 0.55, slabLength, CONCRETE, 0, -angle, triggered ? falling * 0.25 : 0)
        parts.put('lamp', d, centre, height + Math.cos(angle) * 0.3, 0.12, 0.04, slabLength * 0.8, color.copy(GOLD.soft).multiplyScalar(triggered ? 0.4 : 0.8), 0, -angle, triggered ? falling * 0.25 : 0)
        if (!triggered) {
          for (const side of SIDES) {
            const tip = gap.to - Math.cos(angle) * slabLength
            const tipHeight = -Math.sin(angle) * slabLength
            parts.put('body', (gap.to + tip) / 2, centre + side * (slabWidth / 2 - 0.3), tipHeight / 2 + 3, 0.05, 6 - tipHeight, 0.05, STEEL, 0, 0.25, 0)
          }
        }
      }

      if (!triggered) {
        if (grand && blink(frame.time, 0.7) && hash(Math.floor(frame.time * 3)) > 0.5) {
          parts.put('spark', gap.to - 0.3, route.pathOffset(event.path, gap.to) + (hash(Math.floor(frame.time * 7)) - 0.5) * slabWidth, -0.2, 0.5, 0.5, 0.5, SPARK)
        }
        return
      }

      if (seconds < 1.4) {
        const burst = 1 - seconds / 1.4
        for (let i = 0; i < 16; i++) {
          const t = seconds * (1.4 + hash(i) * 1.2)
          const lateral = route.pathOffset(event.path, gap.to) + (hash(i + 2) - 0.5) * slabWidth * (1 + t)
          parts.put('spark', gap.to - hash(i + 4) * 2, lateral, -0.2 + (hash(i + 6) * 3 - 0.8) * t - 2 * t * t, 0.35, 0.35, 0.35, color.copy(SPARK).multiplyScalar(burst))
        }
      }
      if (seconds < 3) {
        const fade = 1 - seconds / 3
        for (let i = 0; i < 6; i++) {
          const spread = 1 + seconds * (1.5 + hash(i + 40))
          parts.put('spark', gap.to - 1 - i * 1.4, route.pathOffset(event.path, gap.to) + (hash(i + 41) - 0.5) * slabWidth, -1 - seconds * 2, 3 * spread, 3 * spread, 3 * spread, color.copy(DUST).multiplyScalar(0.18 * fade))
        }
      }
      if (seconds < DEBRIS_SECONDS) {
        for (const chunk of chunks) {
          const t = seconds
          parts.put(
            'body',
            chunk.d + chunk.velocity.z * t,
            chunk.lateral + chunk.velocity.x * t,
            chunk.height + chunk.velocity.y * t - 0.5 * GRAVITY * t * t,
            chunk.size, chunk.size * 0.6, chunk.size * 0.8,
            CONCRETE,
            chunk.spin.y * t, chunk.spin.x * t, chunk.spin.z * t,
          )
        }
        if (seconds < 0.6) parts.put('lamp', gap.to, route.pathOffset(event.path, gap.to), -0.1, slabWidth, 0.06, 0.4, color.copy(AMBER).multiplyScalar(1 - seconds / 0.6))
      }
    },
  }
}
