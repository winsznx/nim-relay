import type { LegProgressInput } from '@nim-relay/shared'
import type { RaceFrame } from '../race/race-frame'

/** How often a racing holder reports progress. The server accepts at most one report per run every 1.5 s. */
export const PROGRESS_REPORT_EVERY_MS = 2_000

/**
 * Reports a baton leg's progress for spectators while it is raced, read from the frame the race already renders.
 * Fire and forget: a lost report only leaves spectators a moment behind, so failures never reach the runner.
 */
export class LegProgressReporter {
  private sentAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly runId: string,
    private readonly send: (input: LegProgressInput) => Promise<unknown>,
  ) {}

  /** Call with every frame of the ride itself, never a replay. `now` is a monotonic clock in milliseconds. */
  frame(frame: RaceFrame, now: number): void {
    if (!frame.running || frame.tick <= 0 || now - this.sentAt < PROGRESS_REPORT_EVERY_MS) return
    this.sentAt = now
    const input: LegProgressInput = {
      runId: this.runId,
      tick: frame.tick,
      dist: frame.dist,
      finishDist: frame.finishDist,
      ghostDeltaMs: frame.ghostDelta === null ? null : Math.round(frame.ghostDelta * 1000),
      path: frame.path,
    }
    this.send(input).catch((error: unknown) => {
      if (import.meta.env.DEV) console.debug('Live progress was not reported', error)
    })
  }
}
