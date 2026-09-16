import * as api from '../relays/api'
import { useNetwork, useRunnerProfile } from '../relays/data'
import { countryName, formatCount, formatRaceTime } from '../relays/format'
import { playerMessage } from '../shell/errors'
import { useSession } from '../shell/session'
import { Button, LinkButton } from '../shell/ui/Button'
import { Avatar, EmptyState, Loading, Stat, StatRow } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { AchievementList, RelayHistory } from './RunnerParts'
import './social.css'

/** A runner's public page. Wallets and exact locations never appear here. */
export function RunnerScreen({ handle, entryKey }: { handle: string; entryKey: string }) {
  const clean = handle.replace(/^@/, '')
  const profile = useRunnerProfile(clean)
  const { snapshot } = useNetwork()
  const { player } = useSession()
  const runner = profile.data

  if (!runner) {
    const missing = profile.error instanceof api.NetworkApiError && profile.error.code === 'runner_not_found'
    return (
      <Screen title={`@${clean}`} entryKey={entryKey}>
        {profile.isPending ? (
          <Loading label="Finding this runner" />
        ) : missing ? (
          <EmptyState title="No runner uses this handle" body={`Nobody on the relay network goes by @${clean}. Check the spelling, or send them an invite link.`}>
            <LinkButton variant="secondary" to="/">
              Back to the world
            </LinkButton>
          </EmptyState>
        ) : (
          <EmptyState title="This runner didn’t load" body={playerMessage(profile.error) ?? 'Try again in a moment.'}>
            <Button variant="secondary" onClick={() => void profile.refetch()}>
              Try again
            </Button>
          </EmptyState>
        )}
      </Screen>
    )
  }

  const holding = snapshot?.batons.some(baton => baton.holder.handle === runner.handle && baton.status === 'active') ?? false
  return (
    <Screen title="Runner" entryKey={entryKey}>
      <div className="nr-profile-head">
        <Avatar name={runner.name} country={runner.country} holder={holding} size={64} />
        <div>
          <h2 className="nr-profile-head__name">{player?.handle === runner.handle ? `${runner.name} (you)` : runner.name}</h2>
          <p className="nr-profile-head__meta">
            @{runner.handle}, {runner.country ? countryName(runner.country) : 'location not shared'}
          </p>
          <p className="nr-profile-head__rank">
            Level {runner.level}, {runner.seasonRank}
          </p>
        </div>
      </div>
      <StatRow columns={3} label="Runner statistics">
        <Stat value={formatCount(runner.qualifiedHandoffs)} label="verified handoffs" gold />
        <Stat value={formatCount(runner.legs)} label="relay legs" />
        <Stat value={`${formatCount(runner.ghostWins)}–${formatCount(runner.ghostLosses)}`} label="ghost races won" />
        <Stat value={`${formatCount(runner.quick.wins)}–${formatCount(runner.quick.losses)}`} label="quick matches won" />
        <Stat value={runner.daily.bestTimeMs === null ? '–' : formatRaceTime(runner.daily.bestTimeMs)} label="best Daily time" />
        <Stat value={runner.crew ? formatCount(runner.crew.streak) : '–'} label={runner.crew ? `${runner.crew.name} streak` : 'no crew yet'} />
      </StatRow>
      <RelayHistory batons={runner.historicBatons} />
      <AchievementList achievements={runner.achievements} legacy={[]} artifacts={runner.artifacts} />
      {runner.recentRunners.length > 0 && <p className="nr-note">Recently ran with {runner.recentRunners.map(item => item.name).join(', ')}.</p>}
    </Screen>
  )
}
