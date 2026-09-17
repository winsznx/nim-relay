import { TOUR_EVENTS, TOUR_ID_PATTERN, TOUR_STEP_EVENTS, TOUR_STEP_ID_PATTERN, TOUR_VERSION_PATTERN, type OpsOnboarding, type OpsTour, type OpsTourStep, type RelayNetwork, type TourEvent, type TrackEventResult } from '@nim-relay/shared'
import { z } from 'zod'
import { keepLatestDates, utcDate, utcDatesEnding } from './calendar'
import { ANONYMOUS_TOUR_EVENTS_PER_DAY, MAX_TRACKED_TOUR_STEPS, MAX_TRACKED_TOURS, OPS_WINDOW_DAYS, TOUR_EVENTS_PER_ACTOR_PER_DAY } from './constants'
import { networkStateKey } from './state'
import { trackActorKey } from './traffic'
import type { TourDayCounters, TourLedger, TourStepCounters } from './types'

const ANONYMOUS_TOTAL_KEY = 'anonymous'
/** Top-level app sections a visit can start on. Any other first segment is reported as `other`. */
const ENTRY_SECTIONS = new Set(['relay', 'chronicle', 'proof', 'inbox', 'daily', 'crew', 'rivals', 'profile', 'runner', 'invite', 'start', 'privacy', 'station', 'leg', 'ops'])

/**
 * A tour event carries tour, step and entry page only: unknown fields such as wallets or device data are refused,
 * and the entry page is reduced to its first path segment before anything is counted.
 */
const tourTrackBody = z
  .strictObject({
    kind: z.literal('tour'),
    event: z.enum(TOUR_EVENTS),
    tourId: z.string().regex(TOUR_ID_PATTERN),
    version: z.string().regex(TOUR_VERSION_PATTERN),
    stepId: z.string().regex(TOUR_STEP_ID_PATTERN).optional(),
    stepNumber: z.number().int().min(1).max(99).optional(),
    entryRoute: z.string().max(200).startsWith('/').optional(),
    visitor: z.string().min(8).max(128).optional(),
  })
  .refine(input => (input.stepId === undefined) === (input.stepNumber === undefined), { message: 'stepId and stepNumber go together' })
  .refine(input => !TOUR_STEP_EVENTS.includes(input.event) || input.stepId !== undefined, { message: 'step events name their step' })

export interface TourEventRecord {
  event: TourEvent
  tourId: string
  version: string
  step: { id: string; number: number } | null
  /** First path segment the visit started on, e.g. `/invite`, or null when not given. */
  entry: string | null
}

export interface TrackActor {
  key: string
  anonymous: boolean
}

/** POST /network/track bodies for tours, told apart before the network state is loaded. */
export function isTourTrack(body: unknown): boolean {
  return typeof body === 'object' && body !== null && Reflect.get(body, 'kind') === 'tour'
}

export function tourLedgerKey(networkKey: string): string {
  return `${networkKey}:tours`
}

export function freshTourLedger(now: number): TourLedger {
  return { startedAt: now, day: utcDate(now), eventsToday: {}, days: {} }
}

export async function readTourLedger(storage: DurableObjectStorage, key: string, now: number): Promise<TourLedger> {
  return (await storage.get<TourLedger>(key)) ?? freshTourLedger(now)
}

