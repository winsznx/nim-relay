import type { RelayEcho, RelayEchoKind } from '@nim-relay/shared'
import { displayName, formatSeconds } from './format'

/**
 * Which Relay Echoes a leg shows and how they read. Echoes with a route distance stand beside the track; echoes
 * that span the whole leg are named in the arrival.
 */

/** Echoes standing beside one leg's track at most. */
export const MAX_TRACK_ECHOES = 4

const PRIORITY: readonly RelayEchoKind[] = ['ghost-record', 'risk-pioneer', 'rescue', 'milestone', 'near-miss-legend']

function byPriority(a: RelayEcho, b: RelayEcho): number {
  return PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind)
}

/** Echoes with a place on the route, most meaningful first, capped for the track. */
export function trackEchoes(echoes: readonly RelayEcho[]): RelayEcho[] {
  return echoes.filter(echo => echo.dist !== null).sort(byPriority).slice(0, MAX_TRACK_ECHOES)
}

/** Echoes that belong to the whole leg rather than a place on it, most meaningful first. */
export function legEchoes(echoes: readonly RelayEcho[]): RelayEcho[] {
  return echoes.filter(echo => echo.dist === null).sort(byPriority)
}

/** "RISK PIONEER · ADA", "GHOST RECORD · TIM 38.42s", "HANDOFF 50". */
export function echoLabel(echo: Pick<RelayEcho, 'kind' | 'runner' | 'leg' | 'timeMs'>): string {
  const name = displayName(echo.runner.name)
  switch (echo.kind) {
    case 'ghost-record':
      return echo.timeMs === undefined ? `GHOST RECORD · ${name}` : `GHOST RECORD · ${name} ${formatSeconds(echo.timeMs)}`
    case 'risk-pioneer':
      return `RISK PIONEER · ${name}`
    case 'near-miss-legend':
      return `NEAR-MISS LEGEND · ${name}`
    case 'rescue':
      return `RESCUE · ${name}`
    case 'milestone':
      return `HANDOFF ${echo.leg}`
  }
}
