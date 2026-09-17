import { relayLeg } from '@nim-relay/game-engine'
import { isRelayLegV6Ghost, type BatonHandoff, type CanonicalGhost, type IssuedRace, type NetworkBaton, type NetworkDaily, type RelayEcho, type RelayLegV6Config } from '@nim-relay/shared'
import type { BatonAppearanceInput } from '../baton/baton-appearance'
import type { GhostRun, RaceMode } from '../race/controller'
import * as api from '../relays/api'

export type Leg =
  | { kind: 'baton'; code: string }
  | { kind: 'practice'; ghostRunId: string | null }
  | { kind: 'daily'; practice: boolean }
  | { kind: 'watch'; runId: string }

export function describeLeg(code: string, params: URLSearchParams): Leg | null {
  if (code === 'practice') return { kind: 'practice', ghostRunId: params.get('ghost') }
  if (code === 'daily') return { kind: 'daily', practice: params.get('practice') === '1' }
  if (code === 'watch') {
    const runId = params.get('run')
    return runId ? { kind: 'watch', runId } : null
  }
  return /^[A-Za-z0-9-]{1,64}$/.test(code) ? { kind: 'baton', code } : null
}

/** Player-facing reason a leg cannot start, shown as-is. */
export class LegUnavailable extends Error {}

export interface LegSetup {
  config: relayLeg.Config
  mode: RaceMode
  ghost: GhostRun | null
  /** Run behind `ghost`, so the relay can tell whose verified leg is being chased. */
  ghostRunId: string | null
  /** Watch mode: the verified trace to play back. */
  playback: relayLeg.InputTrace | null
  /** Server issuance for rides that count; null for signed-out practice and replays. */
  issued: IssuedRace | null
  sender: { name: string; country: string | null } | null
  baton: NetworkBaton | null
  /** The baton's verified handoffs, oldest first. Empty for anything but a baton leg. */
  handoffs: BatonHandoff[]
  appearance: BatonAppearanceInput | undefined
  echoes: RelayEcho[]
  /** First leg of a new route sector: nobody has set a time here yet. */
  firstOnSector: boolean
}

/** Only v6 runs can be raced or replayed by the current engine; earlier legs stay in their verified record. */
export function toGhostRun(ghost: CanonicalGhost | null): GhostRun | null {
  if (!ghost || !isRelayLegV6Ghost(ghost)) return null
  return {
    config: toEngineConfig(ghost.config),
    trace: ghost.inputTrace,
    name: ghost.runner?.name ?? ghost.name,
    country: ghost.runner?.country ?? null,
    timeMs: ghost.timeMs ?? ghost.result.timeMs,
  }
}

function toEngineConfig(config: RelayLegV6Config): relayLeg.Config {
  return { ...config }
}

export function appearanceInput(baton: NetworkBaton | null, echoes: readonly RelayEcho[]): BatonAppearanceInput | undefined {
  if (!baton) return undefined
  const milestones = [
    ...baton.appearance.milestones.map(handoffs => `handoffs-${handoffs}`),
    ...(echoes.some(echo => echo.kind === 'rescue') ? ['rescue'] : []),
  ]
  return {
    handoffCount: baton.appearance.handoffCount,
    ageMs: baton.appearance.ageMs,
    countries: baton.appearance.countries,
    ghostWins: baton.appearance.ghostWins,
    milestones,
  }
}

/** A signed-out practice ride runs locally on an unranked course; nothing is submitted. */
function localConfig(leg: Leg, daily: NetworkDaily | undefined): relayLeg.Config {
  const isDaily = leg.kind === 'daily'
  return {
    engineVersion: relayLeg.ENGINE_VERSION,
    challenge: relayLeg.CHALLENGE,
    challengeVersion: relayLeg.ENGINE_VERSION,
    seed: isDaily && daily ? daily.seed : `practice-${crypto.randomUUID()}`,
    world: isDaily && daily ? daily.world : relayLeg.WORLDS[Math.floor(Math.random() * relayLeg.WORLDS.length)]!,
    tier: isDaily ? 1 : 0,
    openingFlow: 0,
    tetherSaves: 1,
    ghostline: null,
  }
}

function modeFor(leg: Leg): RaceMode {
  switch (leg.kind) {
    case 'baton':
      return 'relay'
    case 'daily':
      return leg.practice ? 'practice' : 'daily'
    case 'practice':
      return 'practice'
    case 'watch':
      return 'watch'
  }
}

export async function prepareLeg(leg: Leg, signedIn: boolean, daily: NetworkDaily | undefined): Promise<LegSetup> {
  const unranked = { issued: null, sender: null, baton: null, handoffs: [], appearance: undefined, echoes: [], firstOnSector: false }
  if (leg.kind === 'watch') {
    const verified = await api.loadVerifiedReplay(leg.runId)
    const replay = toGhostRun(verified)
    if (!replay) throw new LegUnavailable('This ride was recorded on an earlier version of the race and can’t be replayed here.')
    return { ...unranked, config: replay.config, mode: 'watch', ghost: replay, ghostRunId: verified.runId, playback: replay.trace }
  }

  const chosenGhost = leg.kind === 'practice' && leg.ghostRunId ? await api.loadVerifiedReplay(leg.ghostRunId) : null
  if (chosenGhost && !isRelayLegV6Ghost(chosenGhost)) throw new LegUnavailable('That ghost raced an earlier version of the course. Pick a newer ride to race.')

  if (!signedIn) {
    const ghost = toGhostRun(chosenGhost)
    // The ghost's own config carries its predecessor's ghostline; a local ride has no verified line to draft.
    const config = ghost ? { ...ghost.config, openingFlow: 0, ghostline: null } : localConfig(leg, daily)
    return { ...unranked, config, mode: modeFor(leg), ghost, ghostRunId: chosenGhost?.runId ?? null, playback: null }
  }

  const detail = leg.kind === 'baton' ? await api.loadBaton(leg.code) : null
  if (detail?.pendingHandoff) {
    throw new LegUnavailable(`Your pass to ${detail.pendingHandoff.recipientName} is already locked. Finish it from the journey before racing again.`)
  }

  const issued = await api.issueNetworkRace(
    leg.kind === 'baton'
      ? { batonId: leg.code }
      : leg.kind === 'daily'
        ? { daily: true, ...(leg.practice ? { practice: true } : {}) }
        : { practice: true, ...(leg.ghostRunId ? { ghostRunId: leg.ghostRunId } : {}) },
  )
  if (issued.config.engineVersion !== relayLeg.ENGINE_VERSION) throw new LegUnavailable('This leg was issued for an earlier version of the race. Open it again to get the current course.')

  const baton = detail?.baton ?? null
  const handoffs = detail?.handoffs ?? []
  const passedBy = handoffs.at(-1)?.from ?? null
  const ghost = toGhostRun(issued.ghost)
  const echoes = issued.echoes ?? []
  return {
    config: toEngineConfig(issued.config),
    mode: modeFor(leg),
    ghost,
    ghostRunId: ghost ? (issued.ghost?.runId ?? null) : null,
    playback: null,
    issued,
    sender: passedBy ? { name: passedBy.name, country: passedBy.country } : null,
    baton,
    handoffs,
    appearance: appearanceInput(baton, echoes),
    echoes,
    firstOnSector: leg.kind === 'baton' && (issued.sector?.firstLeg ?? !ghost),
  }
}
