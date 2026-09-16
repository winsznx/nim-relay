import { relayLeg } from '@nim-relay/game-engine'

let vibrationAvailable = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

/** Short vibration patterns for the moments a thumb should feel. Stops trying after the first failure. */
export function vibrateForEvents(events: number): void {
  if (!vibrationAvailable) return
  let pattern: number[] | null = null
  if (events & (relayLeg.EVENT.HIT | relayLeg.EVENT.FALL)) pattern = [28, 30, 40]
  else if (events & relayLeg.EVENT.PERFECT_GATE) pattern = [8]
  else if (events & relayLeg.EVENT.LAND) pattern = [14]
  if (!pattern) return
  try {
    navigator.vibrate(pattern)
  } catch {
    vibrationAvailable = false
  }
}
