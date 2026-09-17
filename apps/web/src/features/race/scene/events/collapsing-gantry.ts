import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { AMBER, COOL_LAMP, FLOOR_RED, RED, RED_LOW, SIDES, STEEL, STEEL_LIGHT, WHITE_LAMP, blink, blockedExtent, edgeLateral, laneRuns, smooth, type Extent } from './kit'

/**
 * Collapsing gantry. A sign gantry spans the road. When the event triggers the
 * truss over the blocked lanes snaps and drops to hang at sliding height,
 * swinging on its cables and spraying sparks: the engine counts it as an
 * overhead obstacle from that tick. It then lets go and falls onto the deck on
 * the engine's fall ticks, and lies across those lanes as a low wreck to jump.
 */

const TRUSS_TOP = 6
const TRUSS_DEPTH = 1.15
/** Bottom of the snapped section while it hangs: low enough that only a slide passes under. */
const HANG_BOTTOM = 1.25
const SNAP_TICKS = 10
const BRACE_STEP = 1.6
const SPARKS = 14

export const collapsingGantry: EventBuilder = (event, { route, parts }) => {
  const d0 = fromQ(event.dist)
  const legs = [edgeLateral(route, event.path, d0, -1) - 0.8, edgeLateral(route, event.path, d0, 1) + 0.8] as const
  const breaks: Extent[] = laneRuns(event.lanes)
    .map(run => blockedExtent(route, event.path, d0, run, { left: 0, right: 0 }))
    .sort((a, b) => a.left - b.left)
  const intact: Extent[] = []
  let cursor = legs[0]
  for (const piece of breaks) {
    if (piece.left > cursor) intact.push({ left: cursor, right: piece.left })
    cursor = piece.right
  }
  if (cursor < legs[1]) intact.push({ left: cursor, right: legs[1] })
  const color = new THREE.Color()
  const spark = new THREE.Color(3.6, 1.9, 0.6)
  const strip = COOL_LAMP.clone().multiplyScalar(0.55)

  function truss(left: number, right: number, bottom: number, roll: number, tint: THREE.Color, strip: THREE.Color): void {
    const middle = (left + right) / 2
    const width = right - left
    const lift = Math.sin(roll) * width * 0.5
    parts.put('body', d0, middle, bottom + TRUSS_DEPTH - 0.14, width, 0.28, 0.5, tint, 0, 0, roll)
    parts.put('body', d0, middle, bottom + 0.14, width, 0.28, 0.5, tint, 0, 0, roll)
    parts.put('lamp', d0 - 0.27, middle, bottom + 0.14, width, 0.06, 0.02, strip, 0, 0, roll)
    parts.put('lamp', d0 - 0.27, middle, bottom + TRUSS_DEPTH - 0.14, width, 0.06, 0.02, strip, 0, 0, roll)
    const braces = Math.max(1, Math.round(width / BRACE_STEP))
    for (let i = 0; i < braces; i++) {
      const t = (i + 0.5) / braces
      const x = left + width * t
      const rise = (t - 0.5) * 2 * lift
      parts.put('body', d0, x, bottom + TRUSS_DEPTH / 2 + rise, 0.12, TRUSS_DEPTH * 1.25, 0.12, STEEL, 0, 0, roll + (i % 2 === 0 ? 0.62 : -0.62))
    }
  }

  return {
    from: d0 - 5,
    to: d0 + 5,
    draw(clock, frame) {
      const phase = clock.phase
      const alarm = phase === 'telegraph' || phase === 'active'
      for (let index = 0; index < legs.length; index++) {
        const leg = legs[index]!
        parts.put('body', d0, leg, TRUSS_TOP / 2, 0.8, TRUSS_TOP, 0.8, STEEL)
        parts.put('beacon', d0 - 0.45, leg, TRUSS_TOP - 1.6, 0.42, 0.52, 0.42, alarm ? (blink(frame.time, 3, index * 0.5) ? RED : RED_LOW) : RED_LOW)
      }
      for (const piece of intact) {
        truss(piece.left, piece.right, TRUSS_TOP - TRUSS_DEPTH, 0, STEEL_LIGHT, alarm ? (blink(frame.time, 3) ? RED : RED_LOW) : strip)
        if (piece.right - piece.left > 3) {
          const panel = (piece.left + piece.right) / 2
          const wide = Math.min(3.6, piece.right - piece.left - 0.6)
          parts.put('body', d0 - 0.3, panel, TRUSS_TOP - TRUSS_DEPTH - 0.8, wide, 1.4, 0.16, STEEL)
          parts.put('lamp', d0 - 0.4, panel, TRUSS_TOP - TRUSS_DEPTH - 0.8, wide - 0.3, 1.0, 0.03, alarm ? color.copy(AMBER).multiplyScalar(0.08 + 0.14 * blink(frame.time, 2.4)) : color.copy(WHITE_LAMP).multiplyScalar(0.07))
        }
      }

      const age = clock.age
      for (const piece of breaks) {
        let bottom = TRUSS_TOP - TRUSS_DEPTH
        let roll = 0
        let swing = 0
        if (phase === 'telegraph') {
          const snap = smooth(age / SNAP_TICKS)
          swing = Math.sin(frame.time * 3.2) * 0.035 * (1 - clock.progress * 0.5)
          bottom = TRUSS_TOP - TRUSS_DEPTH + (HANG_BOTTOM - (TRUSS_TOP - TRUSS_DEPTH)) * snap
          roll = swing
        } else if (phase === 'active') {
          const fall = clock.progress * clock.progress
          bottom = HANG_BOTTOM * (1 - fall)
          roll = 0.04 * fall
        } else if (phase === 'settled') {
          bottom = 0
          roll = 0.03
        }
        const tint = phase === 'dormant' ? STEEL_LIGHT : color.copy(STEEL_LIGHT).multiplyScalar(0.7)
        truss(piece.left, piece.right, bottom, roll, tint, phase === 'dormant' ? strip : blink(frame.time, 5) ? RED : RED_LOW)
        if (phase === 'dormant') continue

        if (phase === 'telegraph') {
          for (const side of SIDES) {
            const end = side === -1 ? piece.left : piece.right
            parts.put('body', d0, end, (bottom + TRUSS_DEPTH + TRUSS_TOP - TRUSS_DEPTH) / 2, 0.04, TRUSS_TOP - bottom - TRUSS_DEPTH, 0.04, STEEL)
          }
        }
        const lively = phase === 'telegraph' || phase === 'active'
        for (let i = 0; i < (lively ? SPARKS : 3); i++) {
          const seed = i * 12.9898
          const life = (frame.time * (0.9 + (i % 3) * 0.2) + (seed % 1)) % 1
          const end = i % 2 === 0 ? piece.left : piece.right
          const source = lively ? TRUSS_TOP - TRUSS_DEPTH : bottom + TRUSS_DEPTH
          const drop = life * life * 4.5
          const scatter = ((((seed * 7) % 2) - 1) * life * 1.4)
          const bright = (1 - life) * (lively ? 1 : 0.4 * blink(frame.time, 2, i * 0.3))
          parts.put('spark', d0 - 0.2 + scatter * 0.3, end + scatter, source - drop, 0.22, 0.22, 0.22, color.copy(spark).multiplyScalar(bright))
        }
        const danger = clock.collision === relayLeg.COLLISION.OVERHEAD || clock.collision === relayLeg.COLLISION.CRUSH || clock.collision === relayLeg.COLLISION.LOW
        if (danger) parts.put('floor', d0 - 1.6, (piece.left + piece.right) / 2, 0.03, piece.right - piece.left, 1, 4.5, FLOOR_RED)
      }
    },
  }
}
