import type { NetworkNotification, NetworkSnapshot } from '@nim-relay/shared'
import * as api from '../relays/api'
import { useNetwork, useNow, useRefreshNetwork } from '../relays/data'
import { formatAgo, formatNim } from '../relays/format'
import { watchPath } from '../relays/JourneyRoute'
import { navigate, pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { Icon } from '../shell/ui/Icon'
import { EmptyState, Loading, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { SignInPrompt } from './SignInPrompt'
import './social.css'

/** Where each notice takes the player: straight to the thing they can act on. */
function destination(item: NetworkNotification, snapshot: NetworkSnapshot): string {
  const code = item.batonId ? (snapshot.batons.find(baton => baton.id === item.batonId)?.code ?? item.batonId) : null
  switch (item.type) {
    case 'crew_streak_risk':
      return pathFor('crew')
    case 'daily_active':
      return pathFor('daily')
    case 'rival_update':
      return code ? pathFor('relay', { code }) : pathFor('rivals')
    case 'ghost_beaten':
      return item.runId && code ? watchPath(item.runId, code) : code ? pathFor('relay', { code }) : pathFor('inbox')
    default:
      return code ? pathFor('relay', { code }) : pathFor('world')
  }
}

export function InboxScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const refresh = useRefreshNetwork()
  const now = useNow()

  if (!player) {
    return (
      <Screen title="Inbox" entryKey={entryKey}>
        <SignInPrompt title="Your batons arrive here" body="When someone passes you a baton, beats your ghost or invites you to a match, it shows up in your inbox." reason="Sign in to receive batons and challenges." />
      </Screen>
    )
  }
  if (!snapshot) {
    return (
      <Screen title="Inbox" entryKey={entryKey}>
        {loading ? <Loading label="Opening your inbox" /> : <EmptyState title="Inbox didn’t load" body="The relay server isn’t answering. Try again in a moment." />}
      </Screen>
    )
  }

  const open = (item: NetworkNotification) => {
    if (item.readAt === null) {
      api
        .markNotificationRead(item.id)
        .then(refresh)
        .catch((error: unknown) => console.warn('Notification stays unread', error))
    }
    navigate(destination(item, snapshot))
  }
  const pending = snapshot.pendingHandoff
  const pendingCode = pending ? snapshot.batons.find(baton => baton.id === pending.batonId)?.code : undefined
  const quietCrews = snapshot.crews.filter(crew => crew.members.some(member => member.id === player.id) && crew.todayHandoffs === 0)

  return (
    <Screen title="Inbox" entryKey={entryKey}>
      {pending && pendingCode && (
        <button type="button" className="nr-alert" onClick={() => navigate(pathFor('relay', { code: pendingCode }))}>
          <span className="nr-row__body">
            <span className="nr-row__title">Finish your pass to {pending.recipientName}</span>
            <span className="nr-row__meta">
              {formatNim(pending.value)} on leg {pending.leg} is prepared but not confirmed yet.
            </span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      {snapshot.inbox.length === 0 ? (
        <EmptyState title="Nothing waiting" body="Incoming batons, ghost battles and rematches land here. Start a relay or ride today’s Daily while you wait." />
      ) : (
        <ul className="nr-list" aria-label="Notifications">
          {snapshot.inbox.map(item => (
            <li key={item.id}>
              <button type="button" className={`nr-row nr-notice${item.readAt === null ? ' nr-notice--unread' : ''}`} onClick={() => open(item)}>
                <span className="nr-notice__dot" aria-hidden="true" />
                <span className="nr-row__body">
                  <span className="nr-row__title">
                    {item.title}
                    {item.readAt === null && <span className="nr-visually-hidden">, unread</span>}
                  </span>
                  <span className="nr-row__meta">{item.body}</span>
                </span>
                <span className="nr-row__aside nr-num">{formatAgo(item.createdAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {quietCrews.length > 0 && (
        <section className="nr-section" aria-labelledby="inbox-crews">
          <SectionHeader id="inbox-crews" title="Crew streaks" />
          <ul className="nr-list">
            {quietCrews.map(crew => (
              <li key={crew.id}>
                <button type="button" className="nr-row" onClick={() => navigate(pathFor('crew'))}>
                  <span className="nr-row__body">
                    <span className="nr-row__title">{crew.name} needs a pass today</span>
                    <span className="nr-row__meta">
                      {crew.streak} day streak. Resets at {new Date(crew.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </span>
                  </span>
                  <Icon name="chevron" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
