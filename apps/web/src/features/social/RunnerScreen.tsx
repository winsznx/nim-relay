import * as api from '../relays/api'
import { useNetwork, useRunnerProfile } from '../relays/data'
import { playerMessage } from '../shell/errors'
import { pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { Button, LinkButton } from '../shell/ui/Button'
import { EmptyState, Loading } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { ArtifactTiles, AchievementShelf } from './profile/Collection'
import { LevelPlate, ProfileHeader } from './profile/ProfileHeader'
import { RecentRunners, RelayHistory, RunnerStats } from './profile/RunnerRecord'
import { useProfileLookups } from './data'
import './social.css'

/** A runner's public page. It never shows a wallet address or an exact location. */
export function RunnerScreen({ handle, entryKey }: { handle: string; entryKey: string }) {
  const clean = handle.replace(/^@/, '')
  const profile = useRunnerProfile(clean)
  const { snapshot } = useNetwork()
  const { player } = useSession()
  const runner = profile.data
  const lookups = useProfileLookups(runner?.historicBatons)

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

  const you = player?.handle === runner.handle
  const holding = snapshot?.batons.some(baton => baton.holder.handle === runner.handle && baton.status !== 'completed') ?? false
  return (
    <Screen title="Runner" entryKey={entryKey}>
      {/* The identicon comes from the network roster; the public profile itself carries no wallet. */}
      <ProfileHeader name={runner.name} handle={runner.handle} wallet={lookups.walletsByHandle.get(runner.handle) ?? null} country={runner.country} holder={holding} you={you} />
      <LevelPlate level={runner.level} seasonRank={runner.seasonRank} xp={null} />
      <RunnerStats profile={runner} />
      {you && (
        <div className="nr-actions">
          <LinkButton variant="secondary" to={pathFor('profile')}>
            Open your profile
          </LinkButton>
        </div>
      )}
      <RelayHistory batons={runner.historicBatons} />
      <AchievementShelf achievements={runner.achievements} />
      <ArtifactTiles artifacts={runner.artifacts} codes={lookups.batonCodes} />
      <RecentRunners runners={runner.recentRunners} wallets={lookups.walletsByHandle} />
    </Screen>
  )
}
