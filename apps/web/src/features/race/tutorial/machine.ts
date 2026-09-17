import { relayLeg } from '@nim-relay/game-engine'
import { flowTier } from '../flow-tier'
import { edgeDanger, ghostDraftable, ghostlineAhead, obstacleAhead, roadClearAhead, type ObstacleAhead } from './road-ahead'
import { STEPS_BY_PRIORITY, TUTORIAL_STEPS, isUrgent, priorityOf, type TutorialStepId } from './steps'

/**
 * Decides, once per rendered frame, which coach prompt is on screen. It reads the simulation and never
 * writes it: prompts cannot pause the race, change an input or reach the recorded trace. Every duration
 * counts race ticks, so a paused race freezes the prompts with it.
 *
 * A step completes only when the player answers its prompt while it is showing (or, for the Ghostline
 * and FLOW, when it has been read). A prompt that is not answered leaves the step pending for a later
 * moment or a later run.
 */

const { EVENT } = relayLeg

/** Jump and slide prompts appear this far ahead of their obstacle: 2.5 s. */
export const LOOKAHEAD_TICKS = 150
/** Inside this many ticks of the obstacle a jump or slide is on time, and the prompt says so. */
export const ACTION_WINDOW_TICKS = 30
/** Closer than this, a prompt could not be read and acted on in time. */
const TOO_LATE_TICKS = 24
/** Lane, Ghostline and FLOW prompts wait until the arrival title has cleared. */
export const CALM_START_TICK = 120
/** How far a calm prompt needs the road ahead to stay clear: 2 s. */
export const CALM_TICKS = 120
export const LANE_TIMEOUT_TICKS = 300
export const GHOSTLINE_SHOW_TICKS = 240
/** Drafting only answers the Ghostline prompt once it has been on screen this long. */
export const GHOSTLINE_READ_TICKS = 20
/** The Ghostline prompt waits for a moment the courier is off the line. */
const RECENT_DRAFT_TICKS = 30
export const FLOW_SHOW_TICKS = 210
/** How long a finished prompt plays its exit before it unmounts. */
export const EXIT_TICKS = 18
/** Quiet between prompts, unless the next one is urgent. */
export const QUIET_TICKS = 60
const URGENT_GAP_TICKS = 12
/** Before a calm step that was not answered may ask again in the same run. */
export const REPEAT_TICKS = 240
/** A clear stretch has to last this long before a jump or slide prompt lets its obstacle go. */
export const CLEAR_TICKS = 8
export const MAX_VIEWS_PER_RUN = 3

export interface TutorialObservation {
  /** False before GO, while paused and after the finish: prompts hide and nothing advances. */
  racing: boolean
  /** The courier is closing on the handoff gate, where the race owns the screen. */
  approaching: boolean
  state: relayLeg.State
  /** Event flags of every tick since the previous observation. */
  events: number
  /** The courier jumped by its own input (not a ramp launch) since the previous observation. */
  jumped: boolean
}

export type TutorialEffect =
  /** The step's prompt appeared for the first time this run. */
  | { kind: 'viewed'; step: TutorialStepId }
  | { kind: 'completed'; step: TutorialStepId }
  /** Every step is complete; `step` completed last. */
  | { kind: 'finished'; step: TutorialStepId }

export type CoachStatus = 'showing' | 'done' | 'dismissed'

export interface CoachView {
  step: TutorialStepId
  /** Counts prompts shown this run, so the same step shown again mounts as a new prompt. */
  showing: number
  /** `done` plays the exit of an answered prompt, `dismissed` the exit of one that went unanswered. */
  status: CoachStatus
  /** Jump and slide: the courier is inside the obstacle's action window. */
  now: boolean
  /** Edge: which edge, -1 left or 1 right. 0 for every other step. */
  side: -1 | 0 | 1
  /** Edge: grinding the rail itself rather than riding the shoulder. */
  grinding: boolean
}

interface Prompt {
  step: TutorialStepId
  showing: number
  since: number
  now: boolean
  side: -1 | 0 | 1
  grinding: boolean
  /** Jump and slide: the obstacle this prompt is about. */
  obstacle: ObstacleAhead | null
  /** Jump and slide: first tick the obstacle stopped blocking the courier's line, or -1. */
  clearSince: number
}

interface Exit {
  prompt: Prompt
  status: Exclude<CoachStatus, 'showing'>
  at: number
}

interface StepRun {
  views: number
  hiddenAt: number
  /** Jump and slide: obstacles already prompted for, each asked about once. */
  obstacles: Set<string>
}

type Candidate = Omit<Prompt, 'showing' | 'since' | 'clearSince'>

/** What one frame of the race offers, computed once and shared by every step's rule. */
interface Frame {
  observation: TutorialObservation
  tick: number
  ahead: ObstacleAhead | null
}

