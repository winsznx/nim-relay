import type { NetworkNotification } from '@nim-relay/shared'
import { RelayNoteQuote } from '../handoff/RelayNoteQuote'
import * as api from '../relays/api'
import { useNetwork, useNow, useRefreshNetwork } from '../relays/data'
import { formatAgo } from '../relays/format'
import { navigate, pathFor } from '../shell/router'
import { useSession } from '../shell/session'
import { useAction } from '../shell/use-action'
import { LinkButton } from '../shell/ui/Button'
import { Countdown } from '../shell/ui/Countdown'
import { Icon } from '../shell/ui/Icon'
import { EmptyState, Loading, SectionHeader } from '../shell/ui/primitives'
import { Screen } from '../shell/ui/Screen'
import { inboxSections, type InboxItem } from './model/inbox'
import { SignInPrompt } from './SignInPrompt'
import './inbox/inbox.css'
import './social.css'

function markRead(ids: readonly string[], refresh: () => void): void {
  if (ids.length === 0) return
  Promise.all(ids.map(id => api.markNotificationRead(id)))
    .then(refresh)
    .catch((error: unknown) => console.warn('Notification stays unread', error))
}

/** The sender's note on the incoming baton an item stands for, if the pass carried one. */
function noteOf(item: InboxItem, inbox: readonly NetworkNotification[]): string | null {
  return inbox.find(notice => notice.type === 'incoming_baton' && notice.note && (notice.id === item.key || item.unreadIds.includes(notice.id)))?.note ?? null
}

function Item({ item, urgent, now, note, tour }: { item: InboxItem; urgent: boolean; now: number; note: string | null; tour?: string | undefined }) {
  const action = useAction()
  const refresh = useRefreshNetwork()
  const open = () => {
    markRead(item.unreadIds, refresh)
    const target = item.action
    if (target.kind === 'open') {
      navigate(target.to)
      return
    }
    action.run(async () => {
      await api.acceptReservation(target.batonId)
      refresh()
      navigate(target.to)
    })
  }
  return (
    <li data-tour={tour}>
      <button type="button" className={`nr-inbox-item${urgent ? ' nr-inbox-item--now' : ''}${item.highlight ? ' nr-inbox-item--highlight' : ''}`} aria-busy={action.pending || undefined} disabled={action.pending} onClick={open}>
        <span className="nr-inbox-item__dot" aria-hidden="true" />
        <span className="nr-inbox-item__body">
          <span className="nr-inbox-item__title">
            {item.title}
            {item.unreadIds.length > 0 && <span className="nr-visually-hidden">, unread</span>}
          </span>
          <span className="nr-inbox-item__text">{item.body}</span>
          {note && <RelayNoteQuote text={note} inline />}
          {item.deadline ? (
            <span className="nr-inbox-item__deadline">
              {item.deadline.label} <Countdown to={item.deadline.at} onElapsed={refresh} />
            </span>
          ) : item.at !== null && !urgent ? (
            <span className="nr-inbox-item__time nr-num">{formatAgo(item.at, now)}</span>
          ) : null}
        </span>
        <span className="nr-inbox-item__cta">
          {item.cta}
          <Icon name="chevron" size={15} />
        </span>
      </button>
    </li>
  )
}

export function InboxScreen({ entryKey }: { entryKey: string }) {
  const { player } = useSession()
  const { snapshot, loading } = useNetwork()
  const now = useNow()

  if (!player) {
    return (
      <Screen title="Inbox" entryKey={entryKey}>
        <SignInPrompt title="Your batons arrive here" body="When someone passes you a baton, beats your ghost or invites you to a match, it shows up in your inbox." reason="Sign in to receive batons and challenges." tour="inbox-turns" />
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

  const { now: needsYou, updates } = inboxSections(snapshot, player.id)
  if (needsYou.length === 0 && updates.length === 0) {
    return (
      <Screen title="Inbox" entryKey={entryKey}>
        <EmptyState title="Nothing needs you right now" body="Incoming batons, ghost battles and crew streaks land here. Ride today’s Daily or look around the Relay Station while you wait." tour="inbox-turns">
          <div className="nr-actions">
            <LinkButton variant="primary" to={pathFor('daily')}>
              Ride today’s Daily
            </LinkButton>
            <LinkButton variant="secondary" to={pathFor('station')}>
              Open the Relay Station
            </LinkButton>
          </div>
        </EmptyState>
      </Screen>
    )
  }

  return (
    <Screen title="Inbox" entryKey={entryKey}>
      {needsYou.length > 0 && (
        <section aria-labelledby="inbox-now">
          <SectionHeader id="inbox-now" title="Needs you now" detail={needsYou.length === 1 ? 'One thing only you can move' : `${needsYou.length} things only you can move`} />
          <ul className="nr-inbox-list">
            {needsYou.map((item, index) => (
              <Item key={item.key} item={item} urgent now={now} note={noteOf(item, snapshot.inbox)} tour={index === 0 ? 'inbox-turns' : undefined} />
            ))}
          </ul>
        </section>
      )}
      {updates.length > 0 && (
        <section className={needsYou.length > 0 ? 'nr-section' : undefined} aria-labelledby="inbox-updates" data-tour="inbox-updates">
          <SectionHeader id="inbox-updates" title="Updates" />
          <ul className="nr-inbox-list nr-inbox-list--updates" aria-label="Notifications">
            {updates.map(item => (
              <Item key={item.key} item={item} urgent={false} now={now} note={noteOf(item, snapshot.inbox)} />
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
