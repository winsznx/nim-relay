import { displayName, formatSeconds } from './format'

/**
 * What this leg is for, as the relay tells it: whose baton, who ran it last and who it goes to
 * next. The handoff flow supplies it; the race only turns it into words.
 */
export interface RaceMission {
  batonName: string
  previous: { name: string; timeMs: number | null } | null
  next: { name: string; context: string | null } | null
  note: { from: string; text: string } | null
  /**
   * The Atlas route this leg races, by station name, and why it has a ghost or none. Stations are game-world
   * destinations. Null outside a baton leg.
   */
  route: { from: string; to: string; ghost: 'previous-runner' | 'different-route' | 'none' } | null
}

/** The primary action on the results of a completed relay leg, e.g. "PASS AURORA". */
export interface PassAction {
  label: string
  onPress(): void
}

export interface MissionCopy {
  /** "DELIVER AURORA TO YASMINE", "KEEP AURORA MOVING" */
  title: string
  /** "PREVIOUS RUNNER MARIANA · 44.12s", or null on the first leg of a sector. */
  previous: string | null
  /** Where the baton goes: the next runner's context, "OPEN HANDOFF AT FINISH", or null. */
  handoff: string | null
  /** "GENESIS STATION TO CAPE VERDIGRIS", or null without a route. */
  route: string | null
}

export function missionCopy(mission: RaceMission): MissionCopy {
  const baton = displayName(mission.batonName)
  const previous = mission.previous
    ? mission.route?.ghost === 'different-route'
      ? `PREVIOUS RUNNER ${displayName(mission.previous.name)} RACED ANOTHER ROUTE · NO GHOSTLINE`
      : `PREVIOUS RUNNER ${displayName(mission.previous.name)}${mission.previous.timeMs === null ? '' : ` · ${formatSeconds(mission.previous.timeMs)}`}`
    : null
  const route = mission.route ? `${displayName(mission.route.from)} TO ${displayName(mission.route.to)}` : null
  if (!mission.next) return { title: `KEEP ${baton} MOVING`, previous, handoff: 'OPEN HANDOFF AT FINISH', route }
  const context = mission.next.context?.trim()
  return { title: `DELIVER ${baton} TO ${displayName(mission.next.name)}`, previous, handoff: context ? context.toUpperCase() : null, route }
}

/** Shown while the handoff gate is in view: "HANDOFF TO YASMINE". Null when the handoff is open. */
export function handoffCallout(mission: RaceMission | null | undefined): string | null {
  return mission?.next ? `HANDOFF TO ${displayName(mission.next.name)}` : null
}

/** A runner's note, trimmed and quoted, or null when there is nothing to say. */
export function quotedNote(note: RaceMission['note']): string | null {
  const text = note?.text.trim()
  return text ? `“${text}”` : null
}
