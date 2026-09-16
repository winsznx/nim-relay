import type { RaceMode } from '../controller'
import { displayName, formatSeconds, possessive } from '../format'

interface ArrivalTitleProps {
  mode: RaceMode
  /** 'arrival' shows the incoming title; 'catch' swaps to the ghost line. */
  stage: 'arrival' | 'catch' | 'go'
  sender: { name: string; country?: string | null } | null
  ghost: { name: string; timeMs: number } | null
  worldName: string
  /** Labels of the echoes that span this sector's leg, most meaningful first. */
  remembered: readonly string[]
}

function openingCopy(mode: RaceMode, sender: ArrivalTitleProps['sender'], worldName: string): { kicker: string; title: string } {
  if (mode === 'relay' && sender) return { kicker: 'BATON INCOMING', title: `FROM ${displayName(sender.name)}` }
  if (mode === 'relay') return { kicker: 'BATON INCOMING', title: worldName.toUpperCase() }
  if (mode === 'daily') return { kicker: 'DAILY ROUTE', title: worldName.toUpperCase() }
  if (mode === 'watch') return { kicker: 'REPLAY', title: worldName.toUpperCase() }
  return { kicker: 'PRACTICE RUN', title: worldName.toUpperCase() }
}

/** The opening lockup: who the baton comes from, then whose ghost you are chasing. */
export function ArrivalTitle({ mode, stage, sender, ghost, worldName, remembered }: ArrivalTitleProps) {
  const copy = openingCopy(mode, sender, worldName)
  return (
    <div className="leg-arrival" data-stage={stage} aria-live="polite">
      {stage === 'arrival' && (
        <div className="leg-arrival__lockup">
          <p className="leg-arrival__kicker">{copy.kicker}</p>
          <h1 className="leg-arrival__title">{copy.title}</h1>
          {mode === 'relay' && sender?.country && <p className="leg-arrival__place">{sender.country}</p>}
          {remembered.length > 0 && <p className="leg-arrival__echoes">THIS SECTOR REMEMBERS: {remembered.join(', ')}</p>}
        </div>
      )}
      {stage !== 'arrival' && ghost && (
        <div className="leg-arrival__ghost">
          <span className="leg-arrival__ghost-name">{possessive(ghost.name)} GHOST LOADED</span>
          <span className="leg-arrival__ghost-time">{formatSeconds(ghost.timeMs)}</span>
        </div>
      )}
    </div>
  )
}
