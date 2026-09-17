import * as THREE from 'three'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { STEEL, edgeLateral, smooth } from './kit'

/**
 * Pulse tunnel: light frames around the road that fire on the 144 BPM grid.
 * Each beat a wave of light runs forward through the frames, so the rhythm the
 * pulse gates ask for is visible metres ahead. Dim until the event triggers.
 */

const RING_STEP = 8
const RING_HEIGHT = 5.2
const WAVE_LAG = 0.11
const DRAW_BEHIND = 16
const DRAW_AHEAD = 190

export const pulseTunnel: EventBuilder = (event, { route, parts, style }) => {
  const d0 = fromQ(event.dist)
  const length = fromQ(event.length)
  const period = Math.max(1, event.period)
  const peak = Math.max(style.track.edgeLight.r, style.track.edgeLight.g, style.track.edgeLight.b, 0.001)
  const tint = style.track.edgeLight.clone().multiplyScalar(2.6 / peak)
  const rings = Array.from({ length: Math.max(1, Math.floor(length / RING_STEP)) }, (_, k) => {
    const d = d0 + k * RING_STEP + RING_STEP / 2
    return { d, k, left: edgeLateral(route, event.path, d, -1) - 0.5, right: edgeLateral(route, event.path, d, 1) + 0.5, centre: route.pathOffset(event.path, d) }
  })
  const color = new THREE.Color()

  return {
    from: d0,
    to: d0 + length,
    draw(clock, frame) {
      const awake = clock.phase === 'dormant' ? 0.08 : clock.phase === 'telegraph' ? 0.08 + 0.92 * smooth(clock.progress) : 1
      const beat = ((frame.state.tick + frame.alpha) % period) / period
      for (const ring of rings) {
        if (ring.d < frame.dist - DRAW_BEHIND || ring.d > frame.dist + DRAW_AHEAD) continue
        const wave = (((beat - ring.k * WAVE_LAG) % 1) + 1) % 1
        const flash = Math.pow(1 - wave, 5)
        const brightness = awake * (0.14 + 0.86 * flash)
        color.copy(tint).multiplyScalar(brightness)
        const width = ring.right - ring.left
        parts.put('body', ring.d, ring.left - 0.25, RING_HEIGHT / 2, 0.36, RING_HEIGHT, 0.36, STEEL)
        parts.put('body', ring.d, ring.right + 0.25, RING_HEIGHT / 2, 0.36, RING_HEIGHT, 0.36, STEEL)
        parts.put('body', ring.d, ring.centre, RING_HEIGHT + 0.2, width + 0.86, 0.36, 0.36, STEEL)
        parts.put('lamp', ring.d - 0.2, ring.left, RING_HEIGHT / 2, 0.1, RING_HEIGHT - 0.4, 0.05, color)
        parts.put('lamp', ring.d - 0.2, ring.right, RING_HEIGHT / 2, 0.1, RING_HEIGHT - 0.4, 0.05, color)
        parts.put('lamp', ring.d - 0.2, ring.centre, RING_HEIGHT, width - 0.2, 0.1, 0.05, color)
      }
    },
  }
}
