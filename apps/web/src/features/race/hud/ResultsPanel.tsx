import type { RaceMode, RaceSnapshot } from '../controller'
import { flowControlPercent, formatSeconds, verdict } from '../format'
import type { PassAction } from '../mission'

/** The verdict line for a relay leg raced without a ghost: the runner opened the sector. */
export const FIRST_ON_SECTOR = 'FIRST ON THIS SECTOR'

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
  /** Relay legs: the primary action of a completed leg, e.g. "PASS AURORA". */
  passAction?: PassAction | null
  onWatchReplay(): void
  onRaceAgain(): void
}

/** Leg results. Practice, daily and watch get replay and retry; a relay leg passes the baton on. */
export function ResultsPanel({ snapshot, mode, ghost, layout, dimmed = false, passAction = null, onWatchReplay, onRaceAgain }: ResultsPanelProps) {
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

  if (result.failed || !result.completed) {
    const failed = result.failed
    return (
      <section className={`leg-results leg-results--alert${layoutClass}`} aria-label={failed ? 'Leg failed' : 'Leg not finished'} data-failed={failed ? 'true' : 'false'} data-dimmed={dimState}>
        <p className="leg-results__kicker">{failed ? 'LEG FAILED' : 'LEG NOT FINISHED'}</p>
        <p className="leg-results__body">
          {failed ? 'The baton is still with you.' : header ? 'The handoff gate closed before you reached it.' : 'The handoff gate closed before you reached it. Race again and keep your line.'}
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
  const verdictLine = ghost ? verdict(ghost.name, ghost.timeMs, result.timeMs) : mode === 'relay' ? FIRST_ON_SECTOR : null
  const pass = mode === 'relay' && !header ? passAction : null
  return (
    <section className={`leg-results${layoutClass}`} aria-label="Arrival results" data-dimmed={dimState}>
      <p className="leg-results__kicker">LEG COMPLETE</p>
      <p className="leg-results__time">{formatSeconds(result.timeMs)}</p>
      {verdictLine && (
        <p className="leg-results__verdict" data-won={won || !ghost ? 'true' : 'false'}>
          {verdictLine}
        </p>
      )}
      <dl className="leg-results__stats">
        <div>
          <dt>PERFECT LINES</dt>
          <dd>
            {metrics.perfectGates}/{metrics.totalGates}
          </dd>
        </div>
        <div>
          <dt>SHORTCUTS</dt>
          <dd>{metrics.riskRoutes}</dd>
        </div>
        <div>
          <dt>EDGE SAVES</dt>
          <dd>{metrics.edgeSaves}</dd>
        </div>
        <div>
          <dt>FLOW</dt>
          <dd>{flowControlPercent(metrics, result.ticks)}%</dd>
        </div>
      </dl>
      {pass && (
        <div className="leg-results__actions">
          <button type="button" className="leg-button leg-button--primary leg-button--pass" onClick={pass.onPress}>
            {pass.label}
          </button>
        </div>
      )}
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
