import * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import { Q, createPathLanes, type Route } from '../route'

/**
 * Shared vocabulary for world events. Amber means something is about to happen,
 * red means it is dangerous now, gold stays reserved for opportunity.
 */

export const AMBER = new THREE.Color(3.4, 1.6, 0.18)
export const AMBER_LOW = new THREE.Color(0.55, 0.26, 0.03)
export const RED = new THREE.Color(3.8, 0.24, 0.26)
export const RED_LOW = new THREE.Color(0.5, 0.03, 0.04)
export const WHITE_LAMP = new THREE.Color(2.4, 2.3, 2.1)
export const COOL_LAMP = new THREE.Color(1.3, 1.7, 2.4)
export const OFF = new THREE.Color(0, 0, 0)
export const STEEL = new THREE.Color(0.09, 0.095, 0.11)
export const STEEL_LIGHT = new THREE.Color(0.3, 0.31, 0.34)
export const PAINT = new THREE.Color(0.95, 0.58, 0.05)
export const ORANGE_STRIPE = new THREE.Color(1.1, 0.34, 0.02)
export const RED_STRIPE = new THREE.Color(0.85, 0.04, 0.05)
export const FLOOR_AMBER = new THREE.Color(1.2, 0.7, 0.08)
export const FLOOR_RED = new THREE.Color(1.1, 0.05, 0.06)

/** Left and right, for per-frame loops that must not allocate. */
export const SIDES = [-1, 1] as const

export function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/** 1 or 0 on a square wave of `rate` flashes per second. */
export function blink(time: number, rate: number, phase = 0): number {
  return (time * rate + phase) % 1 < 0.5 ? 1 : 0
}

export interface LaneRun {
  low: number
  high: number
}

/** Contiguous runs of lane slots, merged the way the engine merges blocked lanes. */
export function laneRuns(lanes: readonly number[]): LaneRun[] {
  const sorted = [...lanes].sort((a, b) => a - b)
  const runs: LaneRun[] = []
  for (const slot of sorted) {
    const last = runs[runs.length - 1]
    if (last && slot === last.high + 2) last.high = slot
    else runs.push({ low: slot, high: slot })
  }
  return runs
}

export interface Extent {
  left: number
  right: number
}

/**
 * Lateral extent (metres from the main centre line) the engine blocks for a run
 * of lanes: lane centres inset by the hit margin, or the whole road with its
 * shoulders when the run covers every lane.
 */
const extentLanes = createPathLanes()

export function blockedExtent(route: Route, path: relayLeg.Path, d: number, run: LaneRun, out: Extent): Extent {
  const lanes = route.lanes(path, d, extentLanes)
  const centre = route.pathOffset(path, d)
  const half = lanes.width / 2 - relayLeg.HIT_MARGIN / Q
  if (run.low <= 1 - lanes.count && run.high >= lanes.count - 1) {
    const edge = (lanes.count * lanes.width) / 2 + lanes.shoulder
    out.left = centre - edge
    out.right = centre + edge
    return out
  }
  out.left = centre + (run.low * lanes.width) / 2 - half
  out.right = centre + (run.high * lanes.width) / 2 + half
  return out
}

/** Distance from a path's centre line to its road edge on `side`, metres. */
export function edgeLateral(route: Route, path: relayLeg.Path, d: number, side: -1 | 1): number {
  return route.pathOffset(path, d) + side * route.halfWidth(path, d)
}