export class TutorialMachine {
  private readonly completed: Set<TutorialStepId>
  private readonly runs = new Map<TutorialStepId, StepRun>()
  private active: Prompt | null = null
  private exit: Exit | null = null
  private hiddenAt = Number.NEGATIVE_INFINITY
  private lastDraftTick = Number.NEGATIVE_INFINITY
  private showings = 0
  private ended: boolean
  private current: CoachView | null = null

  constructor(completed: Iterable<TutorialStepId> = []) {
    this.completed = new Set(completed)
    this.ended = this.completed.size === TUTORIAL_STEPS.length
  }

  /** The prompt on screen, or null. A new object only when something visible changed. */
  get view(): CoachView | null {
    return this.current
  }

  /** True once every step is complete or the tutorial was skipped: no prompt shows again. */
  get over(): boolean {
    return this.ended
  }

  isCompleted(step: TutorialStepId): boolean {
    return this.completed.has(step)
  }

  observe(observation: TutorialObservation): TutorialEffect[] {
    const effects: TutorialEffect[] = []
    const tick = observation.state.tick
    if (observation.events & EVENT.DRAFTING) this.lastDraftTick = tick
    if (!observation.racing) {
      this.publish(null)
      return effects
    }
    const frame: Frame = { observation, tick, ahead: obstacleAhead(observation.state, LOOKAHEAD_TICKS) }
    if (this.active) this.follow(this.active, frame, effects)
    if (!this.ended) this.offer(frame, effects)
    if (this.exit && tick - this.exit.at >= EXIT_TICKS) this.exit = null
    this.publish(this.buildView())
    return effects
  }

  /** Ends the tutorial for good. Returns the step on screen when the player skipped, or null. */
  skip(): TutorialStepId | null {
    if (this.ended) return null
    const step = this.active?.step ?? this.exit?.prompt.step ?? null
    this.ended = true
    this.active = null
    this.exit = null
    this.publish(null)
    return step
  }

  private run(step: TutorialStepId): StepRun {
    let run = this.runs.get(step)
    if (!run) {
      run = { views: 0, hiddenAt: Number.NEGATIVE_INFINITY, obstacles: new Set() }
      this.runs.set(step, run)
    }
    return run
  }

  /** Answers, timeouts and the moment passing for the prompt on screen. */
  private follow(prompt: Prompt, frame: Frame, effects: TutorialEffect[]): void {
    const { observation, tick } = frame
    const { events, state } = observation
    const shown = tick - prompt.since
    switch (prompt.step) {
      case 'lane':
        if (events & EVENT.LANE_SHIFT) return this.complete(prompt, tick, effects)
        if (shown >= LANE_TIMEOUT_TICKS || observation.approaching) this.dismiss(prompt, tick)
        return
      case 'jump':
      case 'slide':
        if (prompt.step === 'jump' ? observation.jumped : (events & EVENT.SLIDE) !== 0) return this.complete(prompt, tick, effects)
        return this.followObstacle(prompt, frame)
      case 'ghostline': {
        if (((events & EVENT.DRAFTING) !== 0 && shown >= GHOSTLINE_READ_TICKS) || shown >= GHOSTLINE_SHOW_TICKS) return this.complete(prompt, tick, effects)
        if (!ghostlineAhead(state) || !ghostDraftable(state) || observation.approaching) this.dismiss(prompt, tick)
        return
      }
      case 'edge': {
        if (events & EVENT.EDGE_SAVE) return this.complete(prompt, tick, effects)
        const danger = edgeDanger(state)
        if (danger) {
          prompt.side = danger.side
          prompt.grinding = danger.grinding
          return
        }
        // Back inside the lanes by steering: answered. Anything else (a fall, the tether) ends the moment.
        if (state.motion === 'riding') this.complete(prompt, tick, effects)
        else this.dismiss(prompt, tick)
        return
      }
      case 'flow':
        if (shown >= FLOW_SHOW_TICKS) return this.complete(prompt, tick, effects)
        if (observation.approaching) this.dismiss(prompt, tick)
        return
    }
  }

  /** A jump or slide prompt lasts while its obstacle still blocks the line ahead, moving to the next one of its kind. */
  private followObstacle(prompt: Prompt, frame: Frame): void {
    const { tick, ahead } = frame
    const { state } = frame.observation
    const obstacle = prompt.obstacle
    if (!obstacle || state.dist >= obstacle.dist || state.motion !== 'riding') return this.dismiss(prompt, tick)
    if (ahead && ahead.answer === prompt.step) {
      if (ahead.key !== obstacle.key) this.run(prompt.step).obstacles.add(ahead.key)
      prompt.obstacle = ahead
      prompt.clearSince = -1
      prompt.now = ahead.ticks <= ACTION_WINDOW_TICKS
      return
    }
    // Moving obstacles can slip in and out of the line as the prediction settles; only a lasting clear lets it go.
    if (prompt.clearSince < 0) prompt.clearSince = tick
    else if (tick - prompt.clearSince >= CLEAR_TICKS) this.dismiss(prompt, tick)
  }

