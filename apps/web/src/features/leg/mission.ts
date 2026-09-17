import type { RaceMission } from '../race/mission'
import type { LegSetup } from './prepare'
import type { HandoffRoster } from './runner-groups'

/**
 * What the race tells the runner about a baton leg: whose baton it is, who ran it last, who is waiting for it, and the
 * note that came with it. Practice, the Daily and replays carry no mission.
 */
export function legMission(setup: LegSetup, roster: HandoffRoster | null): RaceMission | null {
  if (setup.mode !== 'relay' || !setup.baton) return null
  const last = setup.handoffs.at(-1) ?? null
  // The sector ghost is the previous runner's canonical run whenever their leg raced this sector.
  const ghostTime = last && setup.ghost && setup.ghostRunId === last.runId ? setup.ghost.timeMs : null
  return {
    batonName: setup.baton.displayName,
    previous: last ? { name: last.from.name, timeMs: ghostTime } : null,
    next: roster?.kind === 'known' ? { name: roster.runner.name, context: roster.runner.context } : null,
    note: last?.note ? { from: last.from.name, text: last.note.text } : null,
  }
}
