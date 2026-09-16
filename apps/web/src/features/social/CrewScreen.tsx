import { useState, type CSSProperties } from 'react'
import type { NetworkCrew, NetworkSnapshot } from '@nim-relay/shared'
import * as api from '../relays/api'
import { useNetwork, useRefreshNetwork } from '../relays/data'
import { formatCount, initials } from '../relays/format'
import { linkProps, pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { copyText } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button } from '../shell/ui/Button'
import { HexBadge } from '../shell/ui/HexBadge'
import { Icon } from '../shell/ui/Icon'
import { Loading, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { ShareCardButton } from './cards/ShareCardButton'
import { CrewBaton, CrewHistory, CrewMembers } from './crew/CrewParts'
import { CrewStreak } from './crew/CrewStreak'
import { crewColor, crewOf } from './model/crew'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

const crewStyle = (crew: NetworkCrew) => ({ '--nr-crew-color': crewColor(crew.id) }) as CSSProperties

/** Shares the join code with a message, falling back to copying the code. */
async function shareInvite(crew: NetworkCrew, code: string): Promise<void> {
  const text = `Join ${crew.name} on NIM Relay with crew code ${code}.`
  if (navigator.share) {
    await navigator.share({ title: `Join ${crew.name}`, text, url: new URL(pathFor('crew'), window.location.origin).href })
    return
  }
  await copyText(code, 'Crew code copied.')
}

function YourCrew({ crew, snapshot, playerId }: { crew: NetworkCrew; snapshot: NetworkSnapshot; playerId: string }) {
  const action = useAction()
  const refresh = useRefreshNetwork()
  // The server reveals a crew's join code to its members only.
  const code = crew.code
  return (
    <div className="nr-crew" style={crewStyle(crew)}>
      <header className="nr-crew__head">
        <HexBadge tone="crew" size={56}>
          {initials(crew.name)}
        </HexBadge>
        <div className="nr-crew__titles">
          <h2 className="nr-crew__name">{crew.name}</h2>
          <p className="nr-crew__meta">
            {formatCount(crew.members.length)} {crew.members.length === 1 ? 'runner' : 'runners'}
          </p>
        </div>
      </header>

      <CrewStreak crew={crew} onDayEnds={refresh} />
      {crew.streak > 0 && (
        <div className="nr-actions">
          <ShareCardButton block card={{ kind: 'crew', crewName: crew.name, streak: crew.streak, bestStreak: crew.bestStreak, members: crew.members.length, color: crewColor(crew.id) }}>
            Share the streak card
          </ShareCardButton>
        </div>
      )}

      <CrewBaton crew={crew} snapshot={snapshot} playerId={playerId} />
      <CrewMembers crew={crew} playerId={playerId} />
      <CrewHistory crew={crew} snapshot={snapshot} playerId={playerId} />

      {code && (
        <section className="nr-section" aria-labelledby="crew-invite">
          <SectionHeader id="crew-invite" title="Invite a runner" detail={crew.members.length >= 5 ? 'The crew is full at five runners.' : 'Anyone with this code can join while there is room.'} />
          <div className="nr-crew-invite">
            <button type="button" className="nr-code-chip" onClick={() => action.run(() => copyText(code, 'Crew code copied.'))} aria-label={`Copy crew code ${code}`}>
              <span className="nr-hash">{code}</span>
              <Icon name="copy" size={15} />
            </button>
            <Button variant="secondary" disabled={crew.members.length >= 5} busy={action.pending} onClick={() => action.run(() => shareInvite(crew, code))}>
              <Icon name="share" size={18} />
              Share invite
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function JoinOrCreate() {
  const action = useAction()
  const refresh = useRefreshNetwork()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  return (
    <>
      <p className="nr-lede">A crew is up to five runners who keep a streak alive together. One verified pass between members each day counts.</p>
      <form
        className="nr-panel"
        onSubmit={event => {
          event.preventDefault()
          action.run(async () => {
            await api.createNetworkCrew(name.trim())
            setName('')
            refresh()
          })
        }}
      >
        <label className="nr-field">
          <span className="nr-field__label">Crew name</span>
          <input className="nr-input" value={name} onChange={event => setName(event.target.value)} minLength={3} maxLength={28} required placeholder="3 to 28 characters" />
        </label>
        <Button type="submit" variant="primary" block busy={action.pending} disabled={name.trim().length < 3}>
          Create crew
        </Button>
      </form>
      <form
        className="nr-panel"
        onSubmit={event => {
          event.preventDefault()
          action.run(async () => {
            await api.joinNetworkCrew(code.trim())
            setCode('')
            refresh()
          })
        }}
      >
        <label className="nr-field">
          <span className="nr-field__label">Crew code</span>
          <input className="nr-input nr-hash" value={code} onChange={event => setCode(event.target.value.toUpperCase())} required autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="From a crew member" />
        </label>
        <Button type="submit" variant="secondary" block busy={action.pending} disabled={code.trim().length === 0}>
          Join crew
        </Button>
      </form>
    </>
  )
}

function OtherCrews({ crews }: { crews: readonly NetworkCrew[] }) {
  if (crews.length === 0) return null
  const ranked = [...crews].sort((a, b) => b.streak - a.streak || b.members.length - a.members.length)
  return (
    <section className="nr-section" aria-labelledby="other-crews">
      <SectionHeader id="other-crews" title="Crews on the network" detail="Join codes are shared by each crew’s members." />
      <ul className="nr-list">
        {ranked.map(crew => (
          <li key={crew.id} className="nr-row" style={crewStyle(crew)}>
            <HexBadge tone="crew" size={30}>
              {initials(crew.name)}
            </HexBadge>
            <span className="nr-row__body">
              <span className="nr-row__title">{crew.name}</span>
              <span className="nr-row__meta">
                {formatCount(crew.members.length)} {crew.members.length === 1 ? 'runner' : 'runners'}
              </span>
            </span>
            <span className="nr-row__aside nr-num">{crew.streak > 0 ? `${formatCount(crew.streak)} day streak` : 'No streak yet'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CrewScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const yourCrew = snapshot && player ? crewOf(snapshot.crews, player.id) : null
  return (
    <Screen
      title="Crew"
      entryKey={entryKey}
      actions={
        <a className="nr-button nr-button--sm nr-button--secondary" {...linkProps(pathFor('rivals'))}>
          Rivals
        </a>
      }
    >
      {!player ? (
        <SignInPrompt title="Keep it moving together" body="Crews share batons and a daily streak. Sign in to create one or join with a code." reason="Sign in to create or join a crew." />
      ) : !snapshot ? (
        loading && <Loading label="Loading crews" />
      ) : yourCrew ? (
        <YourCrew crew={yourCrew} snapshot={snapshot} playerId={player.id} />
      ) : (
        <JoinOrCreate />
      )}
      <OtherCrews crews={snapshot?.crews.filter(crew => crew.id !== yourCrew?.id) ?? []} />
    </Screen>
  )
}
