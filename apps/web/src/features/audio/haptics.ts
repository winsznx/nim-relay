/**
 * Vibration patterns for moments that deserve a touch. navigator.vibrate exists on Android
 * WebViews; iOS has no web vibration API, so every call there is a silent no-op.
 */

export type HapticKind = 'tap' | 'tick' | 'impact' | 'heavy' | 'success' | 'warning' | 'notify' | 'heartbeat' | 'launch'

/** Milliseconds: a single buzz, or alternating buzz and pause. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, number | readonly number[]>> = {
  tap: 8,
  tick: 12,
  impact: 35,
  heavy: [60, 40, 40],
  success: [15, 40, 25],
  warning: [30, 50, 30],
  notify: [20, 60, 20],
  heartbeat: [25, 120, 18],
  launch: [10, 20, 10, 20, 80],
}

interface Vibrator {
  vibrate?: (pattern: number | number[]) => boolean
}

/** Returns whether the platform accepted the pattern. Never throws. */
export function vibrate(kind: HapticKind, target: Vibrator | undefined = globalThis.navigator): boolean {
  if (typeof target?.vibrate !== 'function') return false
  const pattern = HAPTIC_PATTERNS[kind]
  try {
    return target.vibrate(typeof pattern === 'number' ? pattern : [...pattern])
  } catch {
    // Some WebViews throw when vibration is disallowed (no user activation, policy); a lost buzz is fine.
    return false
  }
}
