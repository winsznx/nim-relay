import type { BatonChronicle, BatonHandoff, ChronicleMoment, ChronicleStop, RunnerRef } from '@nim-relay/shared'
import { ghostSurvivals } from './achievements'
import { presentBaton, transactingWallets } from './batons'
import { HANDOFF_MILESTONES } from './constants'
import { findBaton, handoffsOf, isRaced, type RacedHandoff } from './lookups'
import { consentedCountry, runnerRef } from './runners'
import type { BatonRecord, NetworkContext, NetworkState } from './types'

/** Public journey record of a baton. Handles instead of wallets; countries only while their runner consents. */
export function batonChronicle(context: NetworkContext, idOrCode: string): BatonChronicle {
  const { state } = context
  const baton = findBaton(state, idOrCode)
  const handoffs = handoffsOf(state, baton.id).filter(handoff => handoff.qualified)
  const presented = presentBaton(baton, handoffs, Date.now())
  const stops = chronicleStops(state, baton, handoffs)
  return {
    baton: {
      id: baton.id,
      code: baton.code,
      serial: baton.serial,
      title: baton.title,
      displayName: baton.displayName,
      mode: baton.mode,
      network: baton.network,
      status: baton.status,
      value: baton.value,
      createdAt: baton.createdAt,
      completedAt: baton.completedAt,
      origin: runnerRef(baton.origin),
      holder: runnerRef(baton.holder),
      route: baton.route,
      appearance: presented.appearance,
    },
    stops,
    aliveMs: presented.aliveMs,
    qualifiedHandoffs: handoffs.length,
    transactingWallets: transactingWallets(handoffs),
    countries: new Set(stops.flatMap(stop => (stop.countryCode ? [stop.countryCode] : []))).size,
    moments: chronicleMoments(baton, handoffs, stops),
    runners: orderedRunners(baton, handoffs),
    transactions: handoffs.map(handoff => ({
      leg: handoff.leg,
      txHash: handoff.txHash,
      from: handoff.from.handle,
      to: handoff.to.handle,
      blockNumber: handoff.blockNumber,
      confirmations: handoff.confirmations,
      at: handoff.at,
      runId: handoff.runId,
      resultHash: handoff.resultHash,
    })),
    replays: handoffs.map(handoff => ({ leg: handoff.leg, runId: handoff.runId })),
  }
}

/** Origin first, then every recipient. A recorded country shows only while that runner still consents. */
function chronicleStops(state: NetworkState, baton: BatonRecord, handoffs: readonly BatonHandoff[]): ChronicleStop[] {
  const shown = (runnerId: string, recorded: string | null): string | null => (consentedCountry(state, runnerId) ? recorded : null)
  return [
    { leg: 0, runner: runnerRef(baton.origin), countryCode: shown(baton.origin.id, baton.origin.country), at: baton.createdAt },
    ...handoffs.map(handoff => ({ leg: handoff.leg, runner: runnerRef(handoff.to), countryCode: shown(handoff.to.id, handoff.to.country), at: handoff.at })),
  ]
}

function orderedRunners(baton: BatonRecord, handoffs: readonly BatonHandoff[]): RunnerRef[] {
  const runners = new Map<string, RunnerRef>([[baton.origin.id, runnerRef(baton.origin)]])
  for (const handoff of handoffs) {
    if (!runners.has(handoff.from.id)) runners.set(handoff.from.id, runnerRef(handoff.from))
    if (!runners.has(handoff.to.id)) runners.set(handoff.to.id, runnerRef(handoff.to))
  }
  return [...runners.values()]
}

function chronicleMoments(baton: BatonRecord, handoffs: readonly BatonHandoff[], stops: readonly ChronicleStop[]): ChronicleMoment[] {
  const legs = handoffs.filter(isRaced).filter(handoff => handoff.race.completed)
  const moments: ChronicleMoment[] = []
  const fastest = fastestLeg(legs)
  if (fastest) moments.push({ kind: 'fastest-leg', title: 'Fastest leg', runner: runnerRef(fastest.from), leg: fastest.leg, value: fastest.race.timeMs })
  const closest = closestGhostRace(legs)
  if (closest) moments.push({ kind: 'closest-ghost-race', title: 'Closest ghost race', runner: runnerRef(closest.leg.from), leg: closest.leg.leg, value: closest.gapMs })
  const wall = longestSurvivingGhost(legs)
  if (wall) moments.push({ kind: 'longest-surviving-ghost', title: 'Longest-surviving ghost', runner: runnerRef(wall.leg.from), leg: wall.leg.leg, value: wall.survived })
  const crossing = firstNewCountry(stops)
  if (crossing) moments.push({ kind: 'first-new-country', title: 'First new country', runner: crossing.runner, leg: crossing.leg, value: crossing.countryCode })
  for (const handoff of handoffs) {
    if (handoff.rescue) moments.push({ kind: 'rescue', title: 'Rescue', runner: runnerRef(handoff.from), leg: handoff.leg, value: null })
    if (HANDOFF_MILESTONES.includes(handoff.leg)) moments.push({ kind: 'milestone', title: `Handoff ${handoff.leg}`, runner: runnerRef(handoff.from), leg: handoff.leg, value: handoff.leg })
  }
  if (baton.status !== 'active') moments.push({ kind: 'final-runner', title: 'Final runner', runner: runnerRef(baton.holder), leg: baton.handoffCount, value: null })
  return moments
}

function fastestLeg(legs: readonly RacedHandoff[]): RacedHandoff | null {
  let fastest: RacedHandoff | null = null
  for (const leg of legs) {
    if (!fastest || leg.race.timeMs < fastest.race.timeMs) fastest = leg
  }
  return fastest
}

function closestGhostRace(legs: readonly RacedHandoff[]): { leg: RacedHandoff; gapMs: number } | null {
  let closest: { leg: RacedHandoff; gapMs: number } | null = null
  for (const leg of legs) {
    if (leg.race.ghostTimeMs === null) continue
    const gapMs = Math.abs(leg.race.timeMs - leg.race.ghostTimeMs)
    if (!closest || gapMs < closest.gapMs) closest = { leg, gapMs }
  }
  return closest
}

function longestSurvivingGhost(legs: readonly RacedHandoff[]): { leg: RacedHandoff; survived: number } | null {
  let longest: { leg: RacedHandoff; survived: number } | null = null
  for (const leg of legs) {
    const survived = ghostSurvivals(leg, legs.filter(other => other.sector === leg.sector))
    if (survived > 0 && (!longest || survived > longest.survived)) longest = { leg, survived }
  }
  return longest
}

/** The first stop in a consented country different from every earlier known one. */
function firstNewCountry(stops: readonly ChronicleStop[]): ChronicleStop & { countryCode: string } | null {
  const seen = new Set<string>()
  for (const stop of stops) {
    if (!stop.countryCode) continue
    if (seen.size > 0 && !seen.has(stop.countryCode)) return { ...stop, countryCode: stop.countryCode }
    seen.add(stop.countryCode)
  }
  return null
}
