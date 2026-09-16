import type { BatonHandoff, NetworkCrew, NetworkSnapshot } from '@nim-relay/shared'
import { BatonEmblem } from '../../baton/BatonEmblem'
import * as api from '../../relays/api'
import { useBatonDetails, useNow, useRefreshNetwork, useRelays } from '../../relays/data'
import { formatAgo, formatCount } from '../../relays/format'
import { crewBatonInPlay, crewContributions, recentCrewBatonCodes, recentCrewHandoffs } from '../model/crew'
import { linkProps, navigate, pathFor } from '../../shell/router'
import { useAction } from '../../shell/use-action'
import { Button, LinkButton } from '../../shell/ui/Button'
import { SectionHeader } from '../../shell/ui/primitives'
import { ProgressBar } from '../../shell/ui/ProgressBar'
import { RunnerAvatar } from '../../shell/ui/RunnerAvatar'
import './crew.css'

/** The crew baton in play and the one thing each member can do with it. */
export function CrewBaton({ crew, snapshot, playerId }: { crew: NetworkCrew; snapshot: NetworkSnapshot; playerId: string }) {
  const { relays } = useRelays()
  const action = useAction()
  const refresh = useRefreshNetwork()
  const baton = crewBatonInPlay(crew, snapshot.batons)
  const relay = baton ? relays.find(item => item.id === baton.id) : undefined
  const start = () =>
    action.run(async () => {
      const created = await api.createBaton({ mode: 'crew', title: '', crewId: crew.id })
      refresh()
      navigate(pathFor('relay', { code: created.baton.code }))
    })

  if (!baton) {
    return (
      <section className="nr-section" aria-labelledby="crew-baton">
        <SectionHeader id="crew-baton" title="Crew baton" />
        <p className="nr-note">No crew baton is moving. Start one with 1 NIM and pass it between members to keep the streak.</p>
        <div className="nr-actions">
          <Button variant="primary" busy={action.pending} onClick={start}>
            Start a crew baton
          </Button>
        </div>
      </section>
    )
  }

  const yours = baton.holder.id === playerId
  return (
    <section className="nr-section" aria-labelledby="crew-baton">
      <SectionHeader id="crew-baton" title="Crew baton" />
      <a className="nr-crew-baton" {...linkProps(pathFor('relay', { code: baton.code }))}>
        {relay ? <BatonEmblem appearance={relay.appearance} size={52} /> : <BatonEmblem size={52} />}
        <span className="nr-crew-baton__text">
          <span className="nr-crew-baton__name">{baton.displayName}</span>
          <span className="nr-crew-baton__holder">
            <RunnerAvatar name={baton.holder.name} wallet={baton.holder.wallet} holder size={24} />
            {yours ? 'With you now' : `With ${baton.holder.name}`}
            {baton.status === 'stranded' ? ', waiting' : ''}
          </span>
        </span>
        <span className="nr-crew-baton__leg nr-num">Leg {formatCount(baton.handoffCount + 1)}</span>
      </a>
      <div className="nr-actions">
        {yours ? (
          <LinkButton variant="primary" block to={pathFor('leg', { code: baton.code })}>
            Carry it, then pass to a member
          </LinkButton>
        ) : (
          <LinkButton variant="secondary" block to={pathFor('relay', { code: baton.code })}>
            See the journey
          </LinkButton>
        )}
      </div>
    </section>
  )
}

/** Verified crew passes each member has sent, against the crew's top contributor. */
export function CrewMembers({ crew, playerId }: { crew: NetworkCrew; playerId: string }) {
  const members = new Map(crew.members.map(member => [member.id, member]))
  return (
    <section className="nr-section" aria-labelledby="crew-members">
      <SectionHeader id="crew-members" title="Members" detail={`${formatCount(crew.members.length)} of 5 runners. Bars count verified crew passes sent.`} />
      <ul className="nr-list">
        {crewContributions(crew).map(({ memberId, passes, share }) => {
          const member = members.get(memberId)
          if (!member) return null
          const name = member.id === playerId ? 'You' : member.name
          return (
            <li key={memberId}>
              <a className="nr-row nr-contribution" {...linkProps(pathFor('runner', { handle: member.handle }))}>
                <RunnerAvatar name={member.name} wallet={member.wallet} country={member.country} size={38} />
                <span className="nr-row__body">
                  <span className="nr-contribution__line">
                    <span className="nr-row__title">{name}</span>
                    <span className="nr-contribution__count nr-num">
                      {formatCount(passes)} {passes === 1 ? 'pass' : 'passes'}
                    </span>
                  </span>
                  <ProgressBar value={share} max={1} tone="crew" size="sm" label={`${name}’s share of crew passes`} valueText={`${formatCount(passes)} passes`} />
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The newest verified passes across the crew's batons. Hidden until there is one. */
export function CrewHistory({ crew, snapshot, playerId }: { crew: NetworkCrew; snapshot: NetworkSnapshot; playerId: string }) {
  const details = useBatonDetails(recentCrewBatonCodes(crew, snapshot.batons))
  const now = useNow()
  const handoffs = recentCrewHandoffs(details.flatMap(detail => detail.handoffs))
  if (handoffs.length === 0) return null
  const batonName = (handoff: BatonHandoff) => details.find(detail => detail.baton.id === handoff.batonId)?.baton
  const who = (runner: BatonHandoff['from']) => (runner.id === playerId ? 'You' : runner.name)
  return (
    <section className="nr-section" aria-labelledby="crew-history">
      <SectionHeader id="crew-history" title="Recent crew passes" />
      <ol className="nr-list">
        {handoffs.map(handoff => {
          const baton = batonName(handoff)
          return (
            <li key={handoff.id}>
              <a className="nr-row" {...linkProps(baton ? pathFor('relay', { code: baton.code }) : pathFor('crew'))}>
                <RunnerAvatar name={handoff.to.name} wallet={handoff.to.wallet} size={34} />
                <span className="nr-row__body">
                  <span className="nr-row__title">
                    {who(handoff.from)} → {who(handoff.to)}
                  </span>
                  <span className="nr-row__meta">
                    {baton?.displayName ?? 'Crew baton'}, leg {formatCount(handoff.leg)}
                  </span>
                </span>
                <span className="nr-row__aside nr-num">{formatAgo(handoff.at, now)}</span>
              </a>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
