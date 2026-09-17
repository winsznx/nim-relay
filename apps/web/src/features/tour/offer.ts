import type { NetworkSnapshot } from '@nim-relay/shared'
import type { RouteMatch } from '../shell/router'
import type { TourState } from './state'

/**
 * When a first-time visitor is invited to the tour. The full offer waits for a calm world home; a visit that began
 * with something urgent gets, at most once a session, a quiet prompt once that is dealt with.
 */

export type TourPrompt = 'offer' | 'nudge'
export type OfferDecision = 'none' | 'wait' | 'defer' | TourPrompt

/** Remembered for the browser session, so a reload in the middle of a handoff doesn't change the answer. */
export interface TourSessionFlags {
  /** The full offer was shown. */
  offered: boolean
  /** Something urgent came first, so only the quiet prompt may follow. */
  deferred: boolean
  /** The quiet prompt was shown. */
  nudged: boolean
}

export interface OfferInput {
  tourState: TourState
  touring: boolean
  /** Session, synced progress, network and globe have all finished loading. */
  settled: boolean
  /** An urgent route or state right now. */
  urgent: boolean
  /** The visit started on a leg or an invitation. */
  entryUrgent: boolean
  /** On the world home with no sheet open. */
  onWorldHome: boolean
  flags: TourSessionFlags
}

const NO_FLAGS: TourSessionFlags = { offered: false, deferred: false, nudged: false }

/** A race or an invitation: the runner came for that, not for a tour. */
export function isUrgentRoute(name: RouteMatch['name']): boolean {
  return name === 'leg' || name === 'invite'
}

/** Something only this runner can move right now: an arrived baton, a leg to carry, a reservation, or a pass to finish or recover. */
export function hasUrgentState(snapshot: NetworkSnapshot | undefined, playerId: string | null): boolean {
  if (!snapshot || !playerId) return false
  if (snapshot.pendingHandoff) return true
  if (snapshot.inbox.some(item => item.readAt === null && (item.type === 'incoming_baton' || item.type === 'your_turn'))) return true
  return snapshot.batons.some(
    baton => (baton.status === 'active' && baton.holder.id === playerId) || (baton.status !== 'completed' && baton.recipientId === playerId && baton.holder.id !== playerId && baton.recipientAcceptedAt === null),
  )
}

export function offerDecision({ tourState, touring, settled, urgent, entryUrgent, onWorldHome, flags }: OfferInput): OfferDecision {
  if (tourState !== 'not_seen' || touring || flags.offered || flags.nudged) return 'none'
  if (entryUrgent && !flags.deferred) return 'defer'
  if (!settled) return 'wait'
  if (urgent) return flags.deferred ? 'wait' : 'defer'
  if (!onWorldHome) return 'wait'
  return flags.deferred ? 'nudge' : 'offer'
}

export interface SessionStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function flagsKey(tourId: string, version: string): string {
  return `nim-relay-tour-session:${tourId}:${version}`
}

export function readSessionFlags(tourId: string, version: string, storage: () => SessionStore | null): TourSessionFlags {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(flagsKey(tourId, version)) ?? 'null')
    if (!value || typeof value !== 'object') return NO_FLAGS
    const flag = (name: keyof TourSessionFlags) => Reflect.get(value, name) === true
    return { offered: flag('offered'), deferred: flag('deferred'), nudged: flag('nudged') }
  } catch {
    // Unreadable session storage: this visit starts without flags.
    return NO_FLAGS
  }
}

export function writeSessionFlags(tourId: string, version: string, flags: TourSessionFlags, storage: () => SessionStore | null): void {
  try {
    storage()?.setItem(flagsKey(tourId, version), JSON.stringify(flags))
  } catch (error) {
    // Blocked session storage: the flags last until this page reloads.
    console.warn('Tour prompt state was not kept for this session', error)
  }
}

export const browserSessionStore = (): SessionStore | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Reading window.sessionStorage itself throws when site data is blocked.
    return null
  }
}
