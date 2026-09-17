import { relayLeg } from '@nim-relay/game-engine'
import { flowTier, type FlowTier } from './flow-tier'

/**
 * Drives one relay leg: a fixed 60 Hz accumulator stepping the deterministic
 * engine, input trace recording, the ghost of the previous runner, phase timing
 * for the opening and finish, and verification of the finished run by replaying
 * its own trace. React reads throttled snapshots; the renderer reads a mutable
 * render snapshot every frame and never writes simulation state.
 */

export type RacePhase = 'arrival' | 'catch' | 'racing' | 'paused' | 'finished'
export type RaceMode = 'relay' | 'practice' | 'daily' | 'watch'
export type Leader = 'you' | 'ghost' | 'tied'

export interface GhostRun {
  /** The ghost's own leg config: same seed, world and tier, its own opening FLOW and ghostline. */
  config: relayLeg.Config
  trace: relayLeg.InputTrace
  name: string
  country?: string | null
  timeMs: number
}

/**
 * baton-separate: the scene lifted the baton out of the courier's hand after the finish.
 * overtake/overtaken: only for a ghost raced without a ghostline; the engine raises
 * GHOST_OVERTAKE and GHOST_OVERTAKEN itself when it has one.
 */
export type RaceCueKind = 'catch' | 'go' | 'approach' | 'overtake' | 'overtaken' | 'finish' | 'baton-separate'
/** The scene adds `echo` when the courier passes a Relay Echo standing on its path. */
export type RaceCue = { kind: 'events'; tick: number; events: number } | { kind: 'echo'; tick: number; echoId: string } | { kind: RaceCueKind; tick: number }

export interface RaceSnapshot {
  phase: RacePhase
  mode: RaceMode
  tick: number
  /** 0..1 route progress of the courier. */
  progress: number
  ghostProgress: number | null
  /** 0..1 */
  flow: number
  flowTier: FlowTier
  /** Share of the current Relay Rush still to run, 0..1, or null outside a rush. */
  rush: number | null
  motion: relayLeg.Motion
  /** -1 left, 1 right, 0 none: the edge being ground or fallen from. */
  edgeSide: -1 | 0 | 1
  /** The courier is on a shoulder, outside the lanes, heading for an edge. */
  shoulder: boolean
  /** Seconds the ghost is ahead at the courier's position; negative when the courier leads. */
  ghostDelta: number | null
  leader: Leader
  approaching: boolean
  result: relayLeg.Result | null
  trace: relayLeg.InputTrace | null
  divergence: boolean
  metrics: Readonly<relayLeg.Metrics>
}

export interface RenderSnapshot {
  phase: RacePhase
  /** Phase the race returns to from pause. */
  activePhase: Exclude<RacePhase, 'paused'>
  /** Milliseconds spent in the opening (arrival then catch), excluding pauses. */
  openingElapsedMs: number
  openingMs: number
  catchMs: number
  /** Milliseconds since the finish line. */
  finishedMs: number
  /** 0..1 progress into the next tick, for interpolating between `previous` and `state`. */
  alpha: number
  state: relayLeg.State
  previous: relayLeg.State
  ghost: relayLeg.State | null
  ghostPrevious: relayLeg.State | null
  /** Events of every tick stepped since the previous frame. */
  frameEvents: number
  ghostFrameEvents: number
  ghostDelta: number | null
  approaching: boolean
}

export interface ControllerOptions {
  mode: RaceMode
  ghost?: GhostRun | null
  /** Watch mode plays this trace instead of reading input. */
  playback?: relayLeg.InputTrace | null
  /** Length of the arrival cinematic before the catch beat. */
  openingMs?: number
  catchMs?: number
  /** Dev autopilot; its inputs are recorded and verified like a player's. */
  autopilot?: ((state: relayLeg.State) => relayLeg.Input) | null
  /** Longest wall-clock slice a single frame may simulate. */
  maxFrameMs?: number
  /**
   * Longest slice a single frame may advance the opening cinematic. Kept short so
   * a slow first frame (shader compilation, asset streaming) pauses the arrival
   * instead of skipping it.
   */
  maxOpeningFrameMs?: number
  /** Metres before the finish where the approach begins. */
  approachMetres?: number
}

export const TICK_MS = 1000 / relayLeg.TICK_RATE
const KEYFRAME_TICKS = 24
const DEFAULT_CATCH_MS = 1200
const PUBLISH_INTERVAL_MS = 50
const LEAD_HYSTERESIS_SECONDS = 0.06
/** A lane flick waits this long for its tick; flicks inside it queue and apply one tick apart. */
export const SHIFT_QUEUE_MS = 150
const SHIFT_QUEUE_LIMIT = 4

