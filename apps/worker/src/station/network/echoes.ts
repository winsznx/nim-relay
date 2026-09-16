import { relayLeg } from '@nim-relay/game-engine'
import { isRelayLegResult, type BatonHandoff, type RelayEcho, type RelayEchoKind } from '@nim-relay/shared'
import type { Run } from '../model'
import { HANDOFF_MILESTONES, MAX_BATON_ECHOES, NEAR_MISS_LEGEND } from './constants'
import { handoffsOf, isRaced, type RacedHandoff } from './lookups'
import type { NetworkState } from './types'

/** Newest first: the latest echo per kind per sector, capped for baton pages. */
export function batonEchoes(state: NetworkState, batonId: string): RelayEcho[] {
  return (state.echoes[batonId] ?? []).slice(0, MAX_BATON_ECHOES)
}

export function sectorEchoes(state: NetworkState, batonId: string, sector: number): RelayEcho[] {
  return (state.echoes[batonId] ?? []).filter(echo => echo.sector === sector)
}

/** Leaves the echoes a newly canonical leg earned on its sector. Call after the handoff is recorded. */
export function recordLegEchoes(state: NetworkState, handoff: BatonHandoff, run: Run): void {
  if (!isRaced(handoff)) return
  const leave = (kind: RelayEchoKind, dist: number | null): void => placeEcho(state, echoOf(handoff, kind, dist))
  if (setsSectorRecord(state, handoff)) leave('ghost-record', null)
  const { result } = run
  if (isRelayLegResult(result) && result.completed) {
    if (result.metrics.riskRoutes > 0 && !hasEcho(state, handoff, 'risk-pioneer')) leave('risk-pioneer', forkEntry(run))
    if (result.metrics.nearMisses >= NEAR_MISS_LEGEND) leave('near-miss-legend', null)
  }
  if (handoff.rescue) leave('rescue', null)
  if (HANDOFF_MILESTONES.includes(handoff.leg)) leave('milestone', null)
}

function echoOf(handoff: RacedHandoff, kind: RelayEchoKind, dist: number | null): RelayEcho {
  return {
    id: crypto.randomUUID(),
    batonId: handoff.batonId,
    kind,
    runner: { id: handoff.from.id, name: handoff.from.name },
    leg: handoff.leg,
    runId: handoff.runId,
    sector: handoff.sector,
    dist,
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

/** Risk-route echoes stand where the fork opens. */
function forkEntry(run: Run): number | null {
  const config = run.issued.config
  if (config.engineVersion !== '5') return null
  return relayLeg.buildTrack(config).fork.from
}

/** One echo per kind per sector. Every echo of the newest sector stays, older sectors keep only the newest few. */
function placeEcho(state: NetworkState, echo: RelayEcho): void {
  const others = (state.echoes[echo.batonId] ?? []).filter(existing => existing.sector !== echo.sector || existing.kind !== echo.kind)
  const echoes = [echo, ...others].sort((a, b) => b.at - a.at)
  state.echoes[echo.batonId] = echoes.filter((existing, index) => index < MAX_BATON_ECHOES || existing.sector >= echo.sector)
}
