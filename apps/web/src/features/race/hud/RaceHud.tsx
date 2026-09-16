import type { RaceSnapshot } from '../controller'
import { deltaChip } from '../format'

interface RaceHudProps {
  snapshot: RaceSnapshot
  ghostName: string | null
  onPause(): void
  canPause: boolean
}

function GateGlyph() {
  return (
    <svg className="leg-route__gate" viewBox="0 0 20 20" aria-hidden="true">
      <polygon points="10,1.5 17.4,5.75 17.4,14.25 10,18.5 2.6,14.25 2.6,5.75" />
      <polygon className="leg-route__gate-core" points="10,6.5 13.1,8.25 13.1,11.75 10,13.5 6.9,11.75 6.9,8.25" />
    </svg>
  )
}

/** Route progress, the ghost race and pause. Deliberately quiet: no speed, no score. */
export function RaceHud({ snapshot, ghostName, onPause, canPause }: RaceHudProps) {
  const progress = Math.round(snapshot.progress * 1000) / 10
  const chip = ghostName !== null && snapshot.ghostDelta !== null ? deltaChip(ghostName, snapshot.ghostDelta) : null
  return (
    <header className="leg-hud">
      <div className="leg-hud__row">
        {canPause && (
          <button type="button" className="leg-pause" onClick={onPause} aria-label="Pause race">
            <span aria-hidden="true" />
          </button>
        )}
        <div
          className="leg-route"
          role="progressbar"
          aria-label="Distance to the handoff gate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
        >
          <div className="leg-route__rail">
            <div className="leg-route__fill" style={{ transform: `scaleX(${snapshot.progress})` }} />
          </div>
          {snapshot.ghostProgress !== null && <span className="leg-route__ghost" style={{ left: `${snapshot.ghostProgress * 100}%` }} />}
          <span className="leg-route__you" style={{ left: `${progress}%` }} />
          <GateGlyph />
        </div>
      </div>
      {chip && (
        <div key={chip.leader} className="leg-delta" data-leader={chip.leader} aria-live="polite">
          <span className="leg-delta__name">{chip.label}</span>
          <span className="leg-delta__value">{chip.value}</span>
        </div>
      )}
    </header>
  )
}
