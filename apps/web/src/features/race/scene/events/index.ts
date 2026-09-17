import type * as THREE from 'three'
import type { relayLeg } from '@nim-relay/game-engine'
import type { QualitySettings } from '../quality'
import type { Route } from '../route'
import type { WorldKit } from '../worlds/types'
import { bridgeBreak } from './bridge-break'
import { createEventClock, readEventClock, type EventBuilder, type EventClock, type EventFrame, type EventVisual } from './clock'
import { collapsingGantry } from './collapsing-gantry'
import { crosswind } from './crosswind'
import { dronePattern } from './drone-pattern'
import { FallDebris } from './falls'
import { laneClosure } from './lane-closure'
import { maintenanceDrone } from './maintenance-drone'
import { EventParts } from './parts'
import { pulseTunnel } from './pulse-tunnel'
import { risingBridge } from './rising-bridge'
import { createSignage } from './signs'
import { transitCrossing } from './transit-crossing'

/**
 * World events on the route: one visual per engine WorldEvent, clocked from the
 * simulation state every frame, plus the route's diegetic signage and the
 * debris of falls. Events draw through a shared pool of instanced parts, so
 * the whole system costs a few draw calls.
 */

const BUILDERS: Readonly<Record<relayLeg.WorldEventKind, EventBuilder>> = {
  'lane-closure': laneClosure,
  'maintenance-drone': maintenanceDrone,
  'rising-bridge': risingBridge,
  'transit-crossing': transitCrossing,
  crosswind,
  'collapsing-gantry': collapsingGantry,
  'drone-pattern': dronePattern,
  'pulse-tunnel': pulseTunnel,
  'bridge-break': bridgeBreak,
}

/** Metres behind the courier that event visuals keep drawing, for the chase camera. */
const VIEW_BEHIND = 30

export interface WorldEventsInput {
  state: relayLeg.State
  /** 0..1 progress into the next tick, as the courier is interpolated. */
  alpha: number
  /** The courier's visual route distance, metres. */
  dist: number
  camera: THREE.Camera
}

export interface WorldEvents {
  update(input: WorldEventsInput, time: number): void
  dispose(): void
}

interface Entry {
  event: relayLeg.WorldEvent
  visual: EventVisual
  clock: EventClock
}

export function createWorldEvents(scene: THREE.Scene, route: Route, kit: WorldKit, quality: QualitySettings): WorldEvents {
  const parts = new EventParts(route, quality.tier !== 'low')
  scene.add(parts.group)
  const signage = createSignage(route)
  scene.add(signage.group)
  const context = { route, style: kit.style, quality, parts }
  const entries: Entry[] = route.track.events.map(event => ({ event, visual: BUILDERS[event.kind](event, context), clock: createEventClock() }))
  const falls = new FallDebris(route, parts)
  let frame: EventFrame | null = null
  let lastTime: number | null = null

  return {
    update(input, time) {
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - lastTime))
      lastTime = time
      frame ??= { state: input.state, alpha: 0, dist: 0, time: 0, dt: 0, camera: input.camera }
      frame.state = input.state
      frame.alpha = input.alpha
      frame.dist = input.dist
      frame.time = time
      frame.dt = dt
      frame.camera = input.camera
      const near = input.dist - VIEW_BEHIND
      const far = input.dist + quality.drawDistance
      parts.begin()
      for (const entry of entries) {
        if (entry.visual.to < near || entry.visual.from > far) continue
        readEventClock(entry.event, input.state, input.alpha, entry.clock)
        entry.visual.draw(entry.clock, frame)
      }
      falls.draw(input.state, time)
      parts.end(time)
    },
    dispose() {
      for (const entry of entries) entry.visual.dispose?.()
      parts.dispose()
      signage.dispose()
    },
  }
}
