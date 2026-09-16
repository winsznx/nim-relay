import { useState } from 'react'
import type { NetworkCrew, NetworkSnapshot } from '@nim-relay/shared'
import * as api from '../relays/api'
import { useNetwork, useRefreshNetwork } from '../relays/data'
import { formatCount } from '../relays/format'
import { linkProps, navigate, pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { copyText } from '../shell/share'
import { useAction } from '../shell/use-action'
import { Button } from '../shell/ui/Button'
import { Icon } from '../shell/ui/Icon'
import { Avatar, Loading, SectionHeader, Stat, StatRow } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

function YourCrew({ crew, snapshot, playerId }: { crew: NetworkCrew; snapshot: NetworkSnapshot; playerId: string }) {
  const action = useAction()
  const refresh = useRefreshNetwork()
  const deadline = new Date(crew.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const batons = crew.batonIds.map(id => snapshot.batons.find(baton => baton.id === id)).filter(baton => baton !== undefined)
  // The server reveals a crew's join code to its members only.
  const code = crew.code
  return (
    <section aria-labelledby="your-crew">
      <div className="nr-crew-head">
        <h2 id="your-crew">{crew.name}</h2>
        {code && (
          <button type="button" className="nr-code-chip" onClick={() => action.run(() => copyText(code, 'Invite code copied.'))} aria-label={`Copy crew invite code ${code}`}>
            <span className="nr-hash">{code}</span>
            <Icon name="copy" size={15} />
          </button>
        )}
      </div>
      <StatRow columns={3} label="Crew streak">
        <Stat value={formatCount(crew.streak)} label="day streak" gold />
        <Stat value={formatCount(crew.bestStreak)} label="best streak" />
        <Stat value={formatCount(crew.todayHandoffs)} label="passes today" />
      </StatRow>
      <p className="nr-note">{crew.todayHandoffs > 0 ? 'Today counts. Keep it moving tomorrow.' : `A verified pass between crew members before ${deadline} keeps the streak alive.`}</p>

      <section className="nr-section" aria-labelledby="crew-members">
        <SectionHeader id="crew-members" title="Members" detail={`${crew.members.length} of 5`} />
        <ul className="nr-list">
          {crew.members.map(member => (
            <li key={member.id}>
              <a className="nr-row" {...linkProps(pathFor('runner', { handle: member.handle }))}>
                <Avatar name={member.name} country={member.country} size={36} />
                <span className="nr-row__body">
                  <span className="nr-row__title">{member.id === playerId ? 'You' : member.name}</span>
                  <span className="nr-row__meta">@{member.handle}</span>
                </span>
                <span className="nr-row__aside nr-num">{formatCount(crew.contributions[member.id] ?? 0)} passes</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="nr-section" aria-labelledby="crew-batons">
        <SectionHeader id="crew-batons" title="Crew batons" />
        {batons.length === 0 && <p className="nr-note">Your crew hasn’t started a baton yet.</p>}
        <ul className="nr-list">
          {batons.map(baton => (
            <li key={baton.id}>
              <a className="nr-row" {...linkProps(pathFor('relay', { code: baton.code }))}>
                <span className="nr-row__body">
                  <span className="nr-row__title">{baton.displayName}</span>
                  <span className="nr-row__meta">Held by {baton.holder.id === playerId ? 'you' : baton.holder.name}</span>
                </span>
                <span className="nr-row__aside nr-num">{formatCount(baton.handoffCount)} handoffs</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="nr-actions">
          <Button
            variant="primary"
            busy={action.pending}
            onClick={() =>
              action.run(async () => {
                const created = await api.createBaton({ mode: 'crew', title: '', crewId: crew.id })
                refresh()
                navigate(pathFor('relay', { code: created.baton.code }))
              })
            }
          >
            Start a crew baton
          </Button>
        </div>
      </section>
    </section>
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
          <span className="nr-field__label">Invite code</span>
          <input className="nr-input nr-hash" value={code} onChange={event => setCode(event.target.value.toUpperCase())} required autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="From a crew member" />
        </label>
        <Button type="submit" variant="secondary" block busy={action.pending} disabled={code.trim().length === 0}>
          Join crew
        </Button>
      </form>
    </>
  )
}

export function CrewScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const yourCrew = player ? snapshot?.crews.find(crew => crew.members.some(member => member.id === player.id)) : undefined
  const others = snapshot?.crews.filter(crew => crew.id !== yourCrew?.id) ?? []
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
      {others.length > 0 && (
        <section className="nr-section" aria-labelledby="other-crews">
          <SectionHeader id="other-crews" title="Crews on the network" detail="Join codes are shared by each crew’s members." />
          <ul className="nr-list">
            {others.map(crew => (
              <li key={crew.id} className="nr-row">
                <span className="nr-row__body">
                  <span className="nr-row__title">{crew.name}</span>
                  <span className="nr-row__meta">
                    {crew.members.length} {crew.members.length === 1 ? 'runner' : 'runners'}
                  </span>
                </span>
                <span className="nr-row__aside nr-num">{formatCount(crew.streak)} day streak</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
