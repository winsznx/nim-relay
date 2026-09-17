import type { TourEvent, TourProgress } from '@nim-relay/shared'
import type { TourCopy, TourDefinition, TourFallback, TourInteraction, TourMode, TourShape, TourStep } from './types'

/**
 * The tour state machine, free of React and the DOM: everything it touches arrives through `TourControllerDeps`.
 * It never traps the runner: every wait is bounded, a step whose target never shows up is skipped, any error
 * closes the tour, and leaving the tour's screen by other means ends it.
 */

export const LOCATE_TIMEOUT_MS = 2_500
/** How long after a tapped target the navigation that tap causes still counts as part of the tour. */
export const TAP_NAVIGATION_GRACE_MS = 1_500
export const DEFAULT_TARGET_PADDING = 8

export interface TourTrackEvent {
  event: TourEvent
  tourId: string
  version: string
  stepId?: string
  stepNumber?: number
  entryRoute?: string
}

export interface LocateRequest {
  /** Tried in priority order: the step's target first, then its fallbacks. */
  selectors: readonly string[]
  /** Aborted when the step changes, the tour ends or the wait times out. */
  signal: AbortSignal
  /** The step's own target counts as found only once this can measure it. Fallbacks are measured by their box. */
  measure?: TourStep['measure']
}

/** `Target` is what `locate` finds: DOM elements in the app, plain values in tests. */
export interface TourControllerDeps<Target> {
  navigate(path: string, options: { replace: boolean }): void
  currentPath(): string
  subscribeToPath(listener: () => void): () => void
  /** Resolves with the target found and which selector found it, or null once aborted. */
  locate(request: LocateRequest): Promise<{ element: Target; index: number } | null>
  /** Brings a found target into view when it isn't. */
  reveal(element: Target): void
  persist(tourId: string, version: string, state: TourProgress): void
  track(event: TourTrackEvent): void
  reportMissing(message: string): void
  reportError(error: unknown): void
  /** Remembers what had focus; the returned function puts it back if that element is still there. */
  captureFocus(): () => void
  /** Runs `work` after the current event finishes dispatching. */
  defer(work: () => void): void
}

export interface TourStepView<Target = Element> {
  step: TourStep
  index: number
  /** Position among the steps this run hasn't skipped, 1-based. */
  number: number
  total: number
  copy: TourCopy
  interaction: TourInteraction
  shape: TourShape
  padding: number
  /** Null for a centered card. */
  target: Target | null
  /** The selector that found `target`. */
  selector: string | null
  /** The step's own target, as opposed to a fallback, which is measured with `step.measure`. */
  primary: boolean
  status: 'locating' | 'ready'
  /** There is an earlier step to go back to. */
  canGoBack: boolean
  last: boolean
}

export type TourSnapshot<Target = Element> =
  | { phase: 'idle' }
  | { phase: 'step'; runId: number; tour: TourDefinition; mode: TourMode; view: TourStepView<Target> }
  | { phase: 'complete'; runId: number; tour: TourDefinition; mode: TourMode }

interface Run {
  id: number
  tour: TourDefinition
  mode: TourMode
  entryRoute: string
  startPath: string
  index: number
  skipped: Set<number>
  expectedPath: string
  ownNavigation: boolean
  tapGraceUntil: number
  locate: AbortController | null
  timer: ReturnType<typeof setTimeout> | null
  unsubscribePath: () => void
  restoreFocus: () => void
}

const IDLE = { phase: 'idle' } as const

interface Found<Target> {
  element: Target
  selector: string
  fallback: TourFallback | null
}

function targetsOf(step: TourStep): { selector: string; fallback: TourFallback | null }[] {
  if (step.target === null) return []
  const fallbacks = (step.fallbackTargets ?? []).map(item => (typeof item === 'string' ? { target: item } : item))
  return [{ selector: step.target, fallback: null }, ...fallbacks.map(fallback => ({ selector: fallback.target, fallback }))]
}

export class TourController<Target = Element> {
  private snapshot: TourSnapshot<Target> = IDLE
  private readonly listeners = new Set<() => void>()
  private run: Run | null = null
  private runs = 0

  constructor(
    private readonly deps: TourControllerDeps<Target>,
    private readonly locateTimeoutMs = LOCATE_TIMEOUT_MS,
  ) {}

  readonly getSnapshot = (): TourSnapshot<Target> => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get active(): boolean {
    return this.run !== null
  }

