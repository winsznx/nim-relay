import * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import { fromQ, type Route } from '../route'
import type { EventParts } from './parts'
import { AMBER, AMBER_LOW, SIDES, STEEL, blink, edgeLateral } from './kit'

/**
 * Speed gate beside a gated launch ramp: two light columns that fill with the
 * courier's speed against the event's threshold (millimetres per tick). Amber
 * while short of it, gold and pulsing once fast enough to clear the gap.
 */

const SEGMENTS = 9
const COLUMN_HEIGHT = 3.4
const GOLD_GATE = new THREE.Color(4.2, 2.3, 0.45)

export interface GatedRamp {
  ramp: relayLeg.Zone
  from: number
  to: number
}

/** The ramp inside a gating event's span on its path, if the route has one. */
export function gatedRamp(track: relayLeg.Track, event: relayLeg.WorldEvent): GatedRamp | null {
  const ramp = track.ramps.find(zone => zone.path === event.path && zone.from >= event.dist && zone.to <= event.dist + event.length)
  return ramp ? { ramp, from: fromQ(ramp.from), to: fromQ(ramp.to) } : null
}

/** The gap a gated ramp launches over: the first gap on the same path after the ramp. */
export function gapAfter(track: relayLeg.Track, gated: GatedRamp): { from: number; to: number } | null {
  const gap = track.gaps.find(zone => zone.path === gated.ramp.path && zone.from >= gated.ramp.to)
  return gap ? { from: fromQ(gap.from), to: fromQ(gap.to) } : null
}

export function drawSpeedGate(parts: EventParts, route: Route, event: relayLeg.WorldEvent, gated: GatedRamp, state: relayLeg.State, time: number, color: THREE.Color): void {
  const threshold = (Math.abs(event.amplitude) * 65536) / 1000
  const ratio = threshold > 0 ? state.speed / threshold : 1
  const clear = ratio >= 1
  const lit = Math.min(SEGMENTS, Math.floor(Math.min(1, ratio) * SEGMENTS))
  const d = gated.from - 1.5
  for (const side of SIDES) {
    const lateral = edgeLateral(route, event.path, d, side) + side * 0.7
    parts.put('body', d, lateral, COLUMN_HEIGHT / 2, 0.34, COLUMN_HEIGHT + 0.3, 0.34, STEEL)
    for (let i = 0; i < SEGMENTS; i++) {
      const on = i < lit
      const lamp = clear ? color.copy(GOLD_GATE).multiplyScalar(0.55 + 0.45 * blink(time, 4, i * 0.05)) : on ? AMBER : AMBER_LOW
      parts.put('lamp', d - 0.19, lateral, 0.35 + (i + 0.5) * (COLUMN_HEIGHT / SEGMENTS), 0.24, COLUMN_HEIGHT / SEGMENTS - 0.08, 0.04, lamp)
    }
  }
}
