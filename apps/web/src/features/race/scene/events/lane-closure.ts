import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { fromQ } from '../route'
import type { EventBuilder } from './clock'
import { AMBER, AMBER_LOW, FLOOR_AMBER, FLOOR_RED, ORANGE_STRIPE, RED, STEEL, blink, blockedExtent, laneRuns, smooth, type Extent } from './kit'

/**
 * Lane closure: rows of construction barriers slide in from the nearest road
 * edge (or rise through deck hatches for middle lanes) across the closed lanes
 * during the telegraph, with amber strobes and amber chevrons on the deck. Once
 * the engine blocks the lanes the lamps turn red and the deck under them is
 * striped red. Rows are jumpable hurdles, which is what the collision is.
 */

const ROW_SPACING = 7
const SEGMENT = 1.9
const PARKED_OUTSIDE = 1.6
const LIGHT_SPACING = 3.5
/** Up and back offsets of the three lamps in each chevron of an arrow board, pointing toward +1. */
const CHEVRON_DOTS = [[0, 0], [0.32, -0.22], [-0.32, -0.22]] as const

interface Row {
  d: number
  extent: Extent
  /** -1 slides in from the left edge, 1 from the right, 0 rises through the deck. */
  from: -1 | 0 | 1
  edge: number
  stagger: number
}

export const laneClosure: EventBuilder = (event, { route, parts }) => {
  const d0 = fromQ(event.dist)
  const length = fromQ(event.length)
  const runs = laneRuns(event.lanes)
  const rows: Row[] = []
  const count = Math.max(1, Math.floor(length / ROW_SPACING))
  for (let k = 0; k < count; k++) {
    const d = d0 + k * ROW_SPACING + 0.6
    const lanes = route.lanes(event.path, d)
    for (const run of runs) {
      const extent = blockedExtent(route, event.path, d, run, { left: 0, right: 0 })
      const from: -1 | 0 | 1 = run.low <= 1 - lanes.count ? -1 : run.high >= lanes.count - 1 ? 1 : 0
      const edge = from === 0 ? 0 : route.pathOffset(event.path, d) + from * (route.halfWidth(event.path, d) + PARKED_OUTSIDE)
      rows.push({ d, extent, from, edge, stagger: (k / count) * 0.4 })
    }
  }
  const guides = runs.map(run => {
    const lanes = route.lanes(event.path, d0)
    const side = run.low <= 1 - lanes.count ? 1 : -1
    return { run, side }
  })
  const color = new THREE.Color()
  const extent: Extent = { left: 0, right: 0 }

  return {
    from: d0 - 12,
    to: d0 + length,
    draw(clock, frame) {
      const active = clock.collision === relayLeg.COLLISION.LOW
      const triggered = clock.phase !== 'dormant'
      const lamp = active ? RED : triggered ? color.copy(AMBER).multiplyScalar(blink(frame.time, 5)) : color.copy(AMBER_LOW).multiplyScalar(0.4 + 0.6 * blink(frame.time, 1.2))
      for (const row of rows) {
        const moved = active ? 1 : triggered ? smooth((clock.progress - row.stagger) / 0.6) : 0
        const width = row.extent.right - row.extent.left
        const pieces = Math.max(1, Math.round(width / SEGMENT))
        const piece = width / pieces
        for (let i = 0; i < pieces; i++) {
          const home = row.extent.left + piece * (i + 0.5)
          const parked = row.edge + (row.from === -1 ? -(pieces - 1 - i) : i) * piece
          const lateral = row.from === 0 ? home : parked + (home - parked) * moved
          const height = row.from === 0 ? -1.1 + 1.55 * moved : 0.45 + (1 - moved) * 0.35
          parts.put('stripe', row.d, lateral, height, piece - 0.12, 0.9, 0.5, ORANGE_STRIPE)
          parts.put('body', row.d, lateral, height - 0.5, piece - 0.3, 0.1, 0.62, STEEL)
          if (i === 0 || i === pieces - 1) parts.put('lamp', row.d - 0.28, lateral, height + 0.52, 0.2, 0.14, 0.05, lamp)
        }
      }
      for (const { run, side } of guides) {
        blockedExtent(route, event.path, d0, run, extent)
        const boundary = side === 1 ? extent.right + 0.25 : extent.left - 0.25
        for (let d = d0 - 10; d < d0 + length; d += LIGHT_SPACING) {
          const on = active ? 1 : triggered ? blink(frame.time * 1.6 - d * 0.08, 1) : 0.25
          parts.put('beacon', d, boundary, 0.35, 0.16, 0.24, 0.16, color.copy(active ? RED : AMBER).multiplyScalar(on))
          parts.put('body', d, boundary, 0.12, 0.08, 0.24, 0.08, STEEL)
        }
        const centre = (extent.left + extent.right) / 2
        if (triggered) parts.put('floor', d0 + length / 2 - 12, centre, 0.035, extent.right - extent.left - 0.3, 1, length + 24, active ? FLOOR_RED : FLOOR_AMBER)
        const board = d0 + 3.2
        parts.put('body', board, centre, 1.4, 2.2, 1.5, 0.18, STEEL)
        parts.put('body', board + 0.3, centre, 0.35, 1.6, 0.5, 1.2, STEEL)
        for (let step = 0; step < 4; step++) {
          const lit = triggered && Math.floor(frame.time * 6) % 5 >= step
          const x = centre - side * (0.75 - step * 0.45)
          for (const [dy, dx] of CHEVRON_DOTS) {
            parts.put('lamp', board - 0.1, x + side * dx, 1.4 + dy, 0.13, 0.13, 0.04, lit ? AMBER : AMBER_LOW)
          }
        }
      }
    },
  }
}
