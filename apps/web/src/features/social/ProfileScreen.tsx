import { useQueryClient } from '@tanstack/react-query'
import { AtlasProfileSection } from '../atlas/AtlasProfile'
import { useNetwork, useRunnerProfile, useStationProfile } from '../relays/data'
import { linkProps, navigate, pathFor } from '../shell/router'
import { signOut, useSession } from '../shell/session'
import { shareLink } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Loading } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { replayProductTour } from '../tour/launch'
import { RelayGrantsPanel } from '../grants/RelayGrantsPanel'
import { ArtifactTiles, AchievementShelf } from './profile/Collection'
import { Locker, ProfileSettings, ProofDisclosure } from './profile/OwnerTools'
import { LevelPlate, ProfileHeader } from './profile/ProfileHeader'
import { RecentRunners, RelayHistory, RunnerStats } from './profile/RunnerRecord'
import { SignInPrompt } from './SignInPrompt'
import { useProfileLookups } from './data'
import './social.css'

export function ProfileScreen({ entryKey }: { entryKey: string }) {
  const client = useQueryClient()
  const { player } = useSession()
  const stationProfile = useStationProfile()
  const runnerProfile = useRunnerProfile(player?.handle ?? null)
  const { snapshot } = useNetwork()
  const action = useAction()
  const lookups = useProfileLookups(runnerProfile.data?.historicBatons)

  if (!player) {
    return (
      <Screen title="Profile" entryKey={entryKey}>
        <SignInPrompt title="Your runner lives here" body="Your level, batons, achievements and courier locker. Sign in once and they follow you." reason="Sign in to open your runner profile." tour="profile-signin" />
        <p className="nr-note">
          <a {...linkProps(pathFor('privacy'))}>How NIM Relay handles your data</a>
        </p>
        <div className="nr-actions">
          <Button variant="quiet" onClick={replayProductTour}>
            Take the product tour
          </Button>
        </div>
      </Screen>
    )
  }

  const station = stationProfile.data
  const runner = runnerProfile.data
  const name = station?.profile.name ?? runner?.name ?? player.displayName
  const holding = snapshot?.batons.some(baton => baton.holder.id === player.id && baton.status !== 'completed') ?? false
  const level = station?.profile.level ?? runner?.level ?? null
  const seasonRank = station?.profile.seasonRank ?? runner?.seasonRank ?? null

  return (
    <Screen title="Profile" entryKey={entryKey}>
      <ProfileHeader name={name} handle={player.handle} wallet={player.walletAddress} country={runner?.country ?? null} holder={holding} you={false} />
      {level !== null && seasonRank !== null && <LevelPlate level={level} seasonRank={seasonRank} xp={station?.profile.xp ?? null} />}

      {runner ? (
        <RunnerStats profile={runner} />
      ) : runnerProfile.isError ? (
        <div className="nr-panel">
          <p>Your runner record didn’t load.</p>
          <div className="nr-actions">
            <Button variant="secondary" onClick={() => void runnerProfile.refetch()}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <Loading label="Loading your runner record" />
      )}

      <div className="nr-actions">
        <LinkButton variant="secondary" to={pathFor('runner', { handle: player.handle })}>
          Public runner page
        </LinkButton>
        <Button variant="secondary" onClick={() => action.run(() => shareLink(`${name} on NIM Relay`, pathFor('runner', { handle: player.handle })))}>
          Share runner link
        </Button>
      </div>

      <RelayGrantsPanel />

      {runner && (
        <>
          <AtlasProfileSection atlas={runner.atlas} />
          <RelayHistory batons={runner.historicBatons} />
          <AchievementShelf achievements={runner.achievements} />
          <ArtifactTiles artifacts={runner.artifacts} codes={lookups.batonCodes} />
          <RecentRunners runners={runner.recentRunners} wallets={lookups.walletsByHandle} />
        </>
      )}

      {station && <Locker data={station} />}
      <ProfileSettings currentName={name} countryConsent={snapshot ? snapshot.countryConsent : null} />
      <ProofDisclosure wallet={player.walletAddress} />

      <div className="nr-actions nr-actions--stack">
        <Button variant="quiet" block onClick={replayProductTour}>
          Take the product tour
        </Button>
        <LinkButton variant="quiet" block to={pathFor('privacy')}>
          Privacy and your data
        </LinkButton>
        <Button
          variant="danger"
          block
          busy={action.pending}
          onClick={() =>
            action.run(async () => {
              await signOut(client)
              navigate('/', { replace: true })
            })
          }
        >
          Sign out
        </Button>
      </div>
    </Screen>
  )
}
