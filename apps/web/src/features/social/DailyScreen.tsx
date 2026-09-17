import type { NetworkDaily } from '@nim-relay/shared'
import type { Player } from '../../lib/auth-api'
import { trackShare, useNetwork, useRefreshNetwork } from '../relays/data'
import { formatBoardTime, formatCount, formatRaceTime, worldName } from '../relays/format'
import { practicePath, watchPath } from '../relays/paths'
import { linkProps, navigate, pathFor } from '../shell/router'
import { useRequireRunner, useSession } from '../shell/session'
import { shareLink } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Countdown } from '../shell/ui/Countdown'
import { EmptyState, Loading, SectionHeader } from '../shell/ui/primitives'
import { RunnerAvatar } from '../shell/ui/RunnerAvatar'
import { Screen } from '../shell/ui/Screen'
import { ShareCardButton } from './cards/ShareCardButton'
import { dailyResetsAt, ghostAbove, officialStatus } from './model/daily'
import './daily/daily.css'
import './social.css'

const PRACTICE = '/leg/daily?practice=1'

function OfficialRide({ daily, player }: { daily: NetworkDaily; player: Player | null }) {
  const requireRunner = useRequireRunner()
  const action = useAction()
  const challenge = (
    <Button
      variant="quiet"
      block
      busy={action.pending}
      onClick={() =>
        action.run(async () => {
          await shareLink('NIM Relay Daily Circuit', pathFor('daily'))
          trackShare('daily')
        })
      }
    >
      Challenge friends to today’s route
    </Button>
  )
  const ride = (
    <Button variant="primary" size="lg" block onClick={() => requireRunner('Sign in to ride today’s official Daily.', () => navigate('/leg/daily'))}>
      Ride the official Daily
    </Button>
  )
  const practice = (
    <LinkButton variant="secondary" block to={PRACTICE}>
      Practice today’s route
    </LinkButton>
  )
  const status = player ? officialStatus(daily, player.id) : null

  if (!status || status.state === 'not-started') {
    return (
      <section className="nr-official" aria-labelledby="official-ride">
        <h3 id="official-ride" className="nr-official__title">
          {player ? 'Your official ride is waiting' : 'One official ride a day'}
        </h3>
        <p className="nr-official__body">You get one ranked attempt today. Practice as often as you like first, since practice never counts.</p>
        <div className="nr-actions nr-actions--stack">
          {ride}
          {practice}
          {challenge}
        </div>
      </section>
    )
  }
  if (status.state !== 'finished') {
    return (
      <section className="nr-official" aria-labelledby="official-ride">
        <h3 id="official-ride" className="nr-official__title">
          Official attempt used
        </h3>
        <p className="nr-official__body">
          {status.state === 'started' ? 'Your ranked ride started but no finished result is on the board. Practice stays open all day.' : 'Your ranked ride is in, below the top 100 the board publishes. Practice stays open all day.'}
        </p>
        <div className="nr-actions nr-actions--stack">
          {practice}
          {challenge}
        </div>
      </section>
    )
  }

  const { standing } = status
  const ghost = player ? ghostAbove(daily, player.id) : null
  return (
    <section className="nr-official nr-official--finished" aria-labelledby="official-ride">
      <h3 id="official-ride" className="nr-visually-hidden">
        Your official result
      </h3>
      <div className="nr-official__result">
        <p className="nr-official__time nr-num">{formatRaceTime(standing.entry.timeMs)}</p>
        <p className="nr-official__rank nr-num">
          <span>
            #{formatCount(standing.rank)} of {formatCount(standing.total)}
          </span>
          {standing.topPercent !== null && standing.topPercent < 100 && <span className="nr-official__top">Top {standing.topPercent}%</span>}
        </p>
      </div>
      <p className="nr-official__body nr-num">{formatCount(standing.entry.score)} points on the official board.</p>
      <div className="nr-actions nr-actions--stack">
        {ghost && (
          <LinkButton variant="primary" block to={practicePath(ghost.runId, null)} data-tour="ghost">
            Race {ghost.player.name}’s ghost, {formatRaceTime(standing.entry.timeMs - ghost.timeMs)} faster
          </LinkButton>
        )}
        <ShareCardButton
          variant={ghost ? 'secondary' : 'primary'}
          block
          card={{ kind: 'daily', runnerName: standing.entry.player.name, date: daily.date, world: daily.world, timeMs: standing.entry.timeMs, rank: standing.rank, total: standing.total, topPercent: standing.topPercent }}
        >
          Share Daily card
        </ShareCardButton>
        {practice}
      </div>
    </section>
  )
}

function Leaderboard({ daily, playerId }: { daily: NetworkDaily; playerId: string | null }) {
  const entries = daily.leaderboard
  return (
    <section className="nr-section" aria-labelledby="daily-board">
      <SectionHeader id="daily-board" title="Official leaderboard" detail={entries.length ? `${formatCount(entries.length)} verified ${entries.length === 1 ? 'ride' : 'rides'}, ranked by score` : undefined} />
      {entries.length === 0 ? (
        <p className="nr-note">No official rides yet today. The first verified score takes the top spot.</p>
      ) : (
        <ol className="nr-list">
          {entries.map((entry, index) => {
            const you = entry.player.id === playerId
            return (
              <li key={entry.runId} className={`nr-row nr-board-row${you ? ' nr-row--self' : ''}`}>
                <span className={`nr-rank nr-num${index < 3 ? ' nr-rank--podium' : ''}`}>{index + 1}</span>
                <a className="nr-board-row__runner" {...linkProps(pathFor('runner', { handle: entry.player.handle }))}>
                  <RunnerAvatar name={entry.player.name} wallet={entry.player.wallet} country={entry.player.country} size={34} />
                  <span className="nr-row__body">
                    <span className="nr-row__title">{you ? 'You' : entry.player.name}</span>
                    <span className="nr-row__meta nr-num">{formatCount(entry.score)} points</span>
                  </span>
                </a>
                <span className="nr-board-row__time nr-num">{formatBoardTime(entry.timeMs)}</span>
                <a className="nr-button nr-button--secondary nr-board-row__watch" aria-label={`Watch ${you ? 'your' : `${entry.player.name}’s`} ride`} {...linkProps(watchPath(entry.runId, null))}>
                  Watch
                </a>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export function DailyScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const refresh = useRefreshNetwork()
  const daily = snapshot?.daily
  if (!daily) {
    return (
      <Screen title="Daily Circuit" entryKey={entryKey}>
        {loading ? <Loading label="Loading today’s route" /> : <EmptyState title="Today’s route didn’t load" body="The relay server isn’t answering. Try again in a moment." />}
      </Screen>
    )
  }
  return (
    <Screen title="Daily Circuit" entryKey={entryKey}>
      <header className="nr-daily-cover" data-tour="daily">
        <p className="nr-daily-cover__date nr-num">{new Date(`${daily.date}T00:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
        <h2 className="nr-daily-cover__world">{worldName(daily.world)}</h2>
        <p className="nr-daily-cover__reset">
          Everyone rides this course until it resets in <Countdown to={dailyResetsAt(daily)} onElapsed={refresh} />
        </p>
      </header>
      <OfficialRide daily={daily} player={player} />
      <Leaderboard daily={daily} playerId={player?.id ?? null} />
    </Screen>
  )
}
