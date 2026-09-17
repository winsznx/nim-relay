/**
 * Guided tours: the product tour and the gameplay tutorial share one progress model, one preference record on the
 * server and one analytics event shape. Nothing here identifies a wallet, a device or a place.
 */

/** Lowercase words joined by hyphens, e.g. `core` or `gameplay`. */
export const TOUR_ID_PATTERN = /^[a-z0-9-]{1,40}$/
/** `v1` to `v999`. A new version is a new tour: progress on an older version does not carry over. */
export const TOUR_VERSION_PATTERN = /^v[0-9]{1,3}$/
export const TOUR_STEP_ID_PATTERN = /^[a-z0-9-]{1,40}$/

/** Progress a runner can record. `not_seen` is the absence of a record, so it is never stored. */
export type TourProgress = 'started' | 'completed' | 'skipped'

export interface TourProgressRecord {
  state: TourProgress
  updatedAt: number
}

/** One tour's recorded progress for a signed-in runner, on the tour version it was recorded for. */
export interface TourPreference extends TourProgressRecord {
  version: string
}

/** GET /network/preferences and the answer to POST /network/preferences/tour. Keyed by tour id. */
export interface PlayerPreferences {
  tours: Record<string, TourPreference>
}

/** POST /network/preferences/tour. The server stamps `updatedAt`. */
export interface TourPreferenceInput {
  tourId: string
  version: string
  state: TourProgress
}

export const TOUR_EVENTS = ['offered', 'started', 'step_viewed', 'step_completed', 'skipped', 'completed', 'replayed', 'target_missing'] as const
export type TourEvent = (typeof TOUR_EVENTS)[number]
/** Events about one step; they name it with `stepId` and `stepNumber`. `skipped` names the step only when a tour was left mid-way. */
export const TOUR_STEP_EVENTS: readonly TourEvent[] = ['step_viewed', 'step_completed', 'target_missing']

/**
 * POST /network/track for a tour. `entryRoute` is the path the visit started on, never a query or hash; the server
 * keeps only its first segment. `visitor` is the same opaque per-device key share tracking uses.
 */
export interface TourTrackInput {
  kind: 'tour'
  event: TourEvent
  tourId: string
  version: string
  stepId?: string
  /** 1-based position of the step in the tour. */
  stepNumber?: number
  entryRoute?: string
  visitor?: string
}

/** The numeric part of a tour version, or -1 when it is not a valid version. */
export function tourVersionNumber(version: string): number {
  return TOUR_VERSION_PATTERN.test(version) ? Number(version.slice(1)) : -1
}

function isFinished(state: TourProgress): boolean {
  return state !== 'started'
}

/**
 * Which of two records of the same tour version stands. Completed and skipped beat started, whatever their times;
 * between two records of the same kind the later one wins, and the current one on a tie.
 */
export function preferredTourRecord<Entry extends TourProgressRecord>(current: Entry | null | undefined, incoming: Entry | null | undefined): Entry | null {
  if (!current) return incoming ?? null
  if (!incoming) return current
  const finished = isFinished(incoming.state)
  if (finished !== isFinished(current.state)) return finished ? incoming : current
  return incoming.updatedAt > current.updatedAt ? incoming : current
}
