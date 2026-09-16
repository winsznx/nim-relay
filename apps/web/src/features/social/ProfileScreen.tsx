import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { StationSnapshot } from '@nim-relay/shared'
import * as station from '../../station/api'
import * as api from '../relays/api'
import { useNetwork, useRefreshNetwork, useRunnerProfile, useStationProfile } from '../relays/data'
import { formatCount } from '../relays/format'
import { linkProps, navigate, pathFor } from '../shell/router'
import { signOut, useSession } from '../shell/session'
import { shareLink } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button, LinkButton } from '../shell/ui/Button'
import { Avatar, Loading, SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { AchievementList, RelayHistory } from './RunnerParts'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

const CATEGORY_LABELS: Record<StationSnapshot['cosmetics'][number]['category'], string> = { suit: 'Suit', helmet: 'Helmet', board: 'Board', trail: 'Trail' }

function Locker({ data }: { data: StationSnapshot }) {
  const client = useQueryClient()
  const action = useAction()
  const { profile, cosmetics } = data
  return (
    <section className="nr-section" aria-labelledby="locker">
      <SectionHeader id="locker" title="Courier locker" detail={`${formatCount(profile.xp)} XP earned. Items unlock with XP from verified rides.`} />
      <ul className="nr-locker">
        {cosmetics.map(item => {
          const unlocked = profile.unlocked.includes(item.id)
          const equipped = profile.equipped[item.category] === item.id
          return (
            <li key={item.id} className={`nr-locker__item${equipped ? ' nr-locker__item--equipped' : ''}`}>
              <span className="nr-locker__category">{CATEGORY_LABELS[item.category]}</span>
              <span className="nr-locker__name">{item.name}</span>
              <Button
                variant={equipped ? 'quiet' : 'secondary'}
                size="sm"
                disabled={!unlocked || equipped || action.pending}
                onClick={() =>
                  action.run(async () => {
                    client.setQueryData(['station'], await station.customizeCourier({ category: item.category, cosmetic: item.id }))
                  })
                }
              >
                {equipped ? 'Equipped' : unlocked ? 'Equip' : `${formatCount(item.xp)} XP`}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function ProfileScreen({ entryKey }: { entryKey: string }) {
  const client = useQueryClient()
  const { player } = useSession()
  const stationProfile = useStationProfile()
  const runnerProfile = useRunnerProfile(player?.handle ?? '')
  const { snapshot } = useNetwork()
  const refresh = useRefreshNetwork()
  const action = useAction()
  const [name, setName] = useState('')

  if (!player) {
    return (
      <Screen title="Profile" entryKey={entryKey}>
        <SignInPrompt title="Your runner lives here" body="Your level, relays, achievements and courier locker. Sign in once and they follow you." reason="Sign in to open your runner profile." />
        <p className="nr-note">
          <a {...linkProps(pathFor('privacy'))}>How NIM Relay handles your data</a>
        </p>
      </Screen>
    )
  }
  const data = stationProfile.data
  const profile = data?.profile
  const publicProfile = runnerProfile.data ?? null
  const relays = snapshot?.batons.filter(baton => baton.origin.id === player.id || baton.holder.id === player.id) ?? []

  return (
    <Screen title="Profile" entryKey={entryKey}>
      <div className="nr-profile-head">
        <Avatar name={profile?.name ?? player.displayName} holder={relays.some(baton => baton.holder.id === player.id && baton.status === 'active')} size={64} />
        <div>
          <h2 className="nr-profile-head__name">{profile?.name ?? player.displayName}</h2>
          <p className="nr-profile-head__meta">@{player.handle}</p>
          {profile && (
            <p className="nr-profile-head__rank">
              Level {profile.level}, {profile.seasonRank}
            </p>
          )}
        </div>
      </div>

      {!data ? (
        <Loading label="Loading your runner" />
      ) : (
        <StatRow columns={3} label="Runner statistics">
          <Stat value={formatCount(data.profile.handoffs)} label="handoffs passed" gold />
          <Stat value={formatCount(data.profile.runs)} label="verified rides" />
          <Stat value={formatCount(data.profile.xp)} label="XP" />
          {publicProfile && <Stat value={formatCount(publicProfile.legs)} label="relay legs" />}
          {publicProfile && <Stat value={`${formatCount(publicProfile.ghostWins)}–${formatCount(publicProfile.ghostLosses)}`} label="ghost races won" />}
          {publicProfile && <Stat value={`${formatCount(publicProfile.quick.wins)}–${formatCount(publicProfile.quick.losses)}`} label="quick matches won" />}
        </StatRow>
      )}

      <div className="nr-actions">
        <LinkButton variant="secondary" to={pathFor('runner', { handle: player.handle })}>
          Public runner page
        </LinkButton>
        <Button variant="secondary" onClick={() => action.run(() => shareLink(`${player.displayName} on NIM Relay`, pathFor('runner', { handle: player.handle })))}>
          Share runner link
        </Button>
      </div>

      <RelayHistory batons={publicProfile?.historicBatons ?? relays.map(baton => ({ id: baton.id, code: baton.code, displayName: baton.displayName, handoffCount: baton.handoffCount, role: baton.origin.id === player.id ? ('origin' as const) : ('holder' as const) }))} />
      <AchievementList achievements={publicProfile?.achievements ?? null} legacy={profile?.achievements ?? []} artifacts={publicProfile?.artifacts ?? []} />

      <section className="nr-section" aria-labelledby="settings">
        <SectionHeader id="settings" title="Settings" />
        <form
          className="nr-inline-form"
          onSubmit={event => {
            event.preventDefault()
            action.run(async () => {
              client.setQueryData(['station'], await station.customizeCourier({ name: name.trim() }))
              setName('')
              refresh()
            })
          }}
        >
          <label className="nr-field">
            <span className="nr-field__label">Runner name</span>
            <input className="nr-input" value={name} onChange={event => setName(event.target.value)} placeholder={profile?.name ?? player.displayName} maxLength={24} />
          </label>
          <Button type="submit" variant="secondary" disabled={name.trim().length < 2} busy={action.pending}>
            Save name
          </Button>
        </form>
        <label className="nr-check nr-check--setting">
          <input
            type="checkbox"
            checked={snapshot?.countryConsent ?? false}
            disabled={!snapshot || action.pending}
            onChange={event => {
              const consent = event.target.checked
              action.run(async () => {
                await api.setCountryConsent(consent)
                refresh()
              })
            }}
          />
          <span>
            Show my country on relay routes
            <span className="nr-field__hint">Approximate, from your network connection. Off by default. No exact location or IP address is kept.</span>
          </span>
        </label>
      </section>

      {data && <Locker data={data} />}

      <div className="nr-actions nr-actions--stack">
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
