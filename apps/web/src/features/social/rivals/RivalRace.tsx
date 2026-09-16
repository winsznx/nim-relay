import type { CSSProperties } from 'react'
import { formatCount } from '../../relays/format'
import type { RivalTeam, RivalView } from '../model/rivals'
import { ShareCardButton } from '../cards/ShareCardButton'
import { linkProps, pathFor } from '../../shell/router'
import { LinkButton } from '../../shell/ui/Button'
import { Countdown } from '../../shell/ui/Countdown'
import { Pill } from '../../shell/ui/primitives'
import { RunnerAvatar } from '../../shell/ui/RunnerAvatar'
import './rivals.css'

const TEAM_NAMES = { gold: 'Gold', cyan: 'Cyan' } as const

function teamName(team: RivalTeam, playerId: string | null): string {
  if (team.captain?.id === playerId) return 'Your team'
  return team.captain ? `${team.captain.name}’s team` : `${TEAM_NAMES[team.side]} team`
}

function LaneHead({ team, name, target }: { team: RivalTeam; name: string; target: number }) {
  const content = (
    <>
      <span className="nr-lane__team">
        <span className="nr-lane__side">{TEAM_NAMES[team.side]}</span>
        <span className="nr-lane__name">{name}</span>
      </span>
      <span className="nr-lane__score nr-num">
        {formatCount(team.score)}
        <span className="nr-lane__target">/{formatCount(target)}</span>
      </span>
    </>
  )
  return team.baton ? (
    <a className="nr-lane__head" {...linkProps(pathFor('relay', { code: team.baton.code }))}>
      {content}
    </a>
  ) : (
    <div className="nr-lane__head">{content}</div>
  )
}

function Lane({ team, target, playerId, finished }: { team: RivalTeam; target: number; playerId: string | null; finished: boolean }) {
  const holder = team.holder
  const name = teamName(team, playerId)
  return (
    <div className={`nr-lane nr-lane--${team.side}${team.won ? ' nr-lane--won' : ''}${finished && !team.won ? ' nr-lane--out' : ''}`} style={{ '--nr-lane-progress': team.progress } as CSSProperties}>
      <LaneHead team={team} name={name} target={target} />
      <div className="nr-lane__track" role="progressbar" aria-label={`${name}, verified handoffs toward ${target}`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(team.score, target)}>
        <span className="nr-lane__fill" />
        <span className="nr-lane__baton" aria-hidden="true" />
      </div>
      <p className="nr-lane__holder">
        {team.won ? (
          'Reached the target first'
        ) : holder ? (
          <>
            <RunnerAvatar name={holder.name} wallet={holder.wallet} holder size={22} />
            {holder.id === playerId ? 'Baton with you' : `Baton with ${holder.name}`}
          </>
        ) : (
          'Baton finished'
        )}
      </p>
    </div>
  )
}

function Call({ view }: { view: RivalView }) {
  const team = view.yourTeam
  if (!team?.baton || view.state !== 'live') return null
  if (team.yourTurn) {
    return (
      <div className="nr-rival__call">
        <p>Your team’s baton is with you. Race the leg, then pass it on.</p>
        <LinkButton variant="primary" block to={pathFor('leg', { code: team.baton.code })}>
          Carry your team’s leg
        </LinkButton>
      </div>
    )
  }
  if (team.needsRunner) {
    return (
      <div className="nr-rival__call">
        <p>Your team needs a runner. {team.holder ? `${team.holder.name} hasn’t picked who carries the next leg.` : ''}</p>
        <LinkButton variant="primary" block to={`${pathFor('relay', { code: team.baton.code })}#next-leg`}>
          Take the next leg
        </LinkButton>
      </div>
    )
  }
  return null
}

export function RivalRace({ view, playerId }: { view: RivalView; playerId: string | null }) {
  const [gold, cyan] = view.teams
  const finished = view.state !== 'live'
  return (
    <article className={`nr-rival nr-rival--${view.state}`} aria-labelledby={`rival-${view.id}`}>
      <header className="nr-rival__head">
        <h3 id={`rival-${view.id}`}>{view.title}</h3>
        {view.state === 'won' && view.winner ? (
          <Pill tone={view.winner.side === 'gold' ? 'gold' : 'verified'}>{TEAM_NAMES[view.winner.side]} won</Pill>
        ) : view.state === 'ended' ? (
          <Pill>Time’s up</Pill>
        ) : (
          <Pill tone="live">Racing</Pill>
        )}
      </header>
      <p className="nr-rival__rule">
        First to {formatCount(view.target)} verified handoffs.{' '}
        {view.state === 'live' ? (
          <>
            <Countdown to={view.endsAt} className="nr-rival__clock" /> left.
          </>
        ) : view.state === 'ended' ? (
          `Neither team reached it by ${new Date(view.endsAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}.`
        ) : null}
      </p>
      <div className="nr-rival__lanes">
        <Lane team={gold} target={view.target} playerId={playerId} finished={finished} />
        <Lane team={cyan} target={view.target} playerId={playerId} finished={finished} />
      </div>
      <Call view={view} />
      <div className="nr-rival__share">
        <ShareCardButton
          variant="quiet"
          size="sm"
          card={{
            kind: 'rival',
            title: view.title,
            target: view.target,
            teams: [
              { captain: gold.captain?.name ?? 'Gold', score: gold.score },
              { captain: cyan.captain?.name ?? 'Cyan', score: cyan.score },
            ],
            winner: view.winner?.side ?? null,
          }}
        >
          Share rivalry card
        </ShareCardButton>
      </div>
    </article>
  )
}
