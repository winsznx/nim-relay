import type { NetworkBaton, NetworkNotification, NetworkSnapshot } from '@nim-relay/shared'
import { formatCount, formatNim } from '../../relays/format'
import { practicePath } from '../../relays/paths'
import { pathFor } from '../../shell/router'
import { crewOf, streakState } from './crew'

const DAY_MS = 86_400_000

export type InboxAction =
  | { kind: 'open'; to: string }
  /** Accept the reservation, then open the journey. */
  | { kind: 'accept'; batonId: string; to: string }

export interface InboxItem {
  key: string
  title: string
  body: string
  /** Names the item's one action. */
  cta: string
  action: InboxAction
  /** Unread notifications the item stands for. Opening the item marks them read. */
  unreadIds: string[]
  /** Needs attention: unread, or live state that is waiting on the runner. */
  highlight: boolean
  at: number | null
  /** A real deadline for the countdown, with what happens when it passes. */
  deadline: { at: number; label: string } | null
}

export interface InboxSections {
  /** Things only the runner can move forward, most urgent first. */
  now: InboxItem[]
  /** Everything else that happened, newest first. */
  updates: InboxItem[]
}

/** Reservations for Quick and Global relays release a day after they were made unless accepted (apps/worker RESERVATION_ACCEPT_MS). */
function acceptanceDeadline(baton: NetworkBaton): number | null {
  if (baton.mode !== 'quick' && baton.mode !== 'global') return null
  return baton.recipientReservedAt === null ? null : baton.recipientReservedAt + DAY_MS
}

function updateItem(item: NetworkNotification, codeOf: (batonId: string | null) => string | null): InboxItem {
  const code = codeOf(item.batonId)
  const journey = code ? pathFor('relay', { code }) : null
  const base = { key: item.id, title: item.title, body: item.body, unreadIds: item.readAt === null ? [item.id] : [], highlight: item.readAt === null, at: item.createdAt, deadline: null }
  const open = (cta: string, to: string): InboxItem => ({ ...base, cta, action: { kind: 'open', to } })
  switch (item.type) {
    case 'ghost_beaten':
      return item.runId ? open('Race again', practicePath(item.runId, code)) : open('View', journey ?? pathFor('world'))
    case 'rematch':
      return open('Rematch', journey ?? pathFor('world'))
    case 'rival_update':
      return open('See rivalry', pathFor('rivals'))
    case 'recipient_timeout':
    case 'pass_not_sent':
      return open('Choose runner', journey ?? pathFor('world'))
    case 'daily_active':
      return open('Ride', pathFor('daily'))
    case 'crew_streak_risk':
      return open('Crew', pathFor('crew'))
    case 'incoming_baton':
    case 'your_turn':
      return open('View', journey ?? pathFor('world'))
    default:
      // A notification type added on the server after this bundle loaded still renders instead of breaking the inbox.
      return open('View', journey ?? pathFor('world'))
  }
}

export function inboxSections(snapshot: NetworkSnapshot, playerId: string): InboxSections {
  const batons = new Map(snapshot.batons.map(baton => [baton.id, baton]))
  const codeOf = (batonId: string | null) => (batonId ? (batons.get(batonId)?.code ?? null) : null)
  const unread = snapshot.inbox.filter(item => item.readAt === null)
  const claimed = new Set<string>()
  const claim = (items: readonly NetworkNotification[]) => {
    for (const item of items) claimed.add(item.id)
    return items.map(item => item.id)
  }
  const now: InboxItem[] = []

  const pending = snapshot.pendingHandoff
  const pendingCode = pending ? codeOf(pending.batonId) : null
  if (pending && pendingCode) {
    now.push({
      key: `pending-${pending.id}`,
      title: `Finish your pass to ${pending.recipientName}`,
      body: `${formatNim(pending.value)} on leg ${formatCount(pending.leg)} is prepared but not confirmed yet.`,
      cta: 'Finish',
      action: { kind: 'open', to: pathFor('relay', { code: pendingCode }) },
      unreadIds: [],
      highlight: true,
      at: pending.createdAt,
      deadline: null,
    })
  }

  for (const baton of snapshot.batons) {
    if (baton.holder.id !== playerId || baton.status === 'completed' || baton.id === pending?.batonId) continue
    const arrivals = unread.filter(item => item.batonId === baton.id && (item.type === 'incoming_baton' || item.type === 'your_turn' || item.type === 'rematch'))
    const arrival = arrivals.find(item => item.type === 'incoming_baton')
    now.push({
      key: `turn-${baton.id}`,
      title: arrival?.title ?? `Your turn with ${baton.displayName}`,
      body: baton.status === 'stranded' ? `${baton.displayName} is waiting on you. Race your leg to move it again.` : `Leg ${formatCount(baton.handoffCount + 1)} of ${baton.displayName}. Race it, then pass the baton on.`,
      cta: 'Carry',
      action: { kind: 'open', to: pathFor('leg', { code: baton.code }) },
      unreadIds: claim(arrivals),
      highlight: true,
      at: arrival?.createdAt ?? baton.updatedAt,
      deadline: baton.status === 'active' ? { at: baton.expiresAt, label: 'Strands in' } : null,
    })
  }

  for (const baton of snapshot.batons) {
    if (baton.recipientId !== playerId || baton.recipientAcceptedAt !== null || baton.status === 'completed' || baton.holder.id === playerId) continue
    const invites = unread.filter(item => item.batonId === baton.id && (item.type === 'your_turn' || item.type === 'rematch'))
    const lapses = acceptanceDeadline(baton)
    now.push({
      key: `reserved-${baton.id}`,
      title: `${baton.holder.name} saved the next leg for you`,
      body: `${baton.displayName}. Accept it so the reservation doesn’t lapse.`,
      cta: 'Accept',
      action: { kind: 'accept', batonId: baton.id, to: pathFor('relay', { code: baton.code }) },
      unreadIds: claim(invites),
      highlight: true,
      at: baton.recipientReservedAt,
      deadline: lapses === null ? null : { at: lapses, label: 'Lapses in' },
    })
  }

  const crew = crewOf(snapshot.crews, playerId)
  if (crew && streakState(crew) === 'at-risk') {
    now.push({
      key: `crew-${crew.id}`,
      title: `${crew.name} needs a pass today`,
      body: `Your ${formatCount(crew.streak)}-day streak ends at midnight UTC without one verified pass between members.`,
      cta: 'Keep it',
      action: { kind: 'open', to: pathFor('crew') },
      unreadIds: claim(unread.filter(item => item.type === 'crew_streak_risk')),
      highlight: true,
      at: null,
      deadline: { at: crew.deadline, label: 'Streak ends in' },
    })
  }

  const updates = snapshot.inbox
    .filter(item => !claimed.has(item.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(item => updateItem(item, codeOf))
  return { now, updates }
}