interface PreparedGhost {
  run: GhostRun
  distances: Int32Array
  ticks: number
  cursor: relayLeg.InputCursor
}

interface QueuedShift {
  direction: -1 | 1
  at: number
}

/** Riding outside the outer lanes, between them and the road edge. */
function onShoulder(state: relayLeg.State): boolean {
  if (state.motion !== 'riding') return false
  const layout = relayLeg.laneLayoutAt(state.track, state.dist, relayLeg.activePathAt(state.track, state.dist, state.path))
  return Math.abs(state.x) > relayLeg.laneEdgeOf(layout)
}

function sameTrack(a: relayLeg.Config, b: relayLeg.Config): boolean {
  return a.seed === b.seed && a.world === b.world && a.tier === b.tier
}

/** Replays a ghost once up front; returns null for anything that is not a valid run of this track. */
function prepareGhost(config: relayLeg.Config, run: GhostRun | null | undefined): PreparedGhost | null {
  if (!run || !sameTrack(config, run.config)) return null
  try {
    const cursor = new relayLeg.InputCursor(run.trace)
    let state = relayLeg.createState(run.config)
    const distances = new Int32Array(relayLeg.MAX_TICKS + 1)
    distances[0] = state.dist
    while (!state.finished) {
      state = relayLeg.step(state, cursor.at(state.tick))
      distances[state.tick] = state.dist
    }
    return { run, distances, ticks: state.tick, cursor: new relayLeg.InputCursor(run.trace) }
  } catch {
    return null
  }
}

export class RelayLegController {
  readonly config: relayLeg.Config
  readonly mode: RaceMode
  readonly ghostRun: GhostRun | null

  private readonly listeners = new Set<() => void>()
  private readonly cueListeners = new Set<(cue: RaceCue) => void>()
  private readonly ghost: PreparedGhost | null
  private readonly playbackCursor: relayLeg.InputCursor | null
  private readonly playbackTrace: relayLeg.InputTrace | null
  private readonly autopilot: ((state: relayLeg.State) => relayLeg.Input) | null
  private readonly maxFrameMs: number
  private readonly maxOpeningFrameMs: number
  private readonly approachDist: number

  private readonly render: RenderSnapshot
  private published: RaceSnapshot
  private lastPublishAt = Number.NEGATIVE_INFINITY
  private lastTime: number | null = null
  private clock = 0
  private accumulator = 0
  private nudge = 0
  private pendingAction: 0 | 1 | 2 = 0
  private readonly shifts: QueuedShift[] = []
  private readonly recorded: relayLeg.Sample[] = []
  private lastSampleTick = 0
  private ghostIndex = 0
  private leader: Leader = 'tied'
  /** Ticks the current Relay Rush started with, for draining it; 0 outside a rush. */
  private rushLength = 0

  constructor(config: relayLeg.Config, options: ControllerOptions) {
    relayLeg.validateConfig(config)
    this.config = config
    this.mode = options.mode
    this.ghost = prepareGhost(config, options.ghost)
    this.ghostRun = this.ghost?.run ?? null
    this.playbackTrace = options.mode === 'watch' ? (options.playback ?? null) : null
    if (options.mode === 'watch' && !this.playbackTrace) throw new RangeError('Watch mode needs a trace')
    this.playbackCursor = this.playbackTrace ? new relayLeg.InputCursor(this.playbackTrace) : null
    this.autopilot = options.mode === 'watch' ? null : (options.autopilot ?? null)
    this.maxFrameMs = options.maxFrameMs ?? 250
    this.maxOpeningFrameMs = options.maxOpeningFrameMs ?? 50

    const state = relayLeg.createState(config)
    this.approachDist = Math.max(0, state.track.finishDist - Math.round((options.approachMetres ?? 170) * 65536))
    const ghostState = this.ghost ? relayLeg.createState(this.ghost.run.config) : null
    this.render = {
      phase: 'arrival',
      activePhase: 'arrival',
      openingElapsedMs: 0,
      openingMs: Math.max(0, options.openingMs ?? 2400),
      catchMs: options.catchMs ?? DEFAULT_CATCH_MS,
      finishedMs: 0,
      alpha: 0,
      state,
      previous: state,
      ghost: ghostState,
      ghostPrevious: ghostState,
      frameEvents: 0,
      ghostFrameEvents: 0,
      ghostDelta: this.ghost || config.ghostline ? 0 : null,
      approaching: false,
    }
    this.published = this.buildSnapshot(null, null, false)
  }

  get isWatch(): boolean {
    return this.mode === 'watch'
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): RaceSnapshot => this.published

  getRenderSnapshot = (): RenderSnapshot => this.render

  onCue(listener: (cue: RaceCue) => void): () => void {
    this.cueListeners.add(listener)
    return () => {
      this.cueListeners.delete(listener)
    }
  }

