/**
 * The gameplay tutorial: six one-time coach prompts, each teaching one control or rule at the
 * moment it first matters in a race. The order is the teaching order and the step number the
 * analytics report; it is not the order prompts appear in, which the road decides.
 */

export const TUTORIAL_STEPS = ['lane', 'jump', 'slide', 'ghostline', 'edge', 'flow'] as const

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number]

/** How the player steers on this device: swipes on a touch screen, arrow keys everywhere else. */
export type CoachInput = 'touch' | 'keys'

/** 1-based position of a step in the tutorial. */
export function stepNumber(step: TutorialStepId): number {
  return TUTORIAL_STEPS.indexOf(step) + 1
}

/**
 * Which prompt wins when several are due at once, most pressing first. Edge, jump and slide are
 * urgent: they answer something about to happen and replace a calmer prompt already on screen.
 */
export const STEPS_BY_PRIORITY: readonly TutorialStepId[] = ['edge', 'jump', 'slide', 'lane', 'ghostline', 'flow']

export function priorityOf(step: TutorialStepId): number {
  return STEPS_BY_PRIORITY.indexOf(step)
}

export function isUrgent(step: TutorialStepId): boolean {
  return step === 'edge' || step === 'jump' || step === 'slide'
}
