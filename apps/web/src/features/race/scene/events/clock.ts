import type * as THREE from 'three'
import { relayLeg } from '@nim-relay/game-engine'
import type { QualitySettings } from '../quality'
import { Q, type Route } from '../route'
import type { WorldStyle } from '../worlds/types'
import type { EventParts } from './parts'

/**
 * How far along its engine timeline a world event is on the frame being drawn.
 * Phase, progress, collision and body positions come from the engine's own
 * event rules at the rendered tick; only the blend toward the next tick is
 * added, so motion stays smooth between 60 Hz steps without leading the truth.
 */

export interface EventClock {
  phase: relayLeg.EventPhase
  /** 0..1 through the current phase. */
  progress: number
  /** Ticks since the trigger including the frame's tick fraction, -1 while dormant. */
  age: number
  collision: relayLeg.CollisionClass
  /** Crosswind push right now, signed millimetres per tick. */
  push: number
}

export function createEventClock(): EventClock {
  return { phase: 'dormant', progress: 0, age: -1, collision: relayLeg.COLLISION.NONE, push: 0 }
}

export function readEventClock(event: relayLeg.WorldEvent, state: relayLeg.State, alpha: number, out: EventClock): EventClock {
  const age = relayLeg.eventAge(event, state.eventTicks, state.tick)
  out.phase = relayLeg.eventPhase(event, age)
  out.collision = relayLeg.eventCollision(event, age)
  out.push = relayLeg.eventPush(event, age)
  if (age < 0) {
    out.age = -1
    out.progress = 0
    return out
  }
  out.age = age + alpha
  const now = relayLeg.eventProgress(event, age) / Q
  const next = relayLeg.eventProgress(event, age + 1) / Q
  out.progress = relayLeg.eventPhase(event, age + 1) === out.phase ? now + (next - now) * alpha : now
  return out
}

/** Lateral centre (metres, event path frame) of an event body on the drawn frame. */
export function eventBodyLateral(event: relayLeg.WorldEvent, clock: EventClock, laneWidth: number, index: number): number {
  const age = Math.max(0, Math.floor(clock.age))
  const width = Math.round(laneWidth * Q)
  const now = relayLeg.eventBodyX(event, age, width, index)
  const next = relayLeg.eventBodyX(event, age + 1, width, index)
  const blend = clock.age < 0 ? 0 : clock.age - age
  return (now + (next - now) * blend) / Q
}

export interface EventContext {
  route: Route
  style: WorldStyle
  quality: QualitySettings
  parts: EventParts
}

export interface EventFrame {
  state: relayLeg.State
  alpha: number
  /** The courier's visual route distance, metres. */
  dist: number
  time: number
  dt: number
  camera: THREE.Camera
}

export interface EventVisual {
  /** Route distances between which the visual is worth drawing. */
  from: number
  to: number
  draw(clock: EventClock, frame: EventFrame): void
  dispose?(): void
}

export type EventBuilder = (event: relayLeg.WorldEvent, context: EventContext) => EventVisual
