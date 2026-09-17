import { relayLeg } from '@nim-relay/game-engine'
import { skilledBot, sloppyBot } from '@nim-relay/game-engine/src/relay-leg/test-bots'

/**
 * A deterministic courier for dev captures, tests and the lifecycle E2E autopilot. Its racing is
 * the engine's own skilled courier (it predicts its lane spring and reads gates, hazards, world
 * events, gaps, forks, relay cuts it is fast enough for, and the ghost's line to draft), so what
 * it does is always legal play under the current rules. On top of that it can hold a nudge so two
 * bots never share a line, hesitate like a slower runner, and act out an edge grind or a fall on
 * cue so those moments can be captured.
 */

export interface BotOptions {
  fork: 'safe' | 'risk'
  /** Ticks of hesitation: every input is the one it chose this many ticks earlier. */
  lag?: number
  /** Held nudge, -8..8, so a ghost and a racer never ride the exact same line. */
  bias?: number
  /** A clumsier courier that reads the road late and overshoots lanes: a beatable ghost. */
  sloppy?: boolean
  /** Metres into the leg from which the bot rides into the next rail edge, grinds, then saves. */
  grindAt?: number
  /** Metres into the leg from which the bot rides off the next open edge. */
  fallAt?: number
}

const ONE = 65536
const IDLE: relayLeg.Input = { shift: 0, nudge: 0, action: 0 }
/** Ticks a scripted grind holds the rail before steering off it (every tier's window is longer). */
const GRIND_HOLD_TICKS = 24
const KEYFRAME_TICKS = 24

type Script = { kind: 'grind' | 'fall'; from: number; done: boolean; side: -1 | 1 | 0; grindTick: number }

export function createBot(options: BotOptions): (state: relayLeg.State) => relayLeg.Input {
  const skill = options.sloppy ? sloppyBot(options.fork) : skilledBot(options.fork)
  const bias = Math.max(-relayLeg.NUDGE_RANGE, Math.min(relayLeg.NUDGE_RANGE, Math.round(options.bias ?? 0)))
  const lag = Math.max(0, Math.round(options.lag ?? 0))
  const scripts: Script[] = []
  if (options.grindAt !== undefined) scripts.push({ kind: 'grind', from: options.grindAt * ONE, done: false, side: 0, grindTick: -1 })
  if (options.fallAt !== undefined) scripts.push({ kind: 'fall', from: options.fallAt * ONE, done: false, side: 0, grindTick: -1 })
  const history: relayLeg.Input[] = []

  return state => {
    const scripted = runScripts(state, scripts)
    if (scripted) return scripted
    const chosen = skill(state)
    const input: relayLeg.Input = chosen.nudge === 0 && bias !== 0 && state.motion === 'riding' ? { ...chosen, nudge: bias } : chosen
    if (lag === 0) return input
    history.push(input)
    return history.length > lag ? history.shift()! : IDLE
  }
}

/** The scripted edge moments, in order; null once none of them wants the controls. */
function runScripts(state: relayLeg.State, scripts: Script[]): relayLeg.Input | null {
  for (const script of scripts) {
    if (script.done || state.dist < script.from) continue
    if (state.motion === 'falling' || state.motion === 'tethering') {
      if (script.kind === 'fall') script.done = true
      return IDLE
    }
    if (state.motion === 'grinding') {
      const side = state.edgeSide < 0 ? -1 : 1
      if (script.kind === 'fall') return { shift: side, nudge: 0, action: 0 }
      if (script.grindTick < 0) script.grindTick = state.tick
      if (state.tick - script.grindTick < GRIND_HOLD_TICKS) return IDLE
      script.done = true
      return { shift: side === 1 ? -1 : 1, nudge: 0, action: 0 }
    }
    if (state.motion !== 'riding') return null
    const layout = relayLeg.laneLayoutAt(state.track, state.dist, relayLeg.activePathAt(state.track, state.dist, state.path))
    const wanted: relayLeg.EdgeKind = script.kind === 'grind' ? 'rail' : 'open'
    if (script.side === 0) {
      // The nearer edge of the wanted kind, so the courier peels off to it instead of crossing the road.
      const near: -1 | 1 = state.x < 0 ? -1 : 1
      const kindOn = (side: -1 | 1): relayLeg.EdgeKind => (side < 0 ? layout.leftEdge : layout.rightEdge)
      script.side = kindOn(near) === wanted ? near : kindOn(near === 1 ? -1 : 1) === wanted ? (near === 1 ? -1 : 1) : 0
      if (script.side === 0) return null
    }
    const edgeSlot = script.side * (layout.count + 1)
    return { shift: state.targetLane === edgeSlot ? 0 : script.side, nudge: 0, action: 0 }
  }
  return null
}

/** Plays a whole leg headless and returns the canonical trace, its result and the final state. */
export function playBotLeg(config: relayLeg.Config, options: BotOptions): { trace: relayLeg.Sample[]; result: relayLeg.Result; state: relayLeg.State } {
  const bot = createBot(options)
  let state = relayLeg.createState(config)
  const trace: relayLeg.Sample[] = []
  let lastTick = 0
  while (!state.finished) {
    const input = bot(state)
    const previous = trace.at(-1)
    if (!previous || input.shift !== 0 || input.action !== 0 || previous[2] !== input.nudge || state.tick - lastTick >= KEYFRAME_TICKS) {
      trace.push([state.tick - lastTick, input.shift, input.nudge, input.action])
      lastTick = state.tick
    }
    state = relayLeg.step(state, input)
  }
  return { trace, result: relayLeg.finalize(state, trace), state }
}