  /** One lane shift. Flicks that arrive together queue and apply on consecutive ticks. */
  shift(direction: -1 | 1): void {
    if (this.render.phase !== 'racing' || (direction !== -1 && direction !== 1)) return
    if (this.shifts.length >= SHIFT_QUEUE_LIMIT) this.shifts.shift()
    this.shifts.push({ direction, at: this.clock })
  }

  /** Held fine offset inside the lane, -NUDGE_RANGE..NUDGE_RANGE; 0 lets the courier magnetize to its lane centre. */
  setNudge(value: number): void {
    if (!Number.isFinite(value)) return
    this.nudge = Math.max(-relayLeg.NUDGE_RANGE, Math.min(relayLeg.NUDGE_RANGE, Math.round(value)))
  }

  jump(): void {
    if (this.render.phase === 'racing') this.pendingAction = relayLeg.ACTION_JUMP
  }

  slide(): void {
    if (this.render.phase === 'racing') this.pendingAction = relayLeg.ACTION_SLIDE
  }

  pause(): void {
    const phase = this.render.phase
    if (phase === 'paused' || phase === 'finished') return
    this.render.activePhase = phase
    this.render.phase = 'paused'
    this.pendingAction = 0
    this.shifts.length = 0
    this.lastTime = null
    this.publish(true)
  }

  resume(): void {
    if (this.render.phase !== 'paused') return
    this.render.phase = this.render.activePhase
    this.lastTime = null
    this.publish(true)
  }

  /** Cuts the arrival short; the catch beat still plays so the baton is always caught. */
  skipOpening(): void {
    if (this.render.phase !== 'arrival') return
    this.render.openingElapsedMs = this.render.openingMs
    this.enter('catch')
  }

  /** Advances the race to wall-clock time `now` (ms). Call once per animation frame. */
  frame(now: number): void {
    if (!Number.isFinite(now)) return
    const elapsed = this.lastTime === null ? 0 : Math.max(0, Math.min(this.maxFrameMs, now - this.lastTime))
    this.lastTime = now
    const render = this.render
    render.frameEvents = 0
    render.ghostFrameEvents = 0

    switch (render.phase) {
      case 'paused':
        return
      case 'arrival':
      case 'catch':
        this.advanceOpening(Math.min(elapsed, this.maxOpeningFrameMs), now)
        return
      case 'racing':
        this.advanceRace(elapsed, now)
        return
      case 'finished':
        render.finishedMs += elapsed
        return
    }
  }

  private advanceOpening(elapsed: number, now: number): void {
    const render = this.render
    render.openingElapsedMs += elapsed
    if (render.phase === 'arrival' && render.openingElapsedMs >= render.openingMs) this.enter('catch')
    const goAt = render.openingMs + render.catchMs
    if (render.phase === 'catch' && render.openingElapsedMs >= goAt) {
      const overflow = render.openingElapsedMs - goAt
      render.openingElapsedMs = goAt
      this.enter('racing')
      this.emit({ kind: 'go', tick: 0 })
      this.advanceRace(overflow, now)
    }
  }

  private enter(phase: 'catch' | 'racing'): void {
    this.render.phase = phase
    this.render.activePhase = phase
    if (phase === 'catch') this.emit({ kind: 'catch', tick: 0 })
    this.publish(true)
  }

  private advanceRace(elapsed: number, now: number): void {
    const render = this.render
    this.accumulator += elapsed
    while (this.accumulator + 1e-6 >= TICK_MS && !render.state.finished) {
      this.clock += TICK_MS
      this.stepTick()
      this.accumulator -= TICK_MS
    }
    render.alpha = Math.max(0, Math.min(1, this.accumulator / TICK_MS))
    this.updateGhostDelta()
    if (render.state.finished) {
      this.finish()
      return
    }
    if (now - this.lastPublishAt >= PUBLISH_INTERVAL_MS) this.publish(false, now)
  }

  /** The next queued lane shift still inside its window, or 0. */
  private takeShift(): -1 | 0 | 1 {
    while (this.shifts.length > 0) {
      const next = this.shifts.shift()!
      if (this.clock - next.at <= SHIFT_QUEUE_MS) return next.direction
    }
    return 0
  }

