import type { RaceMode } from '../controller'
import { displayName, formatSeconds, possessive } from '../format'
import { missionCopy, quotedNote, type RaceMission } from '../mission'

interface ArrivalTitleProps {
  mode: RaceMode
  /** 'arrival' shows the incoming title; 'catch' swaps to the mission (or the ghost line); 'go' lets it sink. */
  stage: 'arrival' | 'catch' | 'go'
  sender: { name: string; country?: string | null } | null
  ghost: { name: string; timeMs: number } | null
  mission: RaceMission | null
  worldName: string
  /** Labels of the echoes that span this sector's leg, most meaningful first. */
  remembered: readonly string[]
}

function openingCopy(mode: RaceMode, sender: ArrivalTitleProps['sender'], mission: RaceMission | null, worldName: string): { kicker: string; title: string } {
  const from = mission?.note?.from ?? sender?.name
  if (mode === 'relay' && from) return { kicker: 'BATON INCOMING', title: `FROM ${displayName(from)}` }
  if (mode === 'relay') return { kicker: 'BATON INCOMING', title: worldName.toUpperCase() }
  if (mode === 'daily') return { kicker: 'DAILY ROUTE', title: worldName.toUpperCase() }
  if (mode === 'watch') return { kicker: 'REPLAY', title: worldName.toUpperCase() }
  return { kicker: 'PRACTICE RUN', title: worldName.toUpperCase() }
}

/**
 * The opening lockup: who the baton comes from and what they said, then what this leg is for (or,
 * outside a relay, whose ghost you are chasing) as the catch lands.
 */
export function ArrivalTitle({ mode, stage, sender, ghost, mission, worldName, remembered }: ArrivalTitleProps) {
  const copy = openingCopy(mode, sender, mission, worldName)
  const note = mode === 'relay' ? quotedNote(mission?.note ?? null) : null
  const header = mode === 'relay' && mission ? missionCopy(mission) : null
  return (
    <div className="leg-arrival" data-stage={stage} aria-live="polite">
      {stage === 'arrival' && (
        <div className="leg-arrival__lockup">
          <p className="leg-arrival__kicker">{copy.kicker}</p>
          <h1 className="leg-arrival__title">{copy.title}</h1>
          {note && <p className="leg-arrival__note">{note}</p>}
          {mode === 'relay' && sender?.country && <p className="leg-arrival__place">{sender.country}</p>}
          {remembered.length > 0 && <p className="leg-arrival__echoes">THIS SECTOR REMEMBERS: {remembered.join(', ')}</p>}
        </div>
      )}
      {stage !== 'arrival' && header && (
        <div className="leg-mission">
          <h2 className="leg-mission__title">{header.title}</h2>
          {header.previous && <p className="leg-mission__previous">{header.previous}</p>}
          {header.handoff && <p className="leg-mission__handoff">{header.handoff}</p>}
        </div>
      )}
      {stage !== 'arrival' && !header && ghost && (
        <div className="leg-arrival__ghost">
          <span className="leg-arrival__ghost-name">{possessive(ghost.name)} GHOST LOADED</span>
          <span className="leg-arrival__ghost-time">{formatSeconds(ghost.timeMs)}</span>
        </div>
      )}
    </div>
  )
}
