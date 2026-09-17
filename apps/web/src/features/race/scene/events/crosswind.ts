import * as THREE from 'three'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { PAINT, SIDES, STEEL, STEEL_LIGHT, edgeLateral } from './kit'

/**
 * Crosswind: the engine's push, drawn. Wind streaks race across the deck in
 * the push direction, flags along both edges stream downwind and snap with the
 * gusts, an overhead banner billows, and white chevrons slide sideways across
 * the lanes. In a lull everything sags, so the rhythm of the gusts is readable.
 */

const FLAG_SPACING = 12
const STREAKS = 18
const FLAG_LENGTH = 1.15
const POLE_HEIGHT = 3.3
const WIND_FLOOR = new THREE.Color(0.55, 0.62, 0.7)
const FLOOR_SHARES = [0.3, 0.7] as const

export const crosswind: EventBuilder = (event, { route, parts, style }) => {
  const d0 = fromQ(event.dist)
  const length = fromQ(event.length)
  const direction = Math.sign(event.amplitude) || 1
  const reference = Math.max(1, Math.abs(event.amplitude))
  const flagColor = (style.id === 'coast' ? PAINT : new THREE.Color(0.8, 0.82, 0.86)).clone().multiplyScalar(1.6)
  const color = new THREE.Color()
  const poles: { d: number; side: -1 | 1; seed: number }[] = []
  for (let d = d0 - 24; d < d0 + length; d += FLAG_SPACING) {
    for (const side of [-1, 1] as const) poles.push({ d, side, seed: (d * 0.37 + side) % 1 })
  }
  let strength = 0

  return {
    from: d0 - 26,
    to: d0 + length,
    draw(clock, frame) {
      const target = Math.min(1, Math.abs(clock.push) / reference)
      strength += (target - strength) * (1 - Math.exp(-6 * frame.dt))
      const centre = route.pathOffset(event.path, d0 + length / 2)
      const half = route.halfWidth(event.path, d0 + length / 2)

      for (const pole of poles) {
        const edge = edgeLateral(route, event.path, pole.d, pole.side) + pole.side * 0.55
        parts.put('body', pole.d, edge, POLE_HEIGHT / 2, 0.08, POLE_HEIGHT, 0.08, STEEL_LIGHT)
        const droop = (1 - strength) * 1.25
        const flutter = Math.sin(frame.time * (9 + strength * 9) + pole.seed * 20) * (0.08 + 0.3 * strength)
        const reach = FLAG_LENGTH / 2
        const lateral = edge + direction * Math.cos(droop) * reach
        const height = POLE_HEIGHT - 0.35 - Math.sin(droop) * reach
        parts.put('body', pole.d, lateral, height, FLAG_LENGTH, 0.62, 0.03, flagColor, flutter, 0, -direction * droop)
      }

      if (strength > 0.02) {
        for (let i = 0; i < STREAKS; i++) {
          const along = d0 + ((i + 0.5) / STREAKS) * length
          const height = 0.4 + ((i * 7) % 6) * 0.5
          const offset = (((i * 13) % 7) - 3) * half * 0.18
          color.setRGB(strength * 0.95, (i * 0.618) % 1, direction > 0 ? 1 : 0)
          parts.put('wind', along, centre + offset, height, half * 2.4, 0.22, 1, color)
        }
        for (const share of FLOOR_SHARES) {
          parts.put('floor', d0 + length * share, centre, 0.03, 4, 1, half * 2 - 0.8, color.copy(WIND_FLOOR).multiplyScalar(0.4 + 0.6 * strength), -direction * Math.PI / 2)
        }
      }

      const bannerD = d0 + length * 0.5
      for (const side of SIDES) {
        parts.put('body', bannerD, edgeLateral(route, event.path, bannerD, side) + side * 0.5, 2.9, 0.16, 5.8, 0.16, STEEL)
      }
      const billow = Math.sin(frame.time * (5 + strength * 8)) * (0.05 + 0.35 * strength)
      parts.put('body', bannerD, centre, 5.2, half * 2 + 0.8, 0.95, 0.04, flagColor, 0, billow, 0)
    },
  }
}
