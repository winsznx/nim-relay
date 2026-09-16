import type { NetworkCrew } from '@nim-relay/shared'
import { formatCount } from '../../relays/format'
import { streakCells, streakState } from '../model/crew'
import { Countdown } from '../../shell/ui/Countdown'
import { Pill } from '../../shell/ui/primitives'
import './crew.css'

const MISSION = 'One verified pass between different members before midnight UTC keeps the streak.'

/** The crew's streak as a chain of the last seven UTC days, with today's state and its deadline. */
export function CrewStreak({ crew, onDayEnds }: { crew: NetworkCrew; onDayEnds(): void }) {
  const state = streakState(crew)
  const cells = streakCells(crew)
  return (
    <section className={`nr-streak nr-streak--${state}`} aria-labelledby="crew-streak">
      <div className="nr-streak__top">
        <p className="nr-streak__count" id="crew-streak">
          <span className="nr-streak__number nr-num">{formatCount(crew.streak)}</span>
          <span className="nr-streak__unit">day streak</span>
        </p>
        {state === 'secured' ? <Pill tone="verified">Kept today</Pill> : state === 'at-risk' ? <Pill tone="danger">At risk</Pill> : <Pill>Not started</Pill>}
      </div>

      <ol className="nr-streak__chain" aria-label="The last seven days, ending today">
        {cells.map((cell, index) => (
          <li key={index} className={`nr-streak__cell nr-streak__cell--${cell}`}>
            <span className="nr-visually-hidden">
              {cell === 'today-kept' ? 'Today, kept' : cell === 'today-open' ? 'Today, no pass yet' : cell === 'kept' ? 'Kept' : 'No streak'}
            </span>
          </li>
        ))}
      </ol>

      {state === 'secured' ? (
        <p className="nr-streak__status">Today’s pass is in. The next day of the streak opens at midnight UTC.</p>
      ) : (
        <p className="nr-streak__status">
          {state === 'at-risk' ? 'Streak ends in ' : 'Today ends in '}
          <Countdown to={crew.deadline} onElapsed={onDayEnds} className="nr-streak__clock" />
        </p>
      )}
      <p className="nr-streak__mission">{MISSION}</p>
      <p className="nr-streak__meta nr-num">
        Best {formatCount(crew.bestStreak)} {crew.bestStreak === 1 ? 'day' : 'days'}. {formatCount(crew.todayHandoffs)} verified {crew.todayHandoffs === 1 ? 'pass' : 'passes'} today.
      </p>
    </section>
  )
}