  /** Shows the most pressing due step, replacing a calmer prompt when it is urgent. */
  private offer(frame: Frame, effects: TutorialEffect[]): void {
    const candidate = this.due(frame)
    if (!candidate) return
    const { tick } = frame
    if (this.active) {
      const preempts = isUrgent(candidate.step) && priorityOf(candidate.step) < priorityOf(this.active.step)
      if (!preempts) return
      this.dismiss(this.active, tick)
    } else if (tick - this.hiddenAt < (isUrgent(candidate.step) ? URGENT_GAP_TICKS : QUIET_TICKS)) {
      return
    }
    const run = this.run(candidate.step)
    run.views++
    if (candidate.obstacle) run.obstacles.add(candidate.obstacle.key)
    this.showings++
    this.active = { ...candidate, showing: this.showings, since: tick, clearSince: -1 }
    this.exit = null
    if (run.views === 1) effects.push({ kind: 'viewed', step: candidate.step })
  }

  private due(frame: Frame): Candidate | null {
    for (const step of STEPS_BY_PRIORITY) {
      if (this.completed.has(step) || this.active?.step === step) continue
      const run = this.run(step)
      if (run.views >= MAX_VIEWS_PER_RUN) continue
      const candidate = this.candidate(step, run, frame)
      if (candidate) return candidate
    }
    return null
  }

  private candidate(step: TutorialStepId, run: StepRun, frame: Frame): Candidate | null {
    const { observation, tick, ahead } = frame
    const { state, approaching } = observation
    const base: Candidate = { step, now: false, side: 0, grinding: false, obstacle: null }
    if (approaching) return null
    const calmStep = step === 'lane' || step === 'ghostline' || step === 'flow'
    if (calmStep && (tick < CALM_START_TICK || tick - run.hiddenAt < REPEAT_TICKS)) return null
    switch (step) {
      case 'edge': {
        const danger = edgeDanger(state)
        // A wall only bumps the courier back in; there is nothing to save.
        if (!danger || (!danger.grinding && danger.edge === 'wall')) return null
        return { ...base, side: danger.side, grinding: danger.grinding }
      }
      case 'jump':
      case 'slide': {
        if (!ahead || ahead.answer !== step || run.obstacles.has(ahead.key)) return null
        if (ahead.ticks < TOO_LATE_TICKS || state.y !== 0 || state.vy !== 0 || state.stumbleTicks >= ahead.ticks) return null
        return { ...base, obstacle: ahead, now: ahead.ticks <= ACTION_WINDOW_TICKS }
      }
      case 'lane':
        return roadClearAhead(state, CALM_TICKS) ? base : null
      case 'ghostline': {
        if (!ghostDraftable(state) || tick - this.lastDraftTick <= RECENT_DRAFT_TICKS || (ahead && ahead.ticks <= CALM_TICKS)) return null
        return ghostlineAhead(state) ? base : null
      }
      case 'flow': {
        const tier = flowTier(state.flow / 65536, state.rushTicks)
        return tier !== 'low' && state.motion === 'riding' && !ahead ? base : null
      }
    }
  }

  private complete(prompt: Prompt, tick: number, effects: TutorialEffect[]): void {
    this.completed.add(prompt.step)
    effects.push({ kind: 'completed', step: prompt.step })
    this.hide(prompt, tick, 'done')
    if (this.completed.size === TUTORIAL_STEPS.length) {
      this.ended = true
      effects.push({ kind: 'finished', step: prompt.step })
    }
  }

  private dismiss(prompt: Prompt, tick: number): void {
    this.hide(prompt, tick, 'dismissed')
  }

  private hide(prompt: Prompt, tick: number, status: Exit['status']): void {
    this.active = null
    this.exit = { prompt, status, at: tick }
    this.hiddenAt = tick
    this.run(prompt.step).hiddenAt = tick
  }

  private buildView(): CoachView | null {
    if (this.active) return viewOf(this.active, 'showing')
    return this.exit ? viewOf(this.exit.prompt, this.exit.status) : null
  }

  private publish(next: CoachView | null): void {
    const current = this.current
    if (next === current || (next && current && sameView(next, current))) return
    this.current = next
  }
}

function viewOf(prompt: Prompt, status: CoachStatus): CoachView {
  return { step: prompt.step, showing: prompt.showing, status, now: prompt.now, side: prompt.side, grinding: prompt.grinding }
}

function sameView(a: CoachView, b: CoachView): boolean {
  return a.step === b.step && a.showing === b.showing && a.status === b.status && a.now === b.now && a.side === b.side && a.grinding === b.grinding
}