  start(tour: TourDefinition, options: { mode: TourMode; entryRoute: string }): void {
    if (this.run) this.close(this.run, null)
    if (tour.steps.length === 0) return
    const run: Run = {
      id: ++this.runs,
      tour,
      mode: options.mode,
      entryRoute: options.entryRoute,
      startPath: this.deps.currentPath(),
      index: -1,
      skipped: new Set(),
      expectedPath: this.deps.currentPath(),
      ownNavigation: false,
      tapGraceUntil: 0,
      locate: null,
      timer: null,
      unsubscribePath: () => undefined,
      restoreFocus: this.deps.captureFocus(),
    }
    this.run = run
    if (run.mode === 'first-run') {
      this.deps.persist(tour.id, tour.version, 'started')
      this.track(run, 'started', null, { entryRoute: run.entryRoute })
    } else {
      this.track(run, 'replayed', null, { entryRoute: run.entryRoute })
    }
    run.unsubscribePath = this.deps.subscribeToPath(() => this.onPathChange(run))
    this.enter(run, 0, 1)
  }

  next(): void {
    const run = this.run
    const view = this.readyView(run)
    if (!run || !view) return
    this.track(run, 'step_completed', view.index)
    const following = this.followingIndex(run, view.index)
    if (following === null) this.complete(run)
    else this.enter(run, following, 1)
  }

  back(): void {
    const run = this.run
    const view = this.readyView(run)
    if (!run || !view) return
    const previous = this.previousIndex(run, view.index)
    if (previous !== null) this.enter(run, previous, -1)
  }

  /** The runner used the target of a tap-target step. The tour moves on once the tap's own navigation has happened. */
  activateTarget(): void {
    const run = this.run
    const view = this.readyView(run)
    if (!run || !view || view.interaction !== 'tap-target') return
    run.tapGraceUntil = Date.now() + TAP_NAVIGATION_GRACE_MS
    const index = view.index
    this.deps.defer(() => {
      if (this.run === run && run.index === index) this.next()
    })
  }

  runSecondaryAction(): void {
    const run = this.run
    const view = this.readyView(run)
    if (!run || !view?.step.secondaryAction) return
    try {
      view.step.secondaryAction.run()
    } catch (error) {
      this.fail(run, error)
    }
  }

  /** Leaves the tour and returns to where it started. From the completion card this is the same as `finish()`. */
  skip(): void {
    const run = this.run
    if (!run) return
    if (this.snapshot.phase === 'complete') {
      this.finish()
      return
    }
    this.track(run, 'skipped', run.index)
    if (run.mode === 'first-run') this.deps.persist(run.tour.id, run.tour.version, 'skipped')
    this.close(run, { path: run.startPath, replace: true })
  }

  /** Closes the completion card: back to where the tour started, or on to `to`. */
  finish(to?: string): void {
    const run = this.run
    if (!run || this.snapshot.phase !== 'complete') return
    this.close(run, to ? { path: to, replace: false } : { path: run.startPath, replace: true })
  }

  /** Something outside the controller failed while the tour was showing, such as rendering its overlay. */
  abort(error: unknown): void {
    if (this.run) this.fail(this.run, error)
  }

  private enter(run: Run, index: number, direction: 1 | -1): void {
    this.cancelLocate(run)
    const step = run.tour.steps[index]
    if (!step) {
      this.complete(run)
      return
    }
    run.index = index
    try {
      step.beforeEnter?.()
      if (step.route) this.navigateWithin(run, step.route)
    } catch (error) {
      this.fail(run, error)
      return
    }
    run.expectedPath = this.deps.currentPath()
    const targets = targetsOf(step)
    if (targets.length === 0) {
      this.show(run, index, null, null)
      return
    }
    this.emitStep(run, this.viewFor(run, index, null, null, 'locating'))
    const locate = new AbortController()
    run.locate = locate
    run.timer = setTimeout(() => locate.abort(), this.locateTimeoutMs)
    this.deps
      .locate({
        selectors: targets.map(item => item.selector),
        signal: locate.signal,
        ...(step.measure ? { measure: step.measure } : {}),
      })
      .then(found => {
        if (this.run !== run || run.locate !== locate) return
        // Aborting a finished wait too releases anything a locator still holds for it.
        this.cancelLocate(run)
        const matched = found ? targets[found.index] : undefined
        if (found && matched) {
          this.deps.reveal(found.element)
          this.show(run, index, { element: found.element, ...matched }, null)
        } else if (step.whenMissing) {
          this.show(run, index, null, step.whenMissing)
        } else {
          this.skipMissing(run, index, direction, targets.map(item => item.selector))
        }
      })
      .catch((error: unknown) => {
        if (this.run === run && run.locate === locate) this.fail(run, error)
      })
  }

  private show(run: Run, index: number, found: Found<Target> | null, missing: Partial<TourCopy> | null): void {
    const view = this.viewFor(run, index, found, missing, 'ready')
    this.emitStep(run, view)
    this.track(run, 'step_viewed', index)
  }

