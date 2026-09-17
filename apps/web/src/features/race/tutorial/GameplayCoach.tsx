import { useSyncExternalStore } from 'react'
import { CoachGlyph } from './CoachGlyph'
import { coachCopy } from './copy'
import type { GameplayTutorial } from './gameplay-tutorial'
import './coach.css'

interface GameplayCoachProps {
  tutorial: GameplayTutorial
}

function sideName(side: -1 | 0 | 1): 'left' | 'ahead' | 'right' {
  return side < 0 ? 'left' : side > 0 ? 'right' : 'ahead'
}

/**
 * The coach prompt, low on the screen between the courier and the thumbs, and the one control that ends the
 * tutorial, up by the HUD where no swipe starts. The prompt takes no touches: swipes pass through it to the race.
 */
export function GameplayCoach({ tutorial }: GameplayCoachProps) {
  const view = useSyncExternalStore(tutorial.subscribe, tutorial.getSnapshot)
  const copy = view ? coachCopy(view, tutorial.input, tutorial.ghostName) : null
  return (
    <>
      <div role="status">
        {view && copy && (
          <div
            key={view.showing}
            className="leg-coach"
            data-step={view.step}
            data-showing={view.showing}
            data-status={view.status}
            data-now={view.now}
            data-side={sideName(view.side)}
          >
            <span className="leg-coach__pointer" aria-hidden="true" />
            <CoachGlyph step={view.step} input={tutorial.input} />
            <p className="leg-coach__text">
              <span className="leg-coach__heading">{copy.heading}</span>
              <span className="leg-coach__line">{copy.line}</span>
            </p>
          </div>
        )}
      </div>
      {view && (
        <button type="button" className="leg-coach-skip" data-status={view.status} onClick={tutorial.skip}>
          Skip gameplay tutorial
        </button>
      )}
    </>
  )
}
