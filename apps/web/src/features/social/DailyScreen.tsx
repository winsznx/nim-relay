import { trackShare, useNetwork } from '../relays/data'
import { formatCount, formatRaceTime, worldName } from '../relays/format'
import { watchPath } from '../relays/JourneyRoute'
import { linkProps, navigate } from '../shell/router'
import { useRequireRunner, useSession } from '../shell/session'
import { shareLink } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Avatar, EmptyState, Loading, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import './social.css'

export function DailyScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const requireRunner = useRequireRunner()
  const action = useAction()
  const daily = snapshot?.daily
  if (!daily) {
    return (
      <Screen title="Daily Circuit" entryKey={entryKey}>
        {loading ? <Loading label="Loading today’s route" /> : <EmptyState title="Today’s route didn’t load" body="The relay server isn’t answering. Try again in a moment." />}
      </Screen>
    )
  }
  const officialUsed = player !== null && daily.officialRunId !== null
  return (
    <Screen title="Daily Circuit" entryKey={entryKey}>
      <div className="nr-daily-cover">
        <p className="nr-daily-cover__date nr-num">{new Date(`${daily.date}T00:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
        <h2 className="nr-daily-cover__world">{worldName(daily.world)}</h2>
        <p className="nr-lede">Everyone rides the same line today. You get one official attempt and as much practice as you like. The server replays every ranked ride.</p>
      </div>
      <div className="nr-actions nr-actions--stack">
        <Button
          variant="primary"
          size="lg"
          block
          disabled={officialUsed}
          onClick={() => requireRunner('Sign in to ride today’s official Daily.', () => navigate('/leg/daily'))}
        >
          {officialUsed ? 'Official attempt used today' : 'Ride the official Daily'}
        </Button>
        <LinkButton variant="secondary" block to="/leg/daily?practice=1">
          Practice today’s route
        </LinkButton>
        <Button
          variant="quiet"
          block
          onClick={() =>
            action.run(async () => {
              await shareLink('NIM Relay Daily Circuit', '/daily')
              trackShare('daily')
            })
          }
        >
          Challenge friends to today’s route
        </Button>
      </div>

      <section className="nr-section" aria-labelledby="daily-board">
        <SectionHeader id="daily-board" title="Official leaderboard" detail={daily.leaderboard.length ? `${formatCount(daily.leaderboard.length)} verified ${daily.leaderboard.length === 1 ? 'ride' : 'rides'}` : undefined} />
        {daily.leaderboard.length === 0 ? (
          <p className="nr-note">No official rides yet today. The first verified score takes the top spot.</p>
        ) : (
          <ol className="nr-list">
            {daily.leaderboard.map((entry, index) => (
              <li key={entry.runId} className={`nr-row${entry.player.id === player?.id ? ' nr-row--self' : ''}`}>
                <span className="nr-rank nr-num">{index + 1}</span>
                <Avatar name={entry.player.name} country={entry.player.country} size={34} />
                <span className="nr-row__body">
                  <a className="nr-row__title nr-plain-link" {...linkProps(`/runner/${encodeURIComponent(entry.player.handle)}`)}>
                    {entry.player.id === player?.id ? 'You' : entry.player.name}
                  </a>
                  <span className="nr-row__meta nr-num">
                    {formatCount(entry.score)} points in {formatRaceTime(entry.timeMs)}
                  </span>
                </span>
                <a className="nr-button nr-button--sm nr-button--secondary" {...linkProps(watchPath(entry.runId, null))}>
                  Watch
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </Screen>
  )
}
