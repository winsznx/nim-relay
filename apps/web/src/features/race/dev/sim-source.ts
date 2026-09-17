import { relayLeg } from '@nim-relay/game-engine'
import type { RaceCue, RenderSnapshot } from '../controller'
import type { RaceSource } from '../scene'
import { createBot, type BotOptions } from './bot'

/**
 * The real engine stepped at 60 Hz by the dev bot, as a render source for the
 * world lab. It fast-forwards headless to `startDist` first, so a capture can
 * begin right before a fork or a world event.
 */

const TICK_MS = 1000 / relayLeg.TICK_RATE
const MAX_FRAME_MS = 100

export interface SimSourceOptions {
  config: relayLeg.Config
  bot: BotOptions
  /** Metres into the leg to fast-forward to before rendering. */
  startDist: number
}

export function createSimSource(options: SimSourceOptions): RaceSource {
  const policy = createBot(options.bot)
  let state = relayLeg.createState(options.config)
  const start = options.startDist * 65536
  while (!state.finished && state.dist < start) state = relayLeg.step(state, policy(state))
  let previous = state
  let accumulator = 0
  let lastNow: number | null = null
  const listeners = new Set<(cue: RaceCue) => void>()
  const snapshot: RenderSnapshot = {
    phase: 'racing', activePhase: 'racing', openingElapsedMs: 0, openingMs: 1, catchMs: 1, finishedMs: 0, alpha: 0,
    state, previous, ghost: null, ghostPrevious: null, frameEvents: 0, ghostFrameEvents: 0, ghostDelta: null, approaching: false,
  }

  return {
    frame(now) {
      accumulator += lastNow === null ? TICK_MS : Math.min(MAX_FRAME_MS, Math.max(0, now - lastNow))
      lastNow = now
      let events = 0
      while (accumulator >= TICK_MS) {
        accumulator -= TICK_MS
        if (state.finished) continue
        previous = state
        state = relayLeg.step(state, policy(state))
        events |= state.events
      }
      snapshot.state = state
      snapshot.previous = previous
      snapshot.alpha = accumulator / TICK_MS
      snapshot.frameEvents = events
    },
    getRenderSnapshot() {
      return snapshot
    },
    onCue(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
