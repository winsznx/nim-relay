import { preferredTourRecord, TOUR_ID_PATTERN, TOUR_VERSION_PATTERN, tourVersionNumber, type PlayerPreferences, type RelayNetwork, type TourPreference, type TourPreferenceInput } from '@nim-relay/shared'
import { z } from 'zod'
import { MAX_TOUR_PREFERENCES } from './constants'
import { networkStateKey } from './state'

/** GET: the runner's preferences. */
export const PREFERENCES_PATH = '/preferences'
/** POST: records tour progress. */
export const TOUR_PREFERENCE_PATH = '/preferences/tour'

const tourPreferenceBody = z.strictObject({
  tourId: z.string().regex(TOUR_ID_PATTERN),
  version: z.string().regex(TOUR_VERSION_PATTERN),
  state: z.enum(['started', 'completed', 'skipped']),
})

export function isPreferencesPath(path: string): boolean {
  return path === PREFERENCES_PATH || path === TOUR_PREFERENCE_PATH
}

/** One small key per runner, apart from the network state, so saving a preference never rewrites or broadcasts it. */
export function preferencesKey(networkKey: string, playerId: string): string {
  return `${networkKey}:preferences:${playerId}`
}

/**
 * Applies one tour record, stamped `now`. A newer tour version replaces an older one and an older version never
 * replaces a newer one; on the same version completed and skipped beat started. Returns whether anything changed.
 */
export function applyTourPreference(preferences: PlayerPreferences, input: TourPreferenceInput, now: number): boolean {
  const current = preferences.tours[input.tourId]
  const incoming: TourPreference = { version: input.version, state: input.state, updatedAt: now }
  if (current && tourVersionNumber(input.version) < tourVersionNumber(current.version)) return false
  const next = current?.version === input.version ? (preferredTourRecord(current, incoming) ?? current) : incoming
  if (current && next.version === current.version && next.state === current.state) return false
  preferences.tours[input.tourId] = next
  const others = Object.entries(preferences.tours).filter(([tourId]) => tourId !== input.tourId)
  if (others.length >= MAX_TOUR_PREFERENCES) {
    const [oldest] = others.sort(([, a], [, b]) => a.updatedAt - b.updatedAt)[0] ?? []
    if (oldest !== undefined) delete preferences.tours[oldest]
  }
  return true
}

/** Serves both preference paths for a signed-in runner. Only a changed record is written. */
export async function handlePreferences(storage: DurableObjectStorage, network: RelayNetwork, path: string, playerId: string, body: unknown, now: number): Promise<PlayerPreferences> {
  const key = preferencesKey(networkStateKey(network), playerId)
  const preferences = (await storage.get<PlayerPreferences>(key)) ?? { tours: {} }
  if (path !== TOUR_PREFERENCE_PATH) return preferences
  if (applyTourPreference(preferences, tourPreferenceBody.parse(body), now)) await storage.put(key, preferences)
  return preferences
}
