/**
 * Guided tours as data: a tour is a list of steps, each pointing at something on screen by a stable
 * `data-tour` selector. The engine navigates, finds, spotlights and explains; tours never reach into components.
 */

export type TourPlacement = 'bottom' | 'top' | 'right' | 'left'
/** `next`: explanatory, the target is shown but can't be used. `tap-target`: using the target moves the tour on. */
export type TourInteraction = 'next' | 'tap-target'
export type TourShape = 'rect' | 'circle'
/** `first-run` records progress and the funnel; `replay` changes nothing a first run depends on. */
export type TourMode = 'first-run' | 'replay'

export interface TourRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TourCopy {
  /** Tiny label above the heading, e.g. "The relay world". */
  category: string
  title: string
  /** One sentence. */
  body: string
}

/** A target to try when the step's own target isn't on screen, with what the step says and does when it points there. */
export interface TourFallback {
  target: string
  copy?: Partial<TourCopy>
  interaction?: TourInteraction
  shape?: TourShape
  padding?: number
}

export interface TourStep extends TourCopy {
  /** Stable id for analytics, e.g. `open-journey`. */
  id: string
  /** Path the step shows on; the tour navigates there first. Without one the step shows over the current screen. */
  route?: string
  /** Selector of the element to point at, or null for a centered card. */
  target: string | null
  fallbackTargets?: readonly (string | TourFallback)[]
  /**
   * Copy for a centered card when neither the target nor a fallback turns up, so the step can still explain itself
   * truthfully. Without it such a step is skipped and reported as missing.
   */
  whenMissing?: Partial<TourCopy>
  /** Tried in order: bottom, top, right, left by default. A centered card is the last resort. */
  placement?: readonly TourPlacement[]
  interaction: TourInteraction
  /** Space between the target and the spotlight's edge, in CSS pixels. */
  padding?: number
  shape?: TourShape
  /** Geometry for a target whose visible part isn't its box, such as the globe's disc. Null while it can't be measured. */
  measure?(element: Element): TourRect | null
  /** Runs before the step navigates or looks for its target. Throwing closes the tour. */
  beforeEnter?(): void
  /** A quiet extra button on the coach mark. Throwing closes the tour. */
  secondaryAction?: { label: string; run(): void }
}

export interface TourCompletion {
  category: string
  title: string
  /** Returns the runner to where the tour started. */
  primaryLabel: string
  /** Leaves the tour for another path, such as a practice run. */
  secondary?: { label: string; to: string }
  note?: string
}

export interface TourDefinition {
  id: string
  version: string
  steps: readonly TourStep[]
  completion: TourCompletion
}
