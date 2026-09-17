import type { RaceSnapshot } from '../controller'
import { displayName, routeReadout } from '../format'

interface RaceHudProps {
  snapshot: RaceSnapshot
  /** The runner whose leg this one continues: the ghost being raced. */
  previousName: string | null
  /** Who waits at the handoff. Null in a relay leg means the handoff is open; ignored outside relay legs. */
  nextName: string | null
  relay: boolean
  /** "HANDOFF TO YASMINE" while the handoff gate is in view. */
  callout: string | null
  onPause(): void
  canPause: boolean
}

/**
 * The leg as a relay: the previous runner at one end, the next at the other, the courier travelling
 * between them, and the split to the ghost underneath. Deliberately quiet: no speed, no score.
 */
export function RaceHud({ snapshot, previousName, nextName, relay, callout, onPause, canPause }: RaceHudProps) {
  const percent = Math.round(snapshot.progress * 1000) / 10
  const next = relay ? (nextName === null ? 'OPEN' : displayName(nextName)) : null
  const readout = routeReadout(snapshot.progress, snapshot.ghostDelta)
  return (
    <header className="leg-hud" data-leader={snapshot.leader}>
      <div className="leg-hud__row">
        {canPause && (
          <button type="button" className="leg-pause" onClick={onPause} aria-label="Pause race">
            <span aria-hidden="true" />
          </button>
        )}
        <div
          className="leg-relay"
          role="progressbar"
          aria-label="Distance to the handoff gate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-valuetext={readout}
        >
          <div className="leg-relay__names" aria-hidden="true">
            <span className="leg-relay__name leg-relay__name--previous">{previousName ? displayName(previousName) : ''}</span>
            {next && (
              <span className="leg-relay__name leg-relay__name--next" data-open={nextName === null ? 'true' : 'false'}>
                {next}
              </span>
            )}
          </div>
          <div className="leg-relay__track" aria-hidden="true">
            <span className="leg-relay__end leg-relay__end--previous" />
            <div className="leg-relay__rail">
              <div className="leg-relay__fill" style={{ transform: `scaleX(${snapshot.progress})` }} />
            </div>
            {snapshot.ghostProgress !== null && <span className="leg-relay__ghost" style={{ left: `${snapshot.ghostProgress * 100}%` }} />}
            <span className="leg-relay__you" style={{ left: `${percent}%` }} />
            <span className="leg-relay__end leg-relay__end--next" />
          </div>
          {/* Keyed on the leader so an overtake, either way, replays the flash. */}
          <p key={snapshot.leader} className="leg-relay__readout" data-leader={snapshot.leader} aria-hidden="true">
            {readout}
          </p>
        </div>
      </div>
      {callout && (
        <p className="leg-callout" role="status">
          {callout}
        </p>
      )}
    </header>
  )
}
