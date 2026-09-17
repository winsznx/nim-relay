import { relayLeg, relayLegV5 } from '@nim-relay/game-engine'
import { isRelayLegResult, type BatonHandoff, type RelayEcho, type RelayEchoKind, type RelayLegMoment, type RelayLegMomentKind, type RelayLegPath } from '@nim-relay/shared'
import type { Run } from '../model'
import { isRelayLegV6Run, type RelayLegV6Run } from '../race-engines'
import { HANDOFF_MILESTONES, MAX_BATON_ECHOES, MAX_LEG_ECHOES, NEAR_MISS_LEGEND } from './constants'
import { handoffsOf, isRaced, type RacedHandoff } from './lookups'
import type { NetworkState } from './types'

/** Most meaningful first, for the few echoes a leg draws. The last two only exist on v5 sectors. */
const LEG_ECHO_PRIORITY: readonly RelayEchoKind[] = ['ghost-record', 'relay-cut', 'edge-save', 'rescue', 'milestone', 'risk-pioneer', 'near-miss-legend']

interface Placement {
  dist: number | null
  path?: RelayLegPath
}
const SPANS_LEG: Placement = { dist: null }

/** Newest first: the latest echo per kind per sector, at most MAX_BATON_ECHOES. */
export function batonEchoes(state: NetworkState, batonId: string): RelayEcho[] {
  return (state.echoes[batonId] ?? []).slice(0, MAX_BATON_ECHOES)
}

/** The echoes one leg on `sector` is issued with, most meaningful first. */
export function legEchoes(state: NetworkState, batonId: string, sector: number): RelayEcho[] {
  return (state.echoes[batonId] ?? [])
    .filter(echo => echo.sector === sector)
    .sort((a, b) => LEG_ECHO_PRIORITY.indexOf(a.kind) - LEG_ECHO_PRIORITY.indexOf(b.kind))
    .slice(0, MAX_LEG_ECHOES)
}

/** Leaves the echoes a newly canonical leg earned on its sector. Call after the handoff is recorded. */
export function recordLegEchoes(state: NetworkState, handoff: BatonHandoff, run: Run): void {
  if (!isRaced(handoff)) return
  const leave = (kind: RelayEchoKind, placement: Placement): void => placeEcho(state, echoOf(handoff, kind, placement))
  if (setsSectorRecord(state, handoff)) leave('ghost-record', recordPlacement(run))
  if (isRelayLegV6Run(run)) {
    const cut = firstMoment(run, 'relay-cut')
    if (cut && !hasEcho(state, handoff, 'relay-cut')) leave('relay-cut', momentPlacement(cut))
    const save = firstMoment(run, 'edge-save')
    if (save) leave('edge-save', momentPlacement(save))
  } else if (isRelayLegResult(run.result) && run.result.completed) {
    if (run.result.metrics.riskRoutes > 0 && !hasEcho(state, handoff, 'risk-pioneer')) leave('risk-pioneer', { dist: v5ForkEntry(run) })
    if (run.result.metrics.nearMisses >= NEAR_MISS_LEGEND) leave('near-miss-legend', SPANS_LEG)
  }
  if (handoff.rescue) leave('rescue', SPANS_LEG)
  if (HANDOFF_MILESTONES.includes(handoff.leg)) leave('milestone', SPANS_LEG)
}

function echoOf(handoff: RacedHandoff, kind: RelayEchoKind, placement: Placement): RelayEcho {
  return {
    id: crypto.randomUUID(),
    batonId: handoff.batonId,
    kind,
    runner: { id: handoff.from.id, name: handoff.from.name },
    leg: handoff.leg,
    runId: handoff.runId,
    sector: handoff.sector,
    dist: placement.dist,
    ...(placement.path ? { path: placement.path } : {}),
    at: handoff.at,
    ...(kind === 'ghost-record' ? { timeMs: handoff.race.timeMs } : {}),
  }
}

/** Fastest completed canonical leg on its sector so far. */
function setsSectorRecord(state: NetworkState, handoff: RacedHandoff): boolean {
  if (!handoff.race.completed) return false
  return handoffsOf(state, handoff.batonId)
    .filter(isRaced)
    .every(other => other.id === handoff.id || other.sector !== handoff.sector || !other.race.completed || handoff.race.timeMs < other.race.timeMs)
}

function hasEcho(state: NetworkState, handoff: RacedHandoff, kind: RelayEchoKind): boolean {
  return (state.echoes[handoff.batonId] ?? []).some(echo => echo.sector === handoff.sector && echo.kind === kind)
}

/** Moments come in route order, so this is the kind's moment nearest the start of the route. */
function firstMoment(run: RelayLegV6Run, kind: RelayLegMomentKind): RelayLegMoment | undefined {
  return run.result.moments.find(moment => moment.kind === kind)
}

function momentPlacement(moment: RelayLegMoment): Placement {
  return { dist: moment.dist, path: moment.path }
}

/** A v6 record stands where its leg took the relay cut, otherwise on the finish approach. Earlier records span the leg. */
function recordPlacement(run: Run): Placement {
  if (!isRelayLegV6Run(run)) return SPANS_LEG
  const cut = firstMoment(run, 'relay-cut')
  if (cut) return { dist: cut.dist }
  return { dist: finishApproach(relayLeg.buildTrack(run.issued.config)) }
}

function finishApproach(track: relayLeg.Track): number | null {
  return track.segments.find(segment => segment.kind === 'finish')?.from ?? null
}

/** v5 risk-route echoes stand where that engine's single fork opens. */
function v5ForkEntry(run: Run): number | null {
  const { config } = run.issued
  return config.engineVersion === '5' ? relayLegV5.buildTrack(config).fork.from : null
}

/** One echo per kind per sector, at most MAX_BATON_ECHOES. The newest sector's echoes stay; older sectors fill the rest. */
function placeEcho(state: NetworkState, echo: RelayEcho): void {
  const others = (state.echoes[echo.batonId] ?? []).filter(existing => existing.sector !== echo.sector || existing.kind !== echo.kind)
  const newestFirst = [echo, ...others].sort((a, b) => b.at - a.at)
  const current = newestFirst.filter(existing => existing.sector >= echo.sector)
  const older = newestFirst.filter(existing => existing.sector < echo.sector)
  state.echoes[echo.batonId] = [...current, ...older].slice(0, MAX_BATON_ECHOES).sort((a, b) => b.at - a.at)
}