  private viewFor(run: Run, index: number, found: Found<Target> | null, missing: Partial<TourCopy> | null, status: TourStepView['status']): TourStepView<Target> {
    const step = run.tour.steps[index]
    const fallback = found?.fallback ?? null
    const target = found?.element ?? null
    if (!step) throw new Error(`Tour ${run.tour.id} has no step ${index}`)
    const skippedBefore = [...run.skipped].filter(skipped => skipped < index).length
    return {
      step,
      index,
      number: index + 1 - skippedBefore,
      total: run.tour.steps.length - run.skipped.size,
      copy: { category: step.category, title: step.title, body: step.body, ...fallback?.copy, ...missing },
      interaction: target ? (fallback?.interaction ?? step.interaction) : 'next',
      shape: fallback?.shape ?? step.shape ?? 'rect',
      padding: fallback?.padding ?? step.padding ?? DEFAULT_TARGET_PADDING,
      target,
      selector: found?.selector ?? null,
      primary: target !== null && fallback === null,
      status,
      canGoBack: this.previousIndex(run, index) !== null,
      last: this.followingIndex(run, index) === null,
    }
  }

  private skipMissing(run: Run, index: number, direction: 1 | -1, selectors: readonly string[]): void {
    const step = run.tour.steps[index]
    run.skipped.add(index)
    this.track(run, 'target_missing', index, {}, true)
    this.deps.reportMissing(`Tour "${run.tour.id}" skipped step "${step?.id ?? index}": nothing on screen matched ${selectors.join(', ')}`)
    const onward = direction > 0 ? this.followingIndex(run, index) : (this.previousIndex(run, index) ?? this.followingIndex(run, index))
    if (onward === null) this.complete(run)
    else this.enter(run, onward, onward > index ? 1 : -1)
  }

  private complete(run: Run): void {
    this.cancelLocate(run)
    if (run.mode === 'first-run') {
      this.track(run, 'completed', null)
      this.deps.persist(run.tour.id, run.tour.version, 'completed')
    }
    this.emit({ phase: 'complete', runId: run.id, tour: run.tour, mode: run.mode })
  }

  private fail(run: Run, error: unknown): void {
    this.deps.reportError(error)
    this.close(run, { path: run.startPath, replace: true })
  }

  private close(run: Run, destination: { path: string; replace: boolean } | null): void {
    this.cancelLocate(run)
    run.unsubscribePath()
    if (this.run === run) this.run = null
    this.emit(IDLE)
    if (destination && this.deps.currentPath() !== destination.path) {
      try {
        this.deps.navigate(destination.path, { replace: destination.replace })
      } catch (error) {
        this.deps.reportError(error)
      }
    }
    run.restoreFocus()
  }

  private onPathChange(run: Run): void {
    if (this.run !== run || run.ownNavigation) return
    const path = this.deps.currentPath()
    if (path === run.expectedPath) return
    if (Date.now() <= run.tapGraceUntil) {
      run.expectedPath = path
      return
    }
    // The runner left the tour's screen another way, such as the system back gesture. Their choice stands.
    if (this.snapshot.phase === 'step') {
      this.track(run, 'skipped', run.index)
      if (run.mode === 'first-run') this.deps.persist(run.tour.id, run.tour.version, 'skipped')
    }
    this.close(run, null)
  }

  private navigateWithin(run: Run, path: string): void {
    run.ownNavigation = true
    try {
      this.deps.navigate(path, { replace: true })
    } finally {
      run.ownNavigation = false
    }
  }

  private readyView(run: Run | null): TourStepView<Target> | null {
    if (!run || this.snapshot.phase !== 'step' || this.snapshot.runId !== run.id || this.snapshot.view.status !== 'ready') return null
    return this.snapshot.view
  }

  private followingIndex(run: Run, index: number): number | null {
    for (let candidate = index + 1; candidate < run.tour.steps.length; candidate++) if (!run.skipped.has(candidate)) return candidate
    return null
  }

  private previousIndex(run: Run, index: number): number | null {
    for (let candidate = index - 1; candidate >= 0; candidate--) if (!run.skipped.has(candidate)) return candidate
    return null
  }

  /** First-run analytics only, apart from how a replay started and targets that went missing. */
  private track(run: Run, event: TourEvent, index: number | null, extra: { entryRoute?: string } = {}, always = false): void {
    if (run.mode === 'replay' && event !== 'replayed' && !always) return
    const step = index === null ? undefined : run.tour.steps[index]
    this.deps.track({
      event,
      tourId: run.tour.id,
      version: run.tour.version,
      ...(step && index !== null ? { stepId: step.id, stepNumber: index + 1 } : {}),
      ...extra,
    })
  }

  private cancelLocate(run: Run): void {
    const locate = run.locate
    this.clearLocate(run)
    locate?.abort()
  }

  private clearLocate(run: Run): void {
    if (run.timer !== null) clearTimeout(run.timer)
    run.timer = null
    run.locate = null
  }

  private emitStep(run: Run, view: TourStepView<Target>): void {
    this.emit({ phase: 'step', runId: run.id, tour: run.tour, mode: run.mode, view })
  }

  private emit(snapshot: TourSnapshot<Target>): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