/** `/invite/abc?x=1` -> `/invite`. Query, hash and every dynamic segment are dropped. */
export function entrySection(route: string | undefined): string | null {
  if (route === undefined) return null
  const segment = route.split(/[?#]/, 1)[0]?.split('/')[1] ?? ''
  if (segment === '') return '/'
  return ENTRY_SECTIONS.has(segment) ? `/${segment}` : 'other'
}

/** Counts one tour event against the actor's daily cap. Returns false, changing nothing that is stored, when it isn't counted. */
export function countTourEvent(ledger: TourLedger, record: TourEventRecord, actor: TrackActor, now: number): boolean {
  rollDay(ledger, now)
  const actorEvents = ledger.eventsToday[actor.key] ?? 0
  if (actorEvents >= TOUR_EVENTS_PER_ACTOR_PER_DAY) return false
  const anonymousEvents = ledger.eventsToday[ANONYMOUS_TOTAL_KEY] ?? 0
  if (actor.anonymous && anonymousEvents >= ANONYMOUS_TOUR_EVENTS_PER_DAY) return false

  const day = dayCounters(ledger, now)
  const tourKey = `${record.tourId}:${record.version}`
  if (!day[tourKey] && Object.keys(day).length >= MAX_TRACKED_TOURS) return false
  const tour = day[tourKey] ?? { offered: 0, started: 0, completed: 0, skipped: 0, declined: 0, replayed: 0, steps: {}, entries: {} }
  const aboutStep = TOUR_STEP_EVENTS.includes(record.event) || record.event === 'skipped'
  const step = aboutStep && record.step ? stepCounters(tour, record.step) : null
  if (aboutStep && record.step && !step) return false

  apply(tour, record, step)
  day[tourKey] = tour
  ledger.eventsToday[actor.key] = actorEvents + 1
  if (actor.anonymous) ledger.eventsToday[ANONYMOUS_TOTAL_KEY] = anonymousEvents + 1
  return true
}

function apply(tour: TourDayCounters, record: TourEventRecord, step: TourStepCounters | null): void {
  switch (record.event) {
    case 'offered':
      tour.offered++
      break
    case 'started':
      tour.started++
      if (record.entry) tour.entries[record.entry] = (tour.entries[record.entry] ?? 0) + 1
      break
    case 'step_viewed':
      if (step) step.viewed++
      break
    case 'step_completed':
      if (step) step.completed++
      break
    case 'target_missing':
      if (step) step.missing++
      break
    case 'skipped':
      if (step) {
        step.skipped++
        tour.skipped++
      } else tour.declined++
      break
    case 'completed':
      tour.completed++
      break
    case 'replayed':
      tour.replayed++
      break
  }
}

/**
 * Parses and counts a tour event on the ledger's own key. The network state is neither loaded nor rewritten, and an
 * uncounted event writes nothing.
 */
export async function recordTourEvent(storage: DurableObjectStorage, network: RelayNetwork, body: unknown, actorId: string | null, now: number): Promise<TrackEventResult> {
  const input = tourTrackBody.parse(body)
  const key = tourLedgerKey(networkStateKey(network))
  const ledger = await readTourLedger(storage, key, now)
  const record: TourEventRecord = {
    event: input.event,
    tourId: input.tourId,
    version: input.version,
    step: input.stepId !== undefined && input.stepNumber !== undefined ? { id: input.stepId, number: input.stepNumber } : null,
    entry: entrySection(input.entryRoute),
  }
  const counted = countTourEvent(ledger, record, { key: await trackActorKey(actorId, input.visitor), anonymous: actorId === null }, now)
  if (counted) await storage.put(key, ledger)
  return { counted }
}

/** Every tour version counted in the report window, most started first, with steps in tour order. */
export function onboardingReport(ledger: TourLedger, now: number): OpsOnboarding {
  const reportDates = new Set(utcDatesEnding(now, OPS_WINDOW_DAYS))
  const tours = new Map<string, { tour: OpsTour; steps: Map<string, OpsTourStep>; entries: Map<string, number> }>()
  // Oldest first, so the latest day decides a step's number.
  for (const date of Object.keys(ledger.days).sort()) {
    if (!reportDates.has(date)) continue
    for (const [tourKey, counters] of Object.entries(ledger.days[date] ?? {})) {
      const [tourId = '', version = ''] = tourKey.split(':')
      const entry = tours.get(tourKey) ?? { tour: { tourId, version, offered: 0, started: 0, completed: 0, skipped: 0, declined: 0, replayed: 0, steps: [], entries: [] }, steps: new Map(), entries: new Map() }
      const { tour } = entry
      tour.offered += counters.offered
      tour.started += counters.started
      tour.completed += counters.completed
      tour.skipped += counters.skipped
      tour.declined += counters.declined
      tour.replayed += counters.replayed
      for (const [stepId, step] of Object.entries(counters.steps)) {
        const total = entry.steps.get(stepId) ?? { stepId, stepNumber: step.stepNumber, viewed: 0, completed: 0, skippedHere: 0, missing: 0 }
        entry.steps.set(stepId, { stepId, stepNumber: step.stepNumber, viewed: total.viewed + step.viewed, completed: total.completed + step.completed, skippedHere: total.skippedHere + step.skipped, missing: total.missing + step.missing })
      }
      for (const [section, started] of Object.entries(counters.entries)) entry.entries.set(section, (entry.entries.get(section) ?? 0) + started)
      tours.set(tourKey, entry)
    }
  }
  const report = [...tours.values()].map(({ tour, steps, entries }) => ({
    ...tour,
    steps: [...steps.values()].sort((a, b) => a.stepNumber - b.stepNumber || a.stepId.localeCompare(b.stepId)),
    entries: [...entries].map(([section, started]) => ({ section, started })).sort((a, b) => b.started - a.started || a.section.localeCompare(b.section)),
  }))
  report.sort((a, b) => b.started - a.started || b.offered - a.offered || a.tourId.localeCompare(b.tourId) || a.version.localeCompare(b.version))
  return { countingSince: ledger.startedAt, tours: report }
}

/** Daily caps reset at UTC midnight; counters are kept for the operator window. */
function rollDay(ledger: TourLedger, now: number): void {
  const today = utcDate(now)
  if (ledger.day === today) return
  ledger.day = today
  ledger.eventsToday = {}
}

function dayCounters(ledger: TourLedger, now: number): Record<string, TourDayCounters> {
  keepLatestDates(ledger.days, now, OPS_WINDOW_DAYS)
  const date = utcDate(now)
  const day = ledger.days[date] ?? {}
  ledger.days[date] = day
  return day
}

function stepCounters(tour: TourDayCounters, step: { id: string; number: number }): TourStepCounters | null {
  const existing = tour.steps[step.id]
  if (existing) {
    existing.stepNumber = step.number
    return existing
  }
  if (Object.keys(tour.steps).length >= MAX_TRACKED_TOUR_STEPS) return null
  const created = { stepNumber: step.number, viewed: 0, completed: 0, skipped: 0, missing: 0 }
  tour.steps[step.id] = created
  return created
}