  private stepTick(): void {
    const render = this.render
    const state = render.state
    const tick = state.tick
    let input: relayLeg.Input
    if (this.playbackCursor) input = this.playbackCursor.at(tick)
    else if (this.autopilot) input = this.autopilot(state)
    else input = { shift: this.takeShift(), nudge: this.nudge, action: this.pendingAction }
    this.pendingAction = 0

    if (!this.playbackCursor) {
      const previous = this.recorded.at(-1)
      if (!previous || input.shift !== 0 || input.action !== 0 || previous[2] !== input.nudge || tick - this.lastSampleTick >= KEYFRAME_TICKS) {
        this.recorded.push([tick - this.lastSampleTick, input.shift, input.nudge, input.action])
        this.lastSampleTick = tick
      }
    }

    render.previous = state
    render.state = relayLeg.step(state, input)
    const next = render.state
    render.frameEvents |= next.events
    if (next.events !== 0) this.emit({ kind: 'events', tick: next.tick, events: next.events })
    if (next.rushTicks > state.rushTicks) this.rushLength = next.rushTicks
    else if (next.rushTicks === 0) this.rushLength = 0

    if (this.ghost && render.ghost && !render.ghost.finished) {
      render.ghostPrevious = render.ghost
      render.ghost = relayLeg.step(render.ghost, this.ghost.cursor.at(render.ghost.tick))
      render.ghostFrameEvents |= render.ghost.events
    } else if (render.ghost) {
      render.ghostPrevious = render.ghost
    }

    if (!render.approaching && next.dist >= this.approachDist) {
      render.approaching = true
      this.emit({ kind: 'approach', tick: next.tick })
    }
  }

  /**
   * The engine measures the gap to the previous runner's verified ghostline itself. A ghost raced
   * without one (a local practice ghost) is measured here from its replayed distances.
   */
  private updateGhostDelta(): void {
    const render = this.render
    const state = render.state
    if (this.config.ghostline) {
      render.ghostDelta = state.ghostLeadTicks / relayLeg.TICK_RATE
      this.leader = this.nextLeader(render.ghostDelta)
      return
    }
    const ghost = this.ghost
    if (!ghost) return
    while (this.ghostIndex < ghost.ticks && ghost.distances[this.ghostIndex]! < state.dist) this.ghostIndex++
    const delta = (state.tick - this.ghostIndex) / relayLeg.TICK_RATE
    render.ghostDelta = delta
    const next = this.nextLeader(delta)
    if (next !== this.leader) {
      if (this.leader === 'ghost' && next === 'you') this.emit({ kind: 'overtake', tick: state.tick })
      if (this.leader === 'you' && next === 'ghost') this.emit({ kind: 'overtaken', tick: state.tick })
    }
    this.leader = next
  }

  private nextLeader(delta: number): Leader {
    return delta > LEAD_HYSTERESIS_SECONDS ? 'ghost' : delta < -LEAD_HYSTERESIS_SECONDS ? 'you' : this.leader
  }

  private finish(): void {
    const render = this.render
    const trace: relayLeg.InputTrace = this.playbackTrace ?? this.recorded.slice()
    let result: relayLeg.Result | null = null
    let divergence = false
    try {
      const live = relayLeg.finalize(render.state, trace)
      result = relayLeg.replay({ ...this.config, inputTrace: trace })
      divergence = live.resultHash !== result.resultHash
    } catch {
      divergence = true
    }
    render.alpha = 1
    render.phase = 'finished'
    render.activePhase = 'finished'
    this.shifts.length = 0
    this.published = this.buildSnapshot(result, trace, divergence)
    this.emit({ kind: 'finish', tick: render.state.tick })
    for (const listener of this.listeners) listener()
  }

  private buildSnapshot(result: relayLeg.Result | null, trace: relayLeg.InputTrace | null, divergence: boolean): RaceSnapshot {
    const render = this.render
    const state = render.state
    const finish = state.track.finishDist
    const flow = state.flow / 65536
    return {
      phase: render.phase,
      mode: this.mode,
      tick: state.tick,
      progress: Math.min(1, state.dist / finish),
      ghostProgress: render.ghost ? Math.min(1, render.ghost.dist / finish) : null,
      flow,
      flowTier: flowTier(flow, state.rushTicks),
      rush: state.rushTicks > 0 ? Math.min(1, state.rushTicks / Math.max(1, this.rushLength)) : null,
      motion: state.motion,
      edgeSide: state.edgeSide,
      shoulder: onShoulder(state),
      ghostDelta: render.ghostDelta,
      leader: this.leader,
      approaching: render.approaching,
      result,
      trace,
      divergence,
      metrics: state.metrics,
    }
  }

  private publish(force: boolean, now = this.lastTime ?? 0): void {
    if (this.published.phase === 'finished') return
    const previous = this.published
    this.published = this.buildSnapshot(previous.result, previous.trace, previous.divergence)
    this.lastPublishAt = now
    if (force || previous.tick !== this.published.tick || previous.phase !== this.published.phase) {
      for (const listener of this.listeners) listener()
    }
  }

  private emit(cue: RaceCue): void {
    for (const listener of this.cueListeners) listener(cue)
  }
}
