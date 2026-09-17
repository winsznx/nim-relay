import type { TourTrackInput } from '@nim-relay/shared'
import * as api from '../relays/api'
import { visitorKey } from '../relays/data'
import type { TourTrackEvent } from './controller'

/**
 * Reports a tour event for the operators' onboarding funnel. Best effort: a failed report never affects the tour.
 * Only tour, step and entry route travel, with the same per-device visitor key share counts use.
 */
export function trackTourEvent(event: TourTrackEvent): void {
  const visitor = visitorKey()
  const input: TourTrackInput = { kind: 'tour', ...event, ...(visitor ? { visitor } : {}) }
  api.trackEvent(input).catch((error: unknown) => console.warn('Tour event was not counted', error))
}
