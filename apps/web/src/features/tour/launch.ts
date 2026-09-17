import type { TourMode } from './types'

/** Lets any screen ask for the product tour while the tour host, which knows the world it points at, starts it. */

type Launcher = (mode: TourMode) => void

let launcher: Launcher | null = null

export function registerTourLauncher(next: Launcher): () => void {
  launcher = next
  return () => {
    if (launcher === next) launcher = null
  }
}

/** Shows the product tour again. A replay never changes whether the tour counts as seen. */
export function replayProductTour(): void {
  launcher?.('replay')
}
