import type { RaceMode, RaceSnapshot } from '../controller'
import { flowControlPercent, formatSeconds, verdict } from '../format'

/** The verdict line for a relay leg raced without a ghost: the runner opened the sector. */
export const FIRST_TIME_VERDICT = 'NEW SECTOR · FIRST TIME SET'

interface ResultsPanelProps {
  snapshot: RaceSnapshot
  mode: RaceMode
  ghost: { name: string; timeMs: number } | null
  /**
   * 'card' is the full results card over the bottom of the screen. 'header' is the
   * compact strip pinned to the top safe area while the handoff ceremony owns the
   * rest of the screen; it has no actions.
   */
  layout: 'card' | 'header'
  /** Fades the header back while the ceremony's frozen and launch beats play. */
  dimmed?: boolean
  onWatchReplay(): void
  onRaceAgain(): void
}

/** Arrival results. Practice, daily and watch get replay and retry; relay actions come from the ceremony. */
export function ResultsPanel({ snapshot, mode, ghost, layout, dimmed = false, onWatchReplay, onRaceAgain }: ResultsPanelProps) {
  const result = snapshot.result
  const replayable = mode === 'practice' || mode === 'daily' || mode === 'watch'
  const header = layout === 'header'
  const layoutClass = header ? ' leg-results--header' : ''
  const dimState = header && dimmed ? 'true' : 'false'

  if (snapshot.divergence || !result) {
    return (
      <section className="leg-results leg-results--alert" aria-label="Run could not be verified">
        <p className="leg-results__kicker">RUN COULD NOT BE VERIFIED</p>
        <p className="leg-results__body">This run did not replay to the same result, so it can’t count. Race the leg again to set a verified time.</p>
        <div className="leg-results__actions">
          <button type="button" className="leg-button leg-button--primary" onClick={onRaceAgain}>
            RACE AGAIN
          </button>
        </div>
      </section>
    )
  }

  if (!result.completed) {
    return (
      <section className={`leg-results leg-results--alert${layoutClass}`} aria-label="Leg not finished" data-dimmed={dimState}>
        <p className="leg-results__kicker">LEG NOT FINISHED</p>
        <p className="leg-results__body">
          {header ? 'The handoff gate closed before you reached it.' : 'The handoff gate closed before you reached it. Race again and keep your line.'}
        </p>
        {!header && (
          <div className="leg-results__actions">
            <button type="button" className="leg-button leg-button--primary" onClick={onRaceAgain}>
              RACE AGAIN
            </button>
          </div>
        )}
      </section>
    )
  }

  const metrics = result.metrics
  const won = ghost !== null && result.timeMs < ghost.timeMs
  const verdictLine = ghost ? verdict(ghost.name, ghost.timeMs, result.timeMs) : header ? FIRST_TIME_VERDICT : null
  return (
    <section className={`leg-results${layoutClass}`} aria-label="Arrival results" data-dimmed={dimState}>
      <p className="leg-results__kicker">ARRIVAL</p>
      <p className="leg-results__time">{formatSeconds(result.timeMs)}</p>
      {verdictLine && (
        <p className="leg-results__verdict" data-won={won || !ghost ? 'true' : 'false'}>
          {verdictLine}
        </p>
      )}
      <dl className="leg-results__stats">
        <div>
          <dt>PERFECT GATES</dt>
          <dd>
            {metrics.perfectGates}/{metrics.totalGates}
          </dd>
        </div>
        <div>
          <dt>SHORTCUTS</dt>
          <dd>{metrics.riskRoutes}</dd>
        </div>
        <div>
          <dt>FLOW CONTROL</dt>
          <dd>{flowControlPercent(metrics, result.ticks)}%</dd>
        </div>
      </dl>
      {replayable && !header && (
        <div className="leg-results__actions">
          <button type="button" className="leg-button" onClick={onWatchReplay}>
            WATCH REPLAY
          </button>
          <button type="button" className="leg-button leg-button--primary" onClick={onRaceAgain}>
            RACE AGAIN
          </button>
        </div>
      )}
    </section>
  )
}
